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
mod tray;
mod wan;

use models::{Snapshot};
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
    // ponytail: set every cycle; no last-severity diffing — rebuild cost is negligible.
    tray::update_icon(app, overall);
    snapshot
}

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

            app.manage(AppState {
                config: Mutex::new(config),
                config_path,
                client,
                snapshot: Mutex::new(None),
                wan: Mutex::new(None),
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
            // instead of the "Starting first probe…" placeholder.
            emit_checking(app.handle());

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
