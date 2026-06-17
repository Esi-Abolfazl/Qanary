//! The probe engine: decide whether each service is Up / Blocked / Down, then roll the per-service
//! results up into per-list and overall severity.
//!
//! Strategy (light but censorship-aware):
//!  1. **TCP connect** to `host:port` with a timeout. If it fails (DNS error, refused, timeout) the
//!     service looks like it has no route → `Down`.
//!  2. If TCP succeeds, send a tiny **HTTPS HEAD** request. If the server answers *anything* the
//!     service is `Up`. If the TLS/HTTP layer errors even though TCP connected, that's the classic
//!     fingerprint of interception (bad cert, reset mid-handshake, hang) → `Blocked`.
//!
//! HEAD pulls almost no bytes, and we cap concurrency, so a full cycle is cheap on bandwidth.
//!
//! Known limitation: a block page that returns HTTP 200 over a *valid* cert can't be told apart
//! from the real site by this method; it will read as `Up`. Detecting that needs content
//! heuristics we deliberately skip for v1.

use crate::models::{
    Config, ListStatus, ServiceList, ServiceState, ServiceStatus, Severity,
};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::net::TcpStream;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

/// Max simultaneous probes. Keeps bursts small even with many user-added services.
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

/// Probe one service. Returns its state and the TCP-connect latency (when it connected).
async fn probe_service(
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

/// `true` when a list has at least one enabled service and every one of them is failing.
fn compute_all_down(statuses: &[ServiceStatus]) -> bool {
    !statuses.is_empty() && statuses.iter().all(|s| s.state.is_failure())
}

/// Any list fully down → Red; else Green.
pub fn overall_severity(lists: &[ListStatus]) -> Severity {
    if lists.iter().any(|l| l.all_down) {
        Severity::Red
    } else {
        Severity::Green
    }
}

/// Probe every enabled service in `config` concurrently (bounded) and return per-list status.
/// Disabled services are skipped entirely (not probed, not counted toward `all_down`).
pub async fn probe_all(config: &Config, client: &reqwest::Client) -> Vec<ListStatus> {
    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT));
    let timeout_ms = config.timeout_ms;
    let mut result = Vec::with_capacity(config.lists.len());

    for list in &config.lists {
        let statuses = probe_list(list, client, &semaphore, timeout_ms).await;
        let all_down = compute_all_down(&statuses);
        result.push(ListStatus {
            id: list.id.clone(),
            name: list.name.clone(),
            icon: list.icon.clone(),
            services: statuses,
            all_down,
            collapsed: list.collapsed,
        });
    }
    result
}

/// Probe the enabled services of a single list, fanning out under the shared concurrency limit.
async fn probe_list(
    list: &ServiceList,
    client: &reqwest::Client,
    semaphore: &Arc<Semaphore>,
    timeout_ms: u64,
) -> Vec<ServiceStatus> {
    let mut set: JoinSet<(usize, ServiceState, Option<u64>)> = JoinSet::new();
    let enabled: Vec<&_> = list.services.iter().filter(|s| s.enabled).collect();

    for (idx, svc) in enabled.iter().enumerate() {
        let permit = Arc::clone(semaphore);
        let client = client.clone();
        let host = svc.host.clone();
        let port = svc.port;
        set.spawn(async move {
            let _guard = permit.acquire().await.expect("semaphore open");
            let (state, latency) = probe_service(&client, &host, port, timeout_ms).await;
            (idx, state, latency)
        });
    }

    // Collect results, then reorder to match the original service order.
    let mut collected: Vec<Option<(ServiceState, Option<u64>)>> = vec![None; enabled.len()];
    while let Some(joined) = set.join_next().await {
        if let Ok((idx, state, latency)) = joined {
            collected[idx] = Some((state, latency));
        }
    }

    enabled
        .iter()
        .enumerate()
        .map(|(idx, svc)| {
            let (state, latency_ms) = collected[idx].unwrap_or((ServiceState::Checking, None));
            ServiceStatus {
                id: svc.id.clone(),
                label: svc.label.clone(),
                host: svc.host.clone(),
                state,
                latency_ms,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn status(state: ServiceState) -> ServiceStatus {
        ServiceStatus {
            id: "x".into(),
            label: "x".into(),
            host: "x".into(),
            state,
            latency_ms: None,
        }
    }

    fn list(states: &[ServiceState]) -> ListStatus {
        let services: Vec<_> = states.iter().copied().map(status).collect();
        ListStatus {
            id: "l".into(),
            name: "l".into(),
            icon: "".into(),
            all_down: compute_all_down(&services),
            services,
            collapsed: false,
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
    fn all_down_needs_every_service_failing() {
        use ServiceState::*;
        assert!(compute_all_down(&[status(Down), status(Blocked)]));
        assert!(!compute_all_down(&[status(Down), status(Up)]));
        assert!(!compute_all_down(&[status(Checking), status(Down)])); // Checking isn't a failure
        assert!(!compute_all_down(&[])); // empty list is not "down"
    }

    #[test]
    fn severity_any_list_down_is_red() {
        use ServiceState::*;
        assert_eq!(overall_severity(&[list(&[Down, Down]), list(&[Up])]), Severity::Red);
        assert_eq!(overall_severity(&[list(&[Up]), list(&[Up])]), Severity::Green);
        assert_eq!(overall_severity(&[list(&[Up])]), Severity::Green);
    }
}
