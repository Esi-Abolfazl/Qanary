//! Qanary backend entrypoint.
//!
//! Wires together: load config → manage shared state → register commands → spawn the background
//! probe loop. The loop runs a cycle, emits a `status-update` event to the UI, then sleeps for the
//! configured interval. WAN info is refreshed less often than connectivity.

mod commands;
mod models;
mod probe;
mod state;
mod store;
mod wan;

use models::Snapshot;
use state::AppState;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager};

/// Event name the frontend subscribes to for live snapshot pushes.
pub const EVENT_STATUS: &str = "status-update";

/// Refresh WAN info every Nth cycle (≈ every 10 probe intervals).
const WAN_REFRESH_EVERY: u64 = 10;

/// Overall HTTP timeout for HEAD probes and the WAN lookup.
const HTTP_TIMEOUT: Duration = Duration::from_secs(5);

/// Run one full probe cycle: probe all services, optionally refresh WAN, store the snapshot, and
/// emit it to the UI. Returns the snapshot so commands like `refresh_now` can hand it straight back.
pub async fn run_cycle(app: &tauri::AppHandle, refresh_wan: bool) -> Snapshot {
    let state = app.state::<AppState>();

    // Clone config + client out of the lock before any await.
    let config = state.config.lock().unwrap().clone();
    let client = state.client.clone();

    let lists = probe::probe_all(&config, &client).await;
    let overall = probe::overall_severity(&lists);

    if refresh_wan {
        if let Some(info) = wan::fetch_wan(&client, &config.ip_providers).await {
            *state.wan.lock().unwrap() = Some(info);
        }
    }
    let wan = state.wan.lock().unwrap().clone();

    let snapshot = Snapshot {
        lists,
        overall,
        wan,
    };

    *state.snapshot.lock().unwrap() = Some(snapshot.clone());
    let _ = app.emit(EVENT_STATUS, &snapshot);
    snapshot
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Config path inside the per-app config dir (created on first save).
            let config_path = app
                .path()
                .app_config_dir()
                .expect("resolve app config dir")
                .join("config.json");
            let config = store::load(&config_path);

            // Persist on first run so the seeded config.json exists and is hand-editable.
            if !config_path.exists() {
                if let Err(err) = store::save(&config_path, &config) {
                    eprintln!("qanary: failed to write initial config: {err}");
                }
            }

            let client = reqwest::Client::builder()
                .timeout(HTTP_TIMEOUT)
                .user_agent(concat!("Qanary/", env!("CARGO_PKG_VERSION")))
                .build()
                .expect("build HTTP client");

            app.manage(AppState {
                config: Mutex::new(config),
                config_path,
                client,
                snapshot: Mutex::new(None),
                wan: Mutex::new(None),
            });

            // Background probe loop.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut tick: u64 = 0;
                loop {
                    let interval = handle
                        .state::<AppState>()
                        .config
                        .lock()
                        .unwrap()
                        .probe_interval_secs
                        .max(5);

                    // Refresh WAN on schedule, but also retry every cycle while still unknown.
                    let wan_known = handle.state::<AppState>().wan.lock().unwrap().is_some();
                    run_cycle(&handle, !wan_known || tick % WAN_REFRESH_EVERY == 0).await;

                    tokio::time::sleep(Duration::from_secs(interval)).await;
                    tick = tick.wrapping_add(1);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_snapshot,
            commands::get_config,
            commands::refresh_now,
            commands::add_service,
            commands::remove_service,
            commands::add_list,
            commands::update_list,
            commands::remove_list,
            commands::reset_config,
            commands::update_settings,
            commands::set_list_collapsed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
