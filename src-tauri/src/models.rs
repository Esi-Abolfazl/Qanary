//! Data types shared across the backend.
//!
//! Two groups live here:
//!  - **Persisted** config (`Config`, `ServiceList`, `Service`) — saved to disk as JSON.
//!  - **Runtime** snapshot (`Snapshot`, `ListStatus`, `ServiceStatus`, ...) — computed each probe
//!    cycle and pushed to the UI. Snapshots are never written to disk.
//!
//! The TypeScript side mirrors these in `src/types.ts`. Keep the two in sync.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Persisted config
// ---------------------------------------------------------------------------

/// A single endpoint we probe (one host:port).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Service {
    pub id: String,
    pub label: String,
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_port() -> u16 {
    443
}
fn default_true() -> bool {
    true
}

impl Service {
    /// New HTTPS service (port 443, enabled) with a fresh id.
    pub fn new(label: &str, host: &str) -> Self {
        Service {
            id: Uuid::new_v4().to_string(),
            label: label.to_string(),
            host: host.to_string(),
            port: 443,
            enabled: true,
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
}

impl ServiceList {
    pub fn new(name: &str, icon: &str, services: Vec<Service>) -> Self {
        ServiceList {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            icon: icon.to_string(),
            services,
            collapsed: false,
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
                Service::new("Claude", "claude.ai"),
                Service::new("Telegram", "telegram.org"),
                Service::new("ChatGPT", "chatgpt.com"),
                Service::new("Google", "google.com"),
                Service::new("X", "x.com"),
            ],
        );
        let iran = ServiceList::new(
            "Iran",
            "🇮🇷",
            vec![
                Service::new("Digikala", "digikala.com"),
                Service::new("Torob", "torob.ir"),
                Service::new("Divar", "divar.ir"),
                Service::new("Snapp", "snapp.ir"),
            ],
        );
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

/// Result of probing one service in the latest cycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServiceState {
    /// Reachable: TCP connected and the server answered an HTTPS request.
    Up,
    /// TCP connected but the TLS/HTTP layer failed like interception — likely blocked.
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
}

/// Overall traffic-light severity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Green,
    Red,
}

/// Per-service status for the UI.
#[derive(Debug, Clone, Serialize)]
pub struct ServiceStatus {
    pub id: String,
    pub label: String,
    pub host: String,
    pub state: ServiceState,
    pub latency_ms: Option<u64>,
}

/// Per-list status + whether every enabled service is failing.
#[derive(Debug, Clone, Serialize)]
pub struct ListStatus {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub services: Vec<ServiceStatus>,
    pub all_down: bool,
    pub collapsed: bool,
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
