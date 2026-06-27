//! Tauri commands — the bridge the React frontend calls via `invoke(...)`.
//!
//! Read commands just clone state out. Mutation commands change the config, persist it, return the
//! updated config immediately, and kick off a fresh probe cycle in the background (so the UI also
//! gets a `status-update` event without the command having to wait for every probe to finish).

use crate::models::{Config, Endpoint, Service, ServiceList, Snapshot};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

/// Release notes baked into the binary at build time — no resource bundling, no runtime IO.
const CHANGELOG: &str = include_str!("../../CHANGELOG.md");

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

/// Probe everything right now: paint Checking, fire the "probe now" broadcast so every Service
/// probe task (and the WAN task) wakes immediately, and return the current (checking) snapshot.
/// Deltas then stream in as each probe lands.
#[tauri::command]
pub fn refresh_now(app: AppHandle) -> Snapshot {
    crate::emit_checking(&app); // seeds AppState.snapshot with a Checking snapshot
    let state = app.state::<AppState>();
    let _ = state.probe_now.send(()); // Err just means no subscribers yet — harmless
    let snapshot = state.snapshot.lock().unwrap().clone();
    snapshot.expect("emit_checking just set the snapshot")
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
    crate::scheduler::respawn_tasks(&app);
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
    critical_interval_secs: Option<u64>,
    noncritical_interval_secs: Option<u64>,
    timeout_ms: Option<u64>,
    ip_providers: Option<Vec<String>>,
    down_notify: Option<bool>,
    down_sound: Option<bool>,
    up_notify: Option<bool>,
    up_sound: Option<bool>,
) -> Config {
    mutate(&app, |cfg| {
        if let Some(v) = critical_interval_secs {
            cfg.critical_interval_secs = v.max(10); // floor to avoid hammering the network
        }
        if let Some(v) = noncritical_interval_secs {
            cfg.noncritical_interval_secs = v.max(10);
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

/// Release notes for the modal: the CHANGELOG section plus the version it belongs to.
#[derive(Debug, Serialize)]
pub struct ChangelogPayload {
    pub version: String,
    pub body: String,
    /// True only for the trailing anchor card = the version the user was on before this update.
    /// The modal shows it collapsed with a "Your previous version" marker so everything above
    /// it reads as "new since your version". Always false from `get_changelog`.
    #[serde(rename = "isPrevious")]
    pub is_previous: bool,
}

/// Parse every `## [version]` block in the changelog (newest-first), apply `modal_notes`
/// to strip dev-only subsections, and return entries with non-empty bodies.
fn changelog_entries(changelog: &str) -> Vec<ChangelogPayload> {
    // Collect the starting line index of each `## [version]` heading.
    let lines: Vec<&str> = changelog.lines().collect();
    let mut starts: Vec<usize> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if line.starts_with("## [") {
            starts.push(i);
        }
    }
    let mut entries = Vec::new();
    for (idx, &start) in starts.iter().enumerate() {
        // Extract the version from the heading: `## [1.2.3]` or `## [1.2.3] - date`.
        let heading = lines[start];
        let version = heading
            .strip_prefix("## [")
            .and_then(|s| s.split(']').next())
            .unwrap_or("")
            .to_string();
        if version.is_empty() {
            continue;
        }
        // Body = lines between this heading and the next `## [` heading (exclusive).
        let end = starts.get(idx + 1).copied().unwrap_or(lines.len());
        let body_raw = lines[start + 1..end].join("\n").trim_matches('\n').to_string();
        let body = modal_notes(&body_raw);
        if !body.trim().is_empty() {
            entries.push(ChangelogPayload { version, body, is_previous: false });
        }
    }
    entries
}

/// From all entries (newest-first), return everything released since `last` (the user's previous
/// version) plus the `last` entry itself as a trailing anchor flagged `is_previous`. When `last`
/// is absent from the list (older than the oldest entry, or its notes were filtered out), returns
/// all entries with no anchor.
fn entries_since(all: Vec<ChangelogPayload>, last: &str) -> Vec<ChangelogPayload> {
    let mut out = Vec::new();
    for mut e in all {
        if e.version == last {
            e.is_previous = true;
            out.push(e);
            break;
        }
        out.push(e);
    }
    out
}

/// Called once on startup. Returns the CHANGELOG entries released since the user last saw
/// notes (i.e. everything above `last_changelog_version` in the file, newest-first). Returns
/// an empty list when:
///   - already shown for this version (short-circuit, no re-save), or
///   - fresh install / `last_changelog_version` not found in CHANGELOG (quiet first launch).
///
/// Records the running version as last-seen so the modal shows only once per version.
#[tauri::command]
pub fn take_new_changelog(app: AppHandle) -> Vec<ChangelogPayload> {
    let running = app.package_info().version.to_string();
    let state = app.state::<AppState>();

    let last_seen = {
        let mut cfg = state.config.lock().unwrap();
        if cfg.last_changelog_version.as_deref() == Some(running.as_str()) {
            return Vec::new(); // already shown for this version
        }
        let prev = cfg.last_changelog_version.clone();
        cfg.last_changelog_version = Some(running.clone());
        prev
    };
    // Persist the new last-seen version.
    let to_save = state.config.lock().unwrap().clone();
    if let Err(err) = crate::store::save(&state.config_path, &to_save) {
        eprintln!("qanary: failed to save last_changelog_version: {err}");
    }

    let all = changelog_entries(CHANGELOG);

    // Fresh install or last-seen version absent from file → quiet (no auto-modal).
    // The user can always open the full changelog from Settings.
    let last = match last_seen {
        None => return Vec::new(),
        Some(v) => v,
    };
    // Entries newer than last_seen, plus last_seen itself as the "your previous version" anchor.
    entries_since(all, &last)
}

/// Returns all CHANGELOG entries, newest-first, for the manual "Release notes" button in
/// Settings. Does not touch `last_changelog_version`.
#[tauri::command]
pub fn get_changelog(_app: AppHandle) -> Vec<ChangelogPayload> {
    changelog_entries(CHANGELOG)
}

/// Subsection headings that are dev-log only — added to CHANGELOG.md for the GitHub release
/// page but hidden from the in-app modal. Add a heading here to keep its section out of the modal.
const DEV_ONLY_HEADINGS: &[&str] =
    &["internal", "dev", "development", "chore", "ci", "build", "more info"];

/// Strip notes that are only meant for the GitHub release page — any dev-only subsection
/// ([`DEV_ONLY_HEADINGS`]) — so the in-app modal shows only user-facing changes. The GitHub
/// release body (awk extractor in release.yml) keeps the full section.
fn modal_notes(section: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    let mut skipping = false;
    for line in section.lines() {
        let t = line.trim();
        if let Some(title) = t.strip_prefix("## ") {
            // Drop dev-only subsections; resume keeping at the next heading.
            skipping = DEV_ONLY_HEADINGS
                .iter()
                .any(|h| title.trim().eq_ignore_ascii_case(h));
            if skipping {
                continue;
            }
        }
        if !skipping {
            out.push(line);
        }
    }
    out.join("\n").trim_matches('\n').to_string()
}

#[cfg(test)]
mod changelog_tests {
    use super::{changelog_entries, entries_since, modal_notes};

    /// Extract one `## [version]` block — kept here for the existing targeted tests.
    fn changelog_section(changelog: &str, version: &str) -> Option<String> {
        let header = format!("## [{version}]");
        let mut lines = changelog.lines();
        lines.by_ref().find(|l| l.trim_end() == header)?;
        let body: Vec<&str> = lines.take_while(|l| !l.starts_with("## [")).collect();
        let body = body.join("\n").trim_matches('\n').to_string();
        if body.trim().is_empty() { None } else { Some(body) }
    }

    const SAMPLE: &str = "# Changelog\n\n## [0.4.5]\n\n## What's new\n- a\n- b\n\n## Fix\n- c\n\n## [0.4.0]\n- old\n";

    // ── changelog_section (kept for compatibility; still used in dev) ──────────────────

    #[test]
    fn extracts_section_until_next_version_heading() {
        let got = changelog_section(SAMPLE, "0.4.5").unwrap();
        assert!(got.starts_with("## What's new"), "trims leading blank: {got:?}");
        assert!(got.contains("## Fix") && got.contains("- c"), "keeps sub-headings");
        assert!(!got.contains("0.4.0") && !got.contains("old"), "stops at next version");
    }

    #[test]
    fn missing_version_is_none() {
        assert!(changelog_section(SAMPLE, "9.9.9").is_none());
    }

    // ── modal_notes ───────────────────────────────────────────────────────────────────

    #[test]
    fn modal_notes_drops_dev_sections_and_footer() {
        let section = "## What's new\n- a\n\n## Internal\n- test harness\n\n## More info\n- [ADR](url)";
        let got = modal_notes(section);
        assert_eq!(got, "## What's new\n- a", "drops Internal + More info: {got:?}");
    }

    #[test]
    fn modal_notes_keeps_user_sections() {
        let section = "## What's new\n- a\n\n## Fix\n- c";
        assert_eq!(modal_notes(section), section, "keeps non-dev headings");
    }

    // ── changelog_entries (multi-version) ────────────────────────────────────────────

    const MULTI: &str = "\
# Changelog

## [0.5.0]

## What's new
- feature x

## [0.4.5]

## What's new
- a
- b

## Fix
- c

## Internal
- dev stuff

## [0.4.0]
- old note
";

    #[test]
    fn collects_all_entries_newest_first() {
        let entries = changelog_entries(MULTI);
        assert_eq!(entries.len(), 3, "three version blocks: {entries:?}");
        assert_eq!(entries[0].version, "0.5.0");
        assert_eq!(entries[1].version, "0.4.5");
        assert_eq!(entries[2].version, "0.4.0");
    }

    #[test]
    fn entries_strip_dev_only_subsections() {
        let entries = changelog_entries(MULTI);
        let v045 = entries.iter().find(|e| e.version == "0.4.5").unwrap();
        assert!(!v045.body.contains("dev stuff"), "Internal section stripped: {:?}", v045.body);
        assert!(v045.body.contains("- a"), "user content kept");
    }

    #[test]
    fn entries_since_returns_newer_plus_previous_anchor() {
        let all = changelog_entries(MULTI);
        let since = entries_since(all, "0.4.5");
        // 0.5.0 (new) + 0.4.5 (the previous-version anchor), 0.4.0 dropped.
        assert_eq!(since.len(), 2);
        assert_eq!(since[0].version, "0.5.0");
        assert!(!since[0].is_previous);
        assert_eq!(since[1].version, "0.4.5");
        assert!(since[1].is_previous, "last-seen entry flagged as previous");
    }

    #[test]
    fn entries_since_absent_yields_all_no_anchor() {
        // last_seen not in file → all entries returned, none flagged previous.
        let all = changelog_entries(MULTI);
        let since = entries_since(all, "9.9.9");
        assert_eq!(since.len(), 3, "no entries dropped when version absent");
        assert!(since.iter().all(|e| !e.is_previous), "no anchor when absent");
    }
}

/// Toggle the macOS Dock icon. Persists the new value and applies it live.
/// On non-macOS this is a no-op at the OS level but still persists the flag.
#[tauri::command]
pub fn set_hide_dock(app: AppHandle, enabled: bool) -> Config {
    let state = app.state::<AppState>();
    let updated = {
        let mut cfg = state.config.lock().unwrap();
        cfg.hide_dock = enabled;
        cfg.clone()
    };
    if let Err(err) = crate::store::save(&state.config_path, &updated) {
        eprintln!("qanary: failed to save hide_dock: {err}");
    }
    // Apply live on macOS — menu-bar-only (Accessory) vs normal app (Regular).
    #[cfg(target_os = "macos")]
    {
        let policy = if enabled {
            tauri::ActivationPolicy::Accessory
        } else {
            tauri::ActivationPolicy::Regular
        };
        let _ = app.set_activation_policy(policy);
    }
    updated
}

/// Reorder the top-level lists by id without triggering a network re-probe.
/// Reordering is pure UI state — mirrors `set_list_collapsed` (save-only, no `mutate`).
/// Unknown ids sink to the end of the Vec; nothing is ever silently dropped.
#[tauri::command]
pub fn reorder_lists(app: AppHandle, ordered_ids: Vec<String>) -> Config {
    let state = app.state::<AppState>();
    let updated = {
        let mut cfg = state.config.lock().unwrap();
        cfg.lists.sort_by_key(|x| {
            ordered_ids
                .iter()
                .position(|id| id == &x.id)
                .unwrap_or(usize::MAX)
        });
        cfg.clone()
    };
    if let Err(err) = crate::store::save(&state.config_path, &updated) {
        eprintln!("qanary: failed to save list order: {err}");
    }
    updated
}

/// Reorder services within a list by id without triggering a network re-probe.
/// Same save-only pattern as `reorder_lists` — no `mutate`, no background re-probe.
#[tauri::command]
pub fn reorder_services(app: AppHandle, list_id: String, ordered_ids: Vec<String>) -> Config {
    let state = app.state::<AppState>();
    let updated = {
        let mut cfg = state.config.lock().unwrap();
        if let Some(list) = cfg.lists.iter_mut().find(|l| l.id == list_id) {
            list.services.sort_by_key(|x| {
                ordered_ids
                    .iter()
                    .position(|id| id == &x.id)
                    .unwrap_or(usize::MAX)
            });
        }
        cfg.clone()
    };
    if let Err(err) = crate::store::save(&state.config_path, &updated) {
        eprintln!("qanary: failed to save service order: {err}");
    }
    updated
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

/// Write the current live config to a user-picked file path.
/// The file is plain JSON (same shape as `config.json`) and can be re-imported.
#[tauri::command]
pub fn export_config(state: State<AppState>, path: String) -> Result<(), String> {
    let cfg = state.config.lock().unwrap().clone();
    crate::store::save(std::path::Path::new(&path), &cfg)
        .map_err(|e| format!("Export failed: {e}"))
}

/// Load a config from a user-picked file path, migrate it if needed, and replace the live config.
///
/// Rejects files whose `schema_version` is newer than `CURRENT_SCHEMA` (made by a newer app).
/// On success: saves to the real config path, emits checking, respawns tasks, returns the config.
/// Mirrors `reset_config` — validates and migrates BEFORE swapping state (unlike `mutate`).
#[tauri::command]
pub fn import_config(app: AppHandle, path: String) -> Result<Config, String> {
    let json = std::fs::read_to_string(&path)
        .map_err(|e| format!("Cannot read file: {e}"))?;
    let mut cfg: Config = serde_json::from_str(&json)
        .map_err(|e| format!("Invalid config file: {e}"))?;

    if cfg.schema_version > crate::models::CURRENT_SCHEMA {
        return Err(format!(
            "This config was made by a newer version of Qanary (schema {}). Please update the app first.",
            cfg.schema_version
        ));
    }

    crate::store::migrate(&mut cfg);

    let state = app.state::<AppState>();
    *state.config.lock().unwrap() = cfg.clone();
    if let Err(e) = crate::store::save(&state.config_path, &cfg) {
        eprintln!("qanary: failed to save imported config: {e}");
    }
    crate::emit_checking(&app);
    crate::scheduler::respawn_tasks(&app);
    Ok(cfg)
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
    // Show affected services as Checking instantly, then respawn the Service probe tasks against
    // the new config (the Service set may have changed).
    crate::emit_checking(app);
    crate::scheduler::respawn_tasks(app);
    updated
}
