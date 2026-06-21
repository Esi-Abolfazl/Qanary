//! Tauri commands — the bridge the React frontend calls via `invoke(...)`.
//!
//! Read commands just clone state out. Mutation commands change the config, persist it, return the
//! updated config immediately, and kick off a fresh probe cycle in the background (so the UI also
//! gets a `status-update` event without the command having to wait for every probe to finish).

use crate::models::{Config, Endpoint, Service, ServiceList, Snapshot};
use crate::state::AppState;
use serde::Deserialize;
use tauri::{AppHandle, Manager, State};

/// Incoming endpoint spec from the frontend (host + optional port).
#[derive(Debug, Deserialize)]
pub struct EndpointDraft {
    pub host: String,
    pub port: Option<u16>,
}

/// Incoming service spec from the frontend (label + one or more endpoints).
#[derive(Debug, Deserialize)]
pub struct ServiceDraft {
    pub label: String,
    pub endpoints: Vec<EndpointDraft>,
}

#[tauri::command]
pub fn get_snapshot(state: State<AppState>) -> Option<Snapshot> {
    state.snapshot.lock().unwrap().clone()
}

#[tauri::command]
pub fn get_config(state: State<AppState>) -> Config {
    state.config.lock().unwrap().clone()
}

/// Probe everything right now (also refreshes WAN) and return the resulting snapshot.
#[tauri::command]
pub async fn refresh_now(app: AppHandle) -> Snapshot {
    crate::emit_checking(&app);
    crate::run_cycle(&app, true).await
}

/// Add one or more services (each with their endpoints) to a list.
/// Replaces the old single-host `add_service` command.
#[tauri::command]
pub fn add_services(app: AppHandle, list_id: String, services: Vec<ServiceDraft>) -> Config {
    mutate(&app, |cfg| {
        if let Some(list) = cfg.lists.iter_mut().find(|l| l.id == list_id) {
            for draft in &services {
                let endpoints: Vec<Endpoint> = draft
                    .endpoints
                    .iter()
                    .filter(|e| !e.host.trim().is_empty())
                    .map(|e| Endpoint::new(e.host.trim(), e.port.unwrap_or(443)))
                    .collect();
                if !endpoints.is_empty() {
                    list.services.push(Service::with_endpoints(&draft.label, endpoints));
                }
            }
        }
    })
}

/// Replace a service's label and endpoints (wholesale edit).
#[tauri::command]
pub fn update_service(
    app: AppHandle,
    list_id: String,
    service_id: String,
    label: String,
    endpoints: Vec<EndpointDraft>,
) -> Config {
    mutate(&app, |cfg| {
        if let Some(list) = cfg.lists.iter_mut().find(|l| l.id == list_id) {
            if let Some(svc) = list.services.iter_mut().find(|s| s.id == service_id) {
                svc.label = label.clone();
                svc.endpoints = endpoints
                    .iter()
                    .filter(|e| !e.host.trim().is_empty())
                    .map(|e| Endpoint::new(e.host.trim(), e.port.unwrap_or(443)))
                    .collect();
            }
        }
    })
}

#[tauri::command]
pub fn remove_service(app: AppHandle, list_id: String, service_id: String) -> Config {
    mutate(&app, |cfg| {
        if let Some(list) = cfg.lists.iter_mut().find(|l| l.id == list_id) {
            list.services.retain(|s| s.id != service_id);
        }
    })
}

#[tauri::command]
pub fn add_list(app: AppHandle, name: String, icon: String, critical: bool) -> Config {
    mutate(&app, |cfg| {
        let mut list = ServiceList::new(&name, &icon, Vec::new());
        list.critical = critical;
        cfg.lists.push(list);
    })
}

/// Update an existing list's display name, icon, and critical flag.
#[tauri::command]
pub fn update_list(app: AppHandle, list_id: String, name: String, icon: String, critical: bool) -> Config {
    mutate(&app, |cfg| {
        if let Some(list) = cfg.lists.iter_mut().find(|l| l.id == list_id) {
            list.name = name.clone();
            list.icon = icon.clone();
            list.critical = critical;
        }
    })
}

/// Wipe the persisted config, seed fresh defaults, re-probe.
#[tauri::command]
pub fn reset_config(app: AppHandle) -> Config {
    let state = app.state::<AppState>();
    let defaults = Config::default();
    *state.config.lock().unwrap() = defaults.clone();
    if let Err(err) = crate::store::save(&state.config_path, &defaults) {
        eprintln!("qanary: failed to save reset config: {err}");
    }
    crate::emit_checking(&app);
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        crate::run_cycle(&handle, true).await;
    });
    defaults
}

#[tauri::command]
pub fn remove_list(app: AppHandle, list_id: String) -> Config {
    mutate(&app, |cfg| {
        cfg.lists.retain(|l| l.id != list_id);
    })
}

#[tauri::command]
pub fn update_settings(
    app: AppHandle,
    probe_interval_secs: Option<u64>,
    timeout_ms: Option<u64>,
    ip_providers: Option<Vec<String>>,
    down_notify: Option<bool>,
    down_sound: Option<bool>,
    up_notify: Option<bool>,
    up_sound: Option<bool>,
) -> Config {
    mutate(&app, |cfg| {
        if let Some(v) = probe_interval_secs {
            cfg.probe_interval_secs = v.max(5); // floor to avoid hammering the network
        }
        if let Some(v) = timeout_ms {
            cfg.timeout_ms = v;
        }
        if let Some(v) = ip_providers {
            let providers: Vec<String> = v
                .into_iter()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            if !providers.is_empty() {
                cfg.ip_providers = providers;
            }
        }
        if let Some(v) = down_notify {
            cfg.down_notify = v;
        }
        if let Some(v) = down_sound {
            cfg.down_sound = v;
        }
        if let Some(v) = up_notify {
            cfg.up_notify = v;
        }
        if let Some(v) = up_sound {
            cfg.up_sound = v;
        }
    })
}

/// Persist the collapsed/expanded state of a list without triggering a network re-probe.
/// Collapse is a pure UI concern — firing a full probe on every chevron click would be wasteful.
#[tauri::command]
pub fn set_list_collapsed(app: AppHandle, list_id: String, collapsed: bool) -> Config {
    let state = app.state::<AppState>();
    let updated = {
        let mut cfg = state.config.lock().unwrap();
        if let Some(list) = cfg.lists.iter_mut().find(|l| l.id == list_id) {
            list.collapsed = collapsed;
        }
        cfg.clone()
    };
    if let Err(err) = crate::store::save(&state.config_path, &updated) {
        eprintln!("qanary: failed to save collapsed state: {err}");
    }
    updated
}

/// Apply `f` to the config under lock, persist the result, trigger a background re-probe, and
/// return the updated config. Centralises the save + re-probe that every mutation needs.
fn mutate<F: FnOnce(&mut Config)>(app: &AppHandle, f: F) -> Config {
    let state = app.state::<AppState>();
    let updated = {
        let mut cfg = state.config.lock().unwrap();
        f(&mut cfg);
        cfg.clone()
    };
    if let Err(err) = crate::store::save(&state.config_path, &updated) {
        eprintln!("qanary: failed to save config: {err}");
    }
    // Show affected services as Checking instantly, then re-probe in the background.
    crate::emit_checking(app);
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        crate::run_cycle(&handle, false).await;
    });
    updated
}
