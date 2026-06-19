//! Data types shared across the backend.
//!
//! Two groups live here:
//!  - **Persisted** config (`Config`, `ServiceList`, `Service`, `Endpoint`) — saved to disk as JSON.
//!  - **Runtime** snapshot (`Snapshot`, `ListStatus`, `ServiceStatus`, `EndpointStatus`) — computed
//!    each probe cycle and pushed to the UI. Snapshots are never written to disk.
//!
//! The TypeScript side mirrors these in `src/types.ts`. Keep the two in sync.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Persisted config
// ---------------------------------------------------------------------------

/// One host:port pair belonging to a Service.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Endpoint {
    pub id: String,
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
}

impl Endpoint {
    pub fn new(host: &str, port: u16) -> Self {
        Endpoint {
            id: Uuid::new_v4().to_string(),
            host: host.to_string(),
            port,
        }
    }
}

/// A named service with one or more endpoints to probe.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Service {
    pub id: String,
    pub label: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub endpoints: Vec<Endpoint>,

    // Legacy fields — only present in old configs written before the multi-endpoint
    // model. Folded into `endpoints` by `store::migrate_legacy` on first load, then
    // cleared. `skip_serializing` ensures they vanish from new writes.
    #[serde(default, skip_serializing)]
    pub host: Option<String>,
    #[serde(default, skip_serializing)]
    pub port: Option<u16>,
}

fn default_port() -> u16 {
    443
}
fn default_true() -> bool {
    true
}

impl Service {
    /// New HTTPS service (port 443, enabled) with a single endpoint and a fresh id.
    pub fn new(label: &str, host: &str) -> Self {
        Service {
            id: Uuid::new_v4().to_string(),
            label: label.to_string(),
            enabled: true,
            endpoints: vec![Endpoint::new(host, 443)],
            host: None,
            port: None,
        }
    }

    /// New service with an explicit endpoint list.
    pub fn with_endpoints(label: &str, endpoints: Vec<Endpoint>) -> Self {
        Service {
            id: Uuid::new_v4().to_string(),
            label: label.to_string(),
            enabled: true,
            endpoints,
            host: None,
            port: None,
        }
    }
}

/// A named group of services.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceList {
    pub id: String,
    pub name: String,
    /// Emoji icon shown before the list name in the UI.
    #[serde(default)]
    pub icon: String,
    pub services: Vec<Service>,
    /// Whether the list is collapsed in the UI. Persisted so it survives restarts.
    #[serde(default)]
    pub collapsed: bool,
    /// When true, this list going fully down raises a Red alarm. Non-critical lists raise Yellow.
    #[serde(default)]
    pub critical: bool,
}

impl ServiceList {
    pub fn new(name: &str, icon: &str, services: Vec<Service>) -> Self {
        ServiceList {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            icon: icon.to_string(),
            services,
            collapsed: false,
            critical: false,
        }
    }
}

/// Everything persisted to `config.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub lists: Vec<ServiceList>,
    #[serde(default = "default_interval")]
    pub probe_interval_secs: u64,
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
    /// Ordered list of HTTPS plain-text IP providers tried in sequence.
    #[serde(default = "default_ip_providers")]
    pub ip_providers: Vec<String>,
}

fn default_interval() -> u64 {
    30
}
fn default_timeout() -> u64 {
    3000
}
fn default_ip_providers() -> Vec<String> {
    // Stored without scheme; fetch_wan prepends https:// at call time.
    vec![
        "ip.shecan.ir".into(),
        "ifconfig.me/ip".into(),
        "api.ipify.org".into(),
        "ipify.ir".into(),
    ]
}

impl Default for Config {
    /// First-run seed.
    fn default() -> Self {
        let global = ServiceList::new(
            "Global",
            "🌍",
            vec![
                Service::new("Google", "google.com"),
                Service::new("Telegram", "telegram.org"),
                Service::new("X", "x.com"),
                Service::with_endpoints(
                    "Claude",
                    vec![
                        Endpoint::new("claude.ai", 443),
                        Endpoint::new("platform.claude.com", 443),
                        Endpoint::new("api.anthropic.com", 443),
                    ],
                ),
                Service::new("ChatGPT", "chatgpt.com"),
                Service::with_endpoints(
                    "Cursor",
                    vec![
                        Endpoint::new("cursor.com", 443),
                        Endpoint::new("api2.cursor.sh", 443),
                        Endpoint::new("api3.cursor.sh", 443),
                        Endpoint::new("api4.cursor.sh", 443),
                        Endpoint::new("api5.cursor.sh", 443),
                        Endpoint::new("repo42.cursor.sh", 443),
                        Endpoint::new("authentication.cursor.sh", 443),
                        Endpoint::new("authenticator.cursor.sh", 443),
                        Endpoint::new("marketplace.cursorapi.com", 443),
                        Endpoint::new("cursor-cdn.com", 443),
                        Endpoint::new("downloads.cursor.com", 443),
                    ],
                ),
            ],
        );
        let mut iran = ServiceList::new(
            "Iran",
            "🇮🇷",
            vec![
                Service::new("Torob", "torob.ir"),
                Service::new("Divar", "divar.ir"),
                Service::new("Digikala", "digikala.com"),
                Service::new("Snapp", "snapp.ir"),
            ],
        );
        iran.critical = true;
        Config {
            lists: vec![global, iran],
            probe_interval_secs: default_interval(),
            timeout_ms: default_timeout(),
            ip_providers: default_ip_providers(),
        }
    }
}

// ---------------------------------------------------------------------------
// Runtime snapshot (computed, not persisted)
// ---------------------------------------------------------------------------

/// Result of probing one endpoint in the latest cycle.
/// Also used as the worst-wins rollup state for the whole Service dot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServiceState {
    /// Reachable: TCP connected and the server answered an HTTPS request.
    Up,
    /// TCP connected but the TLS/HTTP layer failed — likely interception.
    Blocked,
    /// No route: DNS/TCP failed or timed out.
    Down,
    /// Probe in flight / not yet measured.
    Checking,
}

impl ServiceState {
    /// `true` for any state that means "can't reach it" (Blocked or Down).
    /// `Checking` is treated as not-yet-failed so we don't flash an outage on startup.
    pub fn is_failure(self) -> bool {
        matches!(self, ServiceState::Blocked | ServiceState::Down)
    }

    /// Numeric rank for worst-wins comparison: higher = worse.
    /// down(3) > blocked(2) > checking(1) > up(0)
    fn rank(self) -> u8 {
        match self {
            ServiceState::Up => 0,
            ServiceState::Checking => 1,
            ServiceState::Blocked => 2,
            ServiceState::Down => 3,
        }
    }
}

/// Worst-wins rollup over a slice of endpoint states.
/// Empty slice → Checking (no data yet).
pub fn worst_state(states: &[ServiceState]) -> ServiceState {
    states
        .iter()
        .copied()
        .max_by_key(|s| s.rank())
        .unwrap_or(ServiceState::Checking)
}

/// Overall traffic-light severity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Green,
    /// A non-critical list went fully down — warn but don't alarm.
    Yellow,
    /// A critical list went fully down — full alarm.
    Red,
}

/// Per-endpoint status for the UI.
#[derive(Debug, Clone, Serialize)]
pub struct EndpointStatus {
    pub id: String,
    pub host: String,
    pub state: ServiceState,
    pub latency_ms: Option<u64>,
}

/// Per-service status for the UI.
/// `state` = worst-wins across all endpoints.
/// A service is "fully failing" only when ALL endpoints are failing — that feeds `all_down`.
#[derive(Debug, Clone, Serialize)]
pub struct ServiceStatus {
    pub id: String,
    pub label: String,
    pub state: ServiceState,
    pub endpoints: Vec<EndpointStatus>,
}

impl ServiceStatus {
    /// True when the service has endpoints and every one of them is failing.
    pub fn fully_failing(&self) -> bool {
        !self.endpoints.is_empty() && self.endpoints.iter().all(|e| e.state.is_failure())
    }
}

/// Per-list status + whether every enabled service is fully failing.
#[derive(Debug, Clone, Serialize)]
pub struct ListStatus {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub services: Vec<ServiceStatus>,
    pub all_down: bool,
    pub collapsed: bool,
    pub critical: bool,
}

/// WAN IP + geolocation for the header.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WanInfo {
    pub ip: String,
    pub country_code: String,
    pub country_name: String,
    pub flag_emoji: String,
}

/// Full picture pushed to the UI each cycle (and on demand).
#[derive(Debug, Clone, Serialize)]
pub struct Snapshot {
    pub lists: Vec<ListStatus>,
    pub overall: Severity,
    pub wan: Option<WanInfo>,
}
