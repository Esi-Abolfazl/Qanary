//! Shared application state, registered with Tauri via `app.manage(...)` and reachable from any
//! command or the background loop through `app.state::<AppState>()`.
//!
//! All fields use `std::sync::Mutex`. We only ever clone the data out of a lock and drop the guard
//! *before* awaiting, so the locks are never held across an `.await`.

use crate::models::{Config, Snapshot, WanInfo};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppState {
    /// The live, in-memory config. Persisted to `config_path` on every mutation.
    pub config: Mutex<Config>,
    /// Where `config.json` lives (inside the per-app config dir).
    pub config_path: PathBuf,
    /// One reusable HTTP client for all probes and the WAN lookup.
    pub client: reqwest::Client,
    /// Most recent probe snapshot, served to the UI on startup via `get_snapshot`.
    pub snapshot: Mutex<Option<Snapshot>>,
    /// Last known WAN info, refreshed on a slower cadence than probes.
    pub wan: Mutex<Option<WanInfo>>,
}
