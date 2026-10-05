//! Shared application state, registered with Tauri via `app.manage(...)` and reachable from any
//! command or the background loop through `app.state::<AppState>()`.
//!
//! All fields use `std::sync::Mutex`. We only ever clone the data out of a lock and drop the guard
//! *before* awaiting, so the locks are never held across an `.await`. (`commands::commit` holds
//! the config lock across a blocking file save on purpose, so disk order = memory order.)

use crate::models::{Config, Snapshot, WanInfo};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex};
use tauri::async_runtime::JoinHandle;
use tokio::sync::{broadcast, Notify, Semaphore};

pub struct AppState {
    /// The live, in-memory config. Persisted to `config_path` on every mutation.
    pub config: Mutex<Config>,
    /// Where `config.json` lives (inside the per-app config dir).
    pub config_path: PathBuf,
    /// HTTP client for probe HEADs. Never follows redirects: any HTTPS answer (a 3xx included)
    /// proves the host is reachable, and following it could land on a filtered host and read as
    /// Blocked (audit A08).
    /// ponytail: no automated test — proving it needs a local TLS server; the policy is one line
    /// in `lib.rs`. Add an integration test if probe HTTP handling grows.
    pub probe_client: reqwest::Client,
    /// HTTP client for the WAN lookup; follows redirects (IP providers may redirect).
    pub wan_client: reqwest::Client,
    /// Most recent probe snapshot, served to the UI on startup via `get_snapshot`.
    pub snapshot: Mutex<Option<Snapshot>>,
    /// Last known WAN info, refreshed on a slower cadence than probes.
    pub wan: Mutex<Option<WanInfo>>,
    /// Shared concurrency cap: every Service probe task acquires endpoint permits here, so N
    /// tasks can't open N×endpoints sockets at once.
    pub probe_sem: Arc<Semaphore>,
    /// "Probe now" fan-out: every Service probe task (and the WAN task) is subscribed and wakes
    /// immediately. Broadcast = one sender, many receivers.
    pub probe_now: broadcast::Sender<()>,
    /// Handles to the live Service probe tasks. The supervisor aborts these before respawning, so
    /// a config change replaces the whole task set without leaking the old ones.
    pub tasks: Mutex<Vec<JoinHandle<()>>>,
    /// Bumped by every `respawn_tasks`. A probe result from an older generation is dropped:
    /// `abort()` only lands at an await, so a task already past its probe could otherwise
    /// overwrite the fresh Checking snapshot with a result for the old config.
    pub generation: AtomicU64,
    /// Sites known to block this IP (ADR-0051). Cleared when the IP or the network changes or the
    /// internet drops, so a block is asked about once, not on every refresh.
    pub block_memory: crate::probe::BlockMemory,
    /// Whether the last snapshot was cut off; the memory is cleared on the way in.
    pub was_cut_off: AtomicBool,
    /// Wakes the WAN task early, e.g. when the IP providers change.
    pub wan_now: Notify,
    /// Set at startup when `config.json` was unusable and moved aside; taken once by the UI.
    pub load_warning: Mutex<Option<String>>,
}
