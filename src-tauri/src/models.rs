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

/// Current config schema version. Bump this (and add a migration step in `store::migrate`)
/// whenever the config shape changes in a way serde cannot handle automatically.
/// Additive fields with `#[serde(default)]` do NOT need a bump — serde fills the default.
pub const CURRENT_SCHEMA: u32 = 1;

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
fn default_false() -> bool {
    false
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
    /// Integer schema version. Absent in configs predating this field → 0 (via serde default).
    /// `store::migrate` runs numbered steps to bring it up to `CURRENT_SCHEMA` on load/import.
    #[serde(default)]
    pub schema_version: u32,
    pub lists: Vec<ServiceList>,
    /// Probe cadence for **critical** lists, in seconds. Floored at the scheduler's
    /// MIN_INTERVAL_SECS. Default 30.
    #[serde(default = "default_critical_interval")]
    pub critical_interval_secs: u64,
    /// Probe cadence for **non-critical** lists, in seconds. Default 60.
    #[serde(default = "default_noncritical_interval")]
    pub noncritical_interval_secs: u64,
    /// TCP-connect timeout per endpoint, in ms. Does **not** bound the HTTPS HEAD that follows,
    /// which has its own `HTTP_TIMEOUT` (5s, `lib.rs`): folding both into this budget would leave
    /// the HEAD ~3s and read slow TLS on filtered links as Blocked (audit B01, kept deliberately).
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
    /// Ordered list of HTTPS plain-text IP providers tried in sequence.
    #[serde(default = "default_ip_providers")]
    pub ip_providers: Vec<String>,
    // Alert settings — separate per direction (down = outage, up = recovery).
    /// Native notification on a critical-list outage. Default on.
    #[serde(default = "default_true")]
    pub down_notify: bool,
    /// Sound on a critical-list outage. Default on.
    #[serde(default = "default_true")]
    pub down_sound: bool,
    /// Native notification on a critical-list recovery. Default off.
    #[serde(default = "default_false")]
    pub up_notify: bool,
    /// Sound on a critical-list recovery. Default on.
    #[serde(default = "default_true")]
    pub up_sound: bool,
    /// Native notification when a critical list goes fully blocked (every endpoint
    /// is `Blocked` = whole-list TLS interception / filtering). Default on.
    /// Additive field — older configs load with `blocked_notify = true` via serde default.
    #[serde(default = "default_true")]
    pub blocked_notify: bool,
    /// Sound on a critical-list fully-blocked alert. Reuses the down sound asset.
    /// Default on. Additive — older configs load with `blocked_sound = true`.
    #[serde(default = "default_true")]
    pub blocked_sound: bool,
    /// One output level for every alert sound the app plays, as a percent `0..=100`
    /// in steps of 1, `0` = muted. Independent of the three `*_sound` flags: they say
    /// *which* directions make a sound, this says how loud (ADR-0028). Only attenuates
    /// our own sound assets — the native OS banners (`*_notify`) carry no app-controlled audio.
    /// Additive — older configs load with `notify_volume = 100` via serde default.
    #[serde(default = "default_volume")]
    pub notify_volume: u8,
    /// Hide the Dock icon — run as a tray/menu-bar-only app. macOS only; default off.
    #[serde(default)]
    pub hide_dock: bool,
    /// How the status is drawn, by the in-app orb and the menu-bar icon alike (ADR-0044).
    /// Additive — older configs load as `Pulse` via serde default.
    #[serde(default)]
    pub status_icon: StatusIcon,
    /// Menu bar only: cut the status icon out of a filled rounded square instead of drawing it
    /// bare. Additive — older configs load as filled (`true`).
    #[serde(default = "default_tray_filled")]
    pub tray_filled: bool,
    /// Which picture the menu-bar icon draws: its own, or the in-app status icon's (ADR-0048).
    /// Additive — older configs load as `Same`, which is what they did before.
    #[serde(default)]
    pub tray_shape: TrayShape,
    /// Last app version we showed the "What's new" changelog for. On startup, if the
    /// running version differs, we show that version's CHANGELOG section once and update
    /// this. None = fresh install (we record the version but don't show notes).
    #[serde(default)]
    pub last_changelog_version: Option<String>,
}

fn default_tray_filled() -> bool {
    true
}
fn default_critical_interval() -> u64 {
    30
}
fn default_noncritical_interval() -> u64 {
    60
}
fn default_timeout() -> u64 {
    3000
}
fn default_volume() -> u8 {
    100
}

/// Clamp a volume percent to `0..=100`. The slider step is 1, so every in-range value is
/// legal and the only job left is rejecting a hand-edited `101..=255`.
pub fn clamp_volume(v: u8) -> u8 {
    v.min(100)
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
        let mut global = ServiceList::new(
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
                        Endpoint::new("*.api5.cursor.sh", 443),
                        Endpoint::new("repo42.cursor.sh", 443),
                        Endpoint::new("*.authentication.cursor.sh", 443),
                        Endpoint::new("authenticator.cursor.sh", 443),
                        Endpoint::new("marketplace.cursorapi.com", 443),
                        Endpoint::new("cursor-cdn.com", 443),
                        Endpoint::new("downloads.cursor.com", 443),
                    ],
                ),
            ],
        );
        let iran = ServiceList::new(
            "Iran",
            "🇮🇷",
            vec![
                Service::new("Torob", "torob.ir"),
                Service::new("Divar", "divar.ir"),
                Service::new("Digikala", "digikala.com"),
                Service::new("Snapp", "snapp.ir"),
            ],
        );
        global.critical = true;
        Config {
            schema_version: CURRENT_SCHEMA,
            lists: vec![global, iran],
            critical_interval_secs: default_critical_interval(),
            noncritical_interval_secs: default_noncritical_interval(),
            timeout_ms: default_timeout(),
            ip_providers: default_ip_providers(),
            down_notify: true,
            down_sound: true,
            up_notify: false,
            up_sound: true,
            blocked_notify: true,
            blocked_sound: true,
            notify_volume: 100,
            hide_dock: false,
            status_icon: StatusIcon::default(),
            tray_filled: default_tray_filled(),
            tray_shape: TrayShape::default(),
            last_changelog_version: None,
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
    /// Up: TCP connected and the server answered an HTTPS request.
    Up,
    /// Reachable (TCP only): TCP connected, but the HTTPS layer was *not* checked.
    /// Used for wildcard endpoints, where a synthesised random subdomain almost always
    /// fails TLS (no matching cert) even though the zone is reachable — so probing TLS
    /// would falsely read as Blocked. We confirm TCP and stop. No latency is recorded.
    Reachable,
    /// TCP connected but the TLS/HTTP layer failed — likely interception.
    Blocked,
    /// No route: DNS/TCP failed or timed out.
    Down,
    /// Probe in flight / not yet measured.
    Checking,
}

impl ServiceState {
    /// Display priority for worst-wins rollup: higher = shown.
    /// down(4) > blocked(3) > checking(2) > up(1) > reachable(0)
    /// Failures and Checking dominate as usual. Among settled non-failures, `up` beats
    /// `reachable`: a single fully-verified HTTPS endpoint promotes the Service dot to
    /// green — the blue (TCP-only wildcard) dot shows only when *every* endpoint is
    /// reachable-but-unverified.
    fn rank(self) -> u8 {
        match self {
            ServiceState::Reachable => 0,
            ServiceState::Up => 1,
            ServiceState::Checking => 2,
            ServiceState::Blocked => 3,
            ServiceState::Down => 4,
        }
    }
}

/// True when a set of endpoints is disconnected: none is verified `Up`, none is still `Checking`,
/// and at least one is `Blocked` or `Down`. A TCP-only `Reachable` counts for neither side:
/// filtering lets TCP through and breaks TLS, so a connect proves nothing about being cut off
/// (ADR-0048). The one rule behind a Service's `fully_failing`, a List's `all_down` and cut-off.
pub fn disconnected(states: impl IntoIterator<Item = ServiceState>) -> bool {
    let mut any_failing = false;
    for s in states {
        match s {
            ServiceState::Up | ServiceState::Checking => return false,
            ServiceState::Blocked | ServiceState::Down => any_failing = true,
            ServiceState::Reachable => {}
        }
    }
    any_failing
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

/// The picture that carries the status, in the orb and in the menu bar. Both carry the severity
/// by colour and by shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StatusIcon {
    /// Concentric rings (the brand's signal mark).
    Rings,
    /// A canary heartbeat. The default.
    #[default]
    Pulse,
}

/// Which picture the menu-bar icon draws. `Same` follows the in-app `status_icon`, so one choice
/// changes both; `Rings` / `Pulse` fix the menu bar's picture whatever the orb shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrayShape {
    /// Follow the in-app status icon. The default.
    #[default]
    Same,
    Rings,
    Pulse,
}

impl Config {
    /// The menu-bar icon to draw: its picture (its own, or the status icon's) and whether it is
    /// cut out of a filled square.
    pub fn tray_look(&self) -> (StatusIcon, bool) {
        let icon = match self.tray_shape {
            TrayShape::Same => self.status_icon,
            TrayShape::Rings => StatusIcon::Rings,
            TrayShape::Pulse => StatusIcon::Pulse,
        };
        (icon, self.tray_filled)
    }
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
/// A service is "fully failing" only when its endpoints are `disconnected`.
#[derive(Debug, Clone, Serialize)]
pub struct ServiceStatus {
    pub id: String,
    pub label: String,
    pub state: ServiceState,
    pub endpoints: Vec<EndpointStatus>,
}

impl ServiceStatus {
    /// True when the service's endpoints are `disconnected`.
    pub fn fully_failing(&self) -> bool {
        disconnected(self.endpoints.iter().map(|e| e.state))
    }
}

/// A List's `all_down`: its endpoints, across every service, are `disconnected`.
pub fn list_all_down(services: &[ServiceStatus]) -> bool {
    disconnected(services.iter().flat_map(|s| s.endpoints.iter().map(|e| e.state)))
}

/// Per-list status + whether the whole list is down (`list_all_down`).
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
    /// True when no Endpoint anywhere is reachable — see `probe::is_cut_off`. Forces `overall`
    /// to Red and tells the frontend to render the "offline" hero + all-red dots.
    pub cut_off: bool,
    /// True when no Endpoint is still `Checking` — see `probe::is_settled`. The frontend diffs
    /// Transitions only between settled Snapshots; an unsettled one carries placeholder rollups
    /// rather than measurements (ADR-0029).
    pub settled: bool,
}

/// A per-Service push (a **Status delta**): the instant a Service probe task's probe lands it
/// emits this — the Service's new status, its List's recomputed `all_down`, and the new overall
/// Severity. The frontend merges it into its local Snapshot. Mirrored in `src/types.ts`.
#[derive(Debug, Clone, Serialize)]
pub struct ServiceDelta {
    pub list_id: String,
    pub service: ServiceStatus,
    pub list_all_down: bool,
    pub overall: Severity,
    pub cut_off: bool,
    /// Settledness of the whole Snapshot after this delta is merged — see `probe::is_settled`.
    /// Shipped per-delta for the same reason as `cut_off`: only the backend sees every Service.
    pub settled: bool,
}
