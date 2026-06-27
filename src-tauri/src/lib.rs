//! Qanary backend entrypoint.
//!
//! Wires together: load config → manage shared state → register commands → spawn one Service probe
//! task per enabled Service plus a WAN task. Each Service task probes on its own cadence and pushes
//! a `service-update` delta as its probe lands; the WAN task refreshes WAN and pushes a full
//! `status-update`. See `scheduler.rs`.

mod commands;
mod models;
mod netwatch;
mod probe;
mod scheduler;
mod state;
mod store;
mod tray;
mod wan;

use models::Snapshot;
use state::AppState;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager};

/// Event name the frontend subscribes to for live snapshot pushes.
pub const EVENT_STATUS: &str = "status-update";

/// Event name for a per-Service Status delta (one Service's status + its List's recomputed
/// `all_down` + the new overall Severity). The frontend merges it into its local snapshot.
pub const EVENT_SERVICE: &str = "service-update";

/// Overall HTTP timeout for HEAD probes and the WAN lookup.
const HTTP_TIMEOUT: Duration = Duration::from_secs(5);

/// Emit a synthetic snapshot with all services in `Checking` state and store it.
/// Sync (no probing). Used to give instant visual feedback before a background probe resolves.
pub fn emit_checking(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let cfg = state.config.lock().unwrap().clone();
    let wan = state.wan.lock().unwrap().clone();
    let snapshot = Snapshot {
        lists: probe::checking_lists(&cfg),
        overall: models::Severity::Green,
        wan,
    };
    *state.snapshot.lock().unwrap() = Some(snapshot.clone());
    let _ = app.emit(EVENT_STATUS, &snapshot);
    // Checking = busy: show the brand-yellow dot, matching the status button's qbreathe.
    tray::update_checking(app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        // Launch-on-login: register as a macOS LaunchAgent; inject --hidden so autostart
        // launches into the tray without showing the main window.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_dialog::init())
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

            // Snapshot the flags we need before moving `config` into the managed state.
            let hide_dock = config.hide_dock;

            // Broadcast channel for the "probe now" signal. Capacity 1 is enough: a missed
            // value just means a task was mid-probe, which is exactly when we don't need to wake it.
            let (probe_now, _) = tokio::sync::broadcast::channel(1);

            app.manage(AppState {
                config: Mutex::new(config),
                config_path,
                client,
                snapshot: Mutex::new(None),
                wan: Mutex::new(None),
                probe_sem: std::sync::Arc::new(tokio::sync::Semaphore::new(probe::MAX_CONCURRENT)),
                probe_now,
                tasks: Mutex::new(Vec::new()),
            });

            // macOS only: suppress the Dock icon when the user opted into tray-only mode.
            #[cfg(target_os = "macos")]
            if hide_dock {
                let _ = app.handle().set_activation_policy(tauri::ActivationPolicy::Accessory);
            }

            // Autostart launches with --hidden: keep the window hidden (tray-only start).
            if std::env::args().any(|a| a == "--hidden") {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.hide();
                }
            }

            // Build the tray icon before emit_checking so update_icon finds the handle.
            tray::build_tray(app.handle())?;

            // Emit a checking snapshot immediately so the UI shows lists on first paint
            // instead of the "Starting first probe…" placeholder. Seeds AppState.snapshot, which
            // the Service probe tasks then fill in via deltas.
            emit_checking(app.handle());

            // Spawn one Service probe task per enabled Service, plus the WAN task.
            scheduler::respawn_tasks(app.handle());
            scheduler::spawn_wan_task(app.handle());

            // Spawn the network-change watcher: fires probe_now on wifi/ethernet/VPN changes.
            netwatch::spawn_netwatch_task(app.handle());

            Ok(())
        })
        // Close-to-tray: intercept the close button and hide instead of quit.
        // The probe loop keeps running. Quit remains available via the tray menu.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_snapshot,
            commands::get_config,
            commands::refresh_now,
            commands::add_services,
            commands::update_service,
            commands::remove_service,
            commands::add_list,
            commands::update_list,
            commands::remove_list,
            commands::reset_config,
            commands::update_settings,
            commands::set_list_collapsed,
            commands::reorder_lists,
            commands::reorder_services,
            commands::set_hide_dock,
            commands::take_new_changelog,
            commands::get_changelog,
            commands::export_config,
            commands::import_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
