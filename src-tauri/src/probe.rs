//! The probe engine: decide whether each endpoint is Up / Blocked / Down, roll up to per-service
//! and per-list status, then compute overall severity.
//!
//! Strategy (light but censorship-aware):
//!  1. **TCP connect** to `host:port` with a timeout. If it fails (DNS error, refused, timeout)
//!     the endpoint has no route → `Down`.
//!  2. If TCP succeeds, send a tiny **HTTPS HEAD** request. If the server answers *anything* the
//!     endpoint is `Up`. If the TLS/HTTP layer errors even though TCP connected, that's the classic
//!     fingerprint of interception → `Blocked`.
//!
//! HEAD pulls almost no bytes, and we cap concurrency, so a full cycle is cheap on bandwidth.
//!
//! Known limitation: a block page that returns HTTP 200 over a *valid* cert can't be told apart
//! from the real site by this method; it will read as `Up`.

use crate::models::{
    Config, EndpointStatus, ListStatus, ServiceList, ServiceState, ServiceStatus, Severity,
    worst_state,
};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::net::TcpStream;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

/// Max simultaneous probes. Bounds endpoint-level concurrency even with many-endpoint services.
const MAX_CONCURRENT: usize = 8;

/// Pure classifier — exercised directly by unit tests.
///
/// * no TCP            → `Down`
/// * TCP + HTTP answer → `Up`
/// * TCP, no HTTP      → `Blocked`
pub fn classify(tcp_ok: bool, http_ok: bool) -> ServiceState {
    match (tcp_ok, http_ok) {
        (false, _) => ServiceState::Down,
        (true, true) => ServiceState::Up,
        (true, false) => ServiceState::Blocked,
    }
}

/// Probe one endpoint. Returns its state and the TCP-connect latency (when it connected).
async fn probe_endpoint(
    client: &reqwest::Client,
    host: &str,
    port: u16,
    timeout_ms: u64,
) -> (ServiceState, Option<u64>) {
    let timeout = Duration::from_millis(timeout_ms);

    // 1. TCP connect (also does DNS). Measure how long it took.
    let started = Instant::now();
    let tcp_ok = matches!(
        tokio::time::timeout(timeout, TcpStream::connect((host, port))).await,
        Ok(Ok(_))
    );
    let latency_ms = tcp_ok.then(|| started.elapsed().as_millis() as u64);

    if !tcp_ok {
        return (ServiceState::Down, None);
    }

    // 2. TCP worked — does the HTTPS layer answer? Any response (even 4xx/5xx) counts as Up.
    let url = if port == 443 {
        format!("https://{host}/")
    } else {
        format!("https://{host}:{port}/")
    };
    let http_ok = client.head(&url).send().await.is_ok();

    (classify(tcp_ok, http_ok), latency_ms)
}

/// Critical list fully down → Red; non-critical list fully down → Yellow; else Green.
pub fn overall_severity(lists: &[ListStatus]) -> Severity {
    if lists.iter().any(|l| l.all_down && l.critical) {
        Severity::Red
    } else if lists.iter().any(|l| l.all_down) {
        Severity::Yellow
    } else {
        Severity::Green
    }
}

/// Build a synthetic snapshot with every endpoint in `Checking` state.
/// Pure (no I/O). Used to give instant visual feedback before a background probe resolves.
pub fn checking_lists(config: &Config) -> Vec<ListStatus> {
    config
        .lists
        .iter()
        .map(|list| {
            let services: Vec<ServiceStatus> = list
                .services
                .iter()
                .filter(|s| s.enabled)
                .map(|s| {
                    let endpoints: Vec<EndpointStatus> = s
                        .endpoints
                        .iter()
                        .map(|ep| EndpointStatus {
                            id: ep.id.clone(),
                            host: ep.host.clone(),
                            state: ServiceState::Checking,
                            latency_ms: None,
                        })
                        .collect();
                    ServiceStatus {
                        id: s.id.clone(),
                        label: s.label.clone(),
                        state: ServiceState::Checking,
                        endpoints,
                    }
                })
                .collect();
            ListStatus {
                id: list.id.clone(),
                name: list.name.clone(),
                icon: list.icon.clone(),
                all_down: false,
                services,
                collapsed: list.collapsed,
                critical: list.critical,
            }
        })
        .collect()
}

/// Probe every enabled service in `config` concurrently (bounded) and return per-list status.
/// Disabled services are skipped entirely (not probed, not counted toward `all_down`).
pub async fn probe_all(config: &Config, client: &reqwest::Client) -> Vec<ListStatus> {
    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT));
    let timeout_ms = config.timeout_ms;
    let mut result = Vec::with_capacity(config.lists.len());

    for list in &config.lists {
        let statuses = probe_list(list, client, &semaphore, timeout_ms).await;
        let all_down = statuses.iter().any(|_| true) // at least one service exists
            && !statuses.is_empty()
            && statuses.iter().all(|s| s.fully_failing());
        result.push(ListStatus {
            id: list.id.clone(),
            name: list.name.clone(),
            icon: list.icon.clone(),
            services: statuses,
            all_down,
            collapsed: list.collapsed,
            critical: list.critical,
        });
    }
    result
}

/// Probe all enabled services of a single list, each fanning out to their endpoints.
async fn probe_list(
    list: &ServiceList,
    client: &reqwest::Client,
    semaphore: &Arc<Semaphore>,
    timeout_ms: u64,
) -> Vec<ServiceStatus> {
    let enabled: Vec<&_> = list.services.iter().filter(|s| s.enabled).collect();
    let mut result = Vec::with_capacity(enabled.len());

    for svc in &enabled {
        let ep_statuses = probe_service_endpoints(svc.id.as_str(), &svc.endpoints, client, semaphore, timeout_ms).await;
        let svc_state = worst_state(&ep_statuses.iter().map(|e| e.state).collect::<Vec<_>>());
        result.push(ServiceStatus {
            id: svc.id.clone(),
            label: svc.label.clone(),
            state: svc_state,
            endpoints: ep_statuses,
        });
    }
    result
}

/// Probe all endpoints of one service concurrently under the shared semaphore.
async fn probe_service_endpoints(
    _svc_id: &str,
    endpoints: &[crate::models::Endpoint],
    client: &reqwest::Client,
    semaphore: &Arc<Semaphore>,
    timeout_ms: u64,
) -> Vec<EndpointStatus> {
    let mut set: JoinSet<(usize, ServiceState, Option<u64>)> = JoinSet::new();

    for (idx, ep) in endpoints.iter().enumerate() {
        let permit = Arc::clone(semaphore);
        let client = client.clone();
        let host = ep.host.clone();
        let port = ep.port;
        set.spawn(async move {
            let _guard = permit.acquire().await.expect("semaphore open");
            let (state, latency) = probe_endpoint(&client, &host, port, timeout_ms).await;
            (idx, state, latency)
        });
    }

    let mut collected: Vec<Option<(ServiceState, Option<u64>)>> = vec![None; endpoints.len()];
    while let Some(joined) = set.join_next().await {
        if let Ok((idx, state, latency)) = joined {
            collected[idx] = Some((state, latency));
        }
    }

    endpoints
        .iter()
        .enumerate()
        .map(|(idx, ep)| {
            let (state, latency_ms) = collected[idx].unwrap_or((ServiceState::Checking, None));
            EndpointStatus {
                id: ep.id.clone(),
                host: ep.host.clone(),
                state,
                latency_ms,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Endpoint, Service, ServiceList, Config};

    fn ep_status(state: ServiceState) -> EndpointStatus {
        EndpointStatus {
            id: "e".into(),
            host: "h".into(),
            state,
            latency_ms: None,
        }
    }

    fn svc_status(states: &[ServiceState]) -> ServiceStatus {
        let endpoints: Vec<_> = states.iter().copied().map(ep_status).collect();
        let state = worst_state(states);
        ServiceStatus {
            id: "s".into(),
            label: "s".into(),
            state,
            endpoints,
        }
    }

    fn list_status(svc_states: &[&[ServiceState]]) -> ListStatus {
        list_status_ex(svc_states, false)
    }

    fn list_status_ex(svc_states: &[&[ServiceState]], critical: bool) -> ListStatus {
        let services: Vec<_> = svc_states.iter().map(|s| svc_status(s)).collect();
        let all_down = !services.is_empty() && services.iter().all(|s| s.fully_failing());
        ListStatus {
            id: "l".into(),
            name: "l".into(),
            icon: "".into(),
            all_down,
            services,
            collapsed: false,
            critical,
        }
    }

    #[test]
    fn classify_matrix() {
        assert_eq!(classify(false, false), ServiceState::Down);
        assert_eq!(classify(false, true), ServiceState::Down);
        assert_eq!(classify(true, true), ServiceState::Up);
        assert_eq!(classify(true, false), ServiceState::Blocked);
    }

    #[test]
    fn worst_state_precedence() {
        use ServiceState::*;
        assert_eq!(worst_state(&[Up, Blocked, Down]), Down);
        assert_eq!(worst_state(&[Up, Blocked]), Blocked);
        assert_eq!(worst_state(&[Up, Checking]), Checking);
        assert_eq!(worst_state(&[Up]), Up);
        assert_eq!(worst_state(&[]), Checking); // empty → Checking
    }

    #[test]
    fn fully_failing_requires_all_endpoints_fail() {
        use ServiceState::*;
        assert!(svc_status(&[Down, Blocked]).fully_failing());
        assert!(!svc_status(&[Down, Up]).fully_failing());
        assert!(!svc_status(&[Checking, Down]).fully_failing()); // Checking is not a failure
        assert!(!svc_status(&[]).fully_failing());               // empty endpoints → not failing
    }

    #[test]
    fn all_down_needs_every_service_fully_failing() {
        use ServiceState::*;
        // list with one fully-failing and one partially-up service → NOT all_down
        assert!(!list_status(&[&[Down, Down], &[Down, Up]]).all_down);
        // list where every service is fully failing → all_down
        assert!(list_status(&[&[Down, Blocked], &[Down]]).all_down);
        // Checking endpoint prevents fully_failing
        assert!(!list_status(&[&[Checking, Down]]).all_down);
    }

    #[test]
    fn checking_lists_all_checking_not_down() {
        let ep_a = Endpoint::new("a.com", 443);
        let svc_a = Service::with_endpoints("A", vec![ep_a]);
        let ep_b = Endpoint::new("b.com", 443);
        let svc_b = Service::with_endpoints("B", vec![ep_b]);
        let config = Config {
            lists: vec![ServiceList {
                id: "l1".into(),
                name: "Test".into(),
                icon: "".into(),
                collapsed: false,
                critical: false,
                services: vec![svc_a, svc_b],
            }],
            probe_interval_secs: 30,
            timeout_ms: 3000,
            ip_providers: vec![],
        };
        let lists = checking_lists(&config);
        assert_eq!(lists.len(), 1);
        assert!(!lists[0].all_down);
        assert!(lists[0].services.iter().all(|s| s.state == ServiceState::Checking));
        assert!(lists[0].services.iter().all(|s| s.endpoints.iter().all(|e| e.state == ServiceState::Checking)));
    }

    #[test]
    fn severity_critical_down_is_red() {
        use ServiceState::*;
        // Critical list fully down → Red
        assert_eq!(overall_severity(&[list_status_ex(&[&[Down, Down]], true), list_status(&[&[Up]])]), Severity::Red);
        // Non-critical list fully down → Yellow
        assert_eq!(overall_severity(&[list_status(&[&[Down, Down]]), list_status(&[&[Up]])]), Severity::Yellow);
        // All up → Green
        assert_eq!(overall_severity(&[list_status(&[&[Up]]), list_status(&[&[Up]])]), Severity::Green);
    }
}
