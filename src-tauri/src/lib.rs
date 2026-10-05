//! Qanary backend entrypoint.
//!
//! Wires together: load config → manage shared state → register commands → spawn one Service probe
//! task per enabled Service plus a WAN task. Each Service task probes on its own cadence and pushes
//! a `service-update` delta as its probe lands; the WAN task refreshes WAN and pushes a full
//! `status-update`. See `scheduler.rs`.

#[cfg(target_os = "macos")]
mod app_menu;
mod commands;
mod models;
mod netwatch;
mod probe;
mod scheduler;
mod state;
mod store;
mod tray;
mod tray_menu;
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

/// Overall HTTP timeout for HEAD probes and the WAN lookup. Separate from `Config::timeout_ms`,
/// which only bounds the TCP connect — see that field for why.
const HTTP_TIMEOUT: Duration = Duration::from_secs(5);

/// Emit a synthetic snapshot with all services in `Checking` state and store it.
/// Sync (no probing). Used to give instant visual feedback before a background probe resolves.
///
/// Every snapshot emit happens while holding the snapshot lock, so events leave in the same order
/// the snapshot changed — a later state can never be overtaken by an earlier one.
pub fn emit_checking(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let cfg = state.config.lock().unwrap().clone();
    let wan = state.wan.lock().unwrap().clone();
    let lists = probe::checking_lists(&cfg);
    let snapshot = Snapshot {
        // Computed, not hard-coded false: `checking_lists` is the only input, so there is one
        // source of truth for "is this settled" rather than two that can drift.
        settled: probe::is_settled(&lists),
        lists,
        overall: models::Severity::Green,
        wan,
        cut_off: false, // checking state is never cut-off — nothing has settled yet
    };
    {
        let mut guard = state.snapshot.lock().unwrap();
        let _ = app.emit(EVENT_STATUS, &snapshot);
        *guard = Some(snapshot);
    }
    // Checking = busy: show the brand-yellow dot, matching the status button's qbreathe.
    tray::update_checking(app);
}

/// Apply the config's presentation (order, collapse, name, icon, criticality) to the live snapshot
/// and push it, keeping every probe status. Used by reorder/collapse, which don't re-probe.
pub fn emit_layout(app: &tauri::AppHandle, cfg: &models::Config) {
    let state = app.state::<AppState>();
    {
        let mut guard = state.snapshot.lock().unwrap();
        if let Some(snap) = guard.as_mut() {
            probe::sync_layout(snap, cfg);
            let _ = app.emit(EVENT_STATUS, &*snap);
        }
    }
    // Order, names and criticality changed: the tray menu lists them too (lock already released).
    tray::refresh_menu(app);
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
            let (config, load_warning) = store::load(&config_path);

            // Persist on first run so the seeded config.json exists and is hand-editable.
            if !config_path.exists() {
                if let Err(err) = store::save(&config_path, &config) {
                    eprintln!("qanary: failed to write initial config: {err}");
                }
            }

            // No idle keep-alive: every probe HEAD / WAN GET opens a fresh connection over the
            // *current* route, so a post-VPN/network-change request can't reuse a socket still
            // bound to the old interface (ADR-0025).
            let http = || {
                reqwest::Client::builder()
                    .timeout(HTTP_TIMEOUT)
                    .user_agent(concat!("Qanary/", env!("CARGO_PKG_VERSION")))
                    .pool_max_idle_per_host(0)
            };
            let probe_client = http()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .expect("build probe HTTP client");
            let wan_client = http().build().expect("build WAN HTTP client");

            // Snapshot the flags we need before moving `config` into the managed state.
            let hide_dock = config.hide_dock;
            let (status_icon, tray_filled) = config.tray_look();

            // Broadcast channel for the "probe now" signal. Capacity 1 is enough: a missed
            // value just means a task was mid-probe, which is exactly when we don't need to wake it.
            let (probe_now, _) = tokio::sync::broadcast::channel(1);

            app.manage(AppState {
                config: Mutex::new(config),
                config_path,
                probe_client,
                wan_client,
                snapshot: Mutex::new(None),
                wan: Mutex::new(None),
                probe_sem: std::sync::Arc::new(tokio::sync::Semaphore::new(probe::MAX_CONCURRENT)),
                probe_now,
                tasks: Mutex::new(Vec::new()),
                generation: std::sync::atomic::AtomicU64::new(0),
                wan_now: tokio::sync::Notify::new(),
                load_warning: Mutex::new(load_warning),
            });

            // macOS only: suppress the Dock icon when the user opted into tray-only mode.
            if hide_dock {
                commands::apply_dock_policy(app.handle(), true);
            }

            // Autostart launches with --hidden: keep the window hidden (tray-only start).
            if std::env::args().any(|a| a == "--hidden") {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.hide();
                }
            }

            // Build the tray icon before emit_checking so update_icon finds the handle.
            tray::init_style(status_icon, tray_filled);
            tray::build_tray(app.handle())?;
            // ponytail: macOS only; Windows/Linux would put a menu bar inside the window, which
            // the Glass design has no room for. Revisit with the Windows port.
            #[cfg(target_os = "macos")]
            app_menu::build(app.handle())?;

            // Paint a checking snapshot (so the UI shows lists on first paint instead of the
            // "Starting first probe…" placeholder) and spawn one Service probe task per enabled
            // Service — `respawn_tasks` does both, in the order that makes stale results impossible.
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
            commands::check_now,
            commands::check_list,
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
            commands::take_new_changelog,
            commands::get_changelog,
            commands::export_config,
            commands::import_config,
            commands::take_load_warning,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
