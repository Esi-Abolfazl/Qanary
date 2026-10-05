//! Tauri commands — the bridge the React frontend calls via `invoke(...)`.
//!
//! Read commands just clone state out. Every config write goes through `commit` (apply to a copy,
//! save it under the config lock, only then swap it in) and returns `Err(message)` when that fails,
//! so the UI never shows a change that isn't on disk. Probe-affecting writes use `mutate`, which
//! also kicks off a fresh probe cycle in the background. Input is validated where it enters
//! (`to_endpoints`); a whole config is validated only on import.

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
/// probe task (and the WAN task) wakes immediately. The Checking snapshot and every delta after it
/// arrive as events, so nothing is returned.
#[tauri::command]
pub fn refresh_now(app: AppHandle) {
    crate::emit_checking(&app);
    let _ = app.state::<AppState>().probe_now.send(()); // Err just means no subscribers yet — harmless
}

/// Re-check one service right now — every endpoint of it, or just `endpoint_id` — without
/// touching anything else. It shows `Checking` immediately; the result arrives as an ordinary
/// Status delta, so nothing is returned.
#[tauri::command]
pub fn check_now(
    app: AppHandle,
    list_id: String,
    service_id: String,
    endpoint_id: Option<String>,
) -> Result<(), String> {
    crate::scheduler::check_now(&app, &list_id, &service_id, endpoint_id.as_deref())
}

/// Re-check every service of one list right now, leaving the other lists alone. Each shows
/// `Checking` immediately; the results arrive as ordinary Status deltas.
#[tauri::command]
pub fn check_list(app: AppHandle, list_id: String) -> Result<(), String> {
    crate::scheduler::check_list_now(&app, &list_id)
}

/// Add one or more services (each with their endpoints) to a list.
/// Replaces the old single-host `add_service` command.
#[tauri::command]
pub fn add_services(
    app: AppHandle,
    list_id: String,
    services: Vec<ServiceDraft>,
) -> Result<Config, String> {
    mutate(&app, |cfg| {
        let list = find_list(cfg, &list_id)?;
        for draft in &services {
            list.services.push(Service::with_endpoints(&draft.label, to_endpoints(&draft.endpoints)?));
        }
        Ok(())
    })
}

/// Turn drafts into validated endpoints. An empty result is an error: a service must be probeable.
fn to_endpoints(drafts: &[EndpointDraft]) -> Result<Vec<Endpoint>, String> {
    let endpoints = drafts
        .iter()
        .filter(|e| !e.host.trim().is_empty())
        .map(|e| {
            let (host, port) = (e.host.trim(), e.port.unwrap_or(443));
            crate::store::validate_endpoint(host, port).map(|()| Endpoint::new(host, port))
        })
        .collect::<Result<Vec<_>, _>>()?;
    if endpoints.is_empty() {
        return Err("Enter at least one host.".into());
    }
    Ok(endpoints)
}

fn find_list<'a>(cfg: &'a mut Config, list_id: &str) -> Result<&'a mut ServiceList, String> {
    cfg.lists
        .iter_mut()
        .find(|l| l.id == list_id)
        .ok_or_else(|| "That list no longer exists.".to_string())
}

/// Replace a service's label and endpoints (wholesale edit).
#[tauri::command]
pub fn update_service(
    app: AppHandle,
    list_id: String,
    service_id: String,
    label: String,
    endpoints: Vec<EndpointDraft>,
) -> Result<Config, String> {
    mutate(&app, |cfg| {
        let svc = find_list(cfg, &list_id)?
            .services
            .iter_mut()
            .find(|s| s.id == service_id)
            .ok_or("That service no longer exists.")?;
        svc.label = label;
        svc.endpoints = to_endpoints(&endpoints)?;
        Ok(())
    })
}

#[tauri::command]
pub fn remove_service(app: AppHandle, list_id: String, service_id: String) -> Result<Config, String> {
    mutate(&app, |cfg| {
        find_list(cfg, &list_id)?.services.retain(|s| s.id != service_id);
        Ok(())
    })
}

#[tauri::command]
pub fn add_list(app: AppHandle, name: String, icon: String, critical: bool) -> Result<Config, String> {
    mutate(&app, |cfg| {
        let mut list = ServiceList::new(&name, &icon, Vec::new());
        list.critical = critical;
        cfg.lists.push(list);
        Ok(())
    })
}

/// Update an existing list's display name, icon, and critical flag.
#[tauri::command]
pub fn update_list(
    app: AppHandle,
    list_id: String,
    name: String,
    icon: String,
    critical: bool,
) -> Result<Config, String> {
    mutate(&app, |cfg| {
        let list = find_list(cfg, &list_id)?;
        list.name = name;
        list.icon = icon;
        list.critical = critical;
        Ok(())
    })
}

/// Wipe the persisted config, seed fresh defaults, re-probe.
#[tauri::command]
pub fn reset_config(app: AppHandle) -> Result<Config, String> {
    let cfg = mutate(&app, |cfg| {
        *cfg = Config::default();
        Ok(())
    })?;
    apply_dock_policy(&app, cfg.hide_dock);
    let (icon, filled) = cfg.tray_look();
    crate::tray::set_style(&app, icon, filled);
    Ok(cfg)
}

#[tauri::command]
pub fn remove_list(app: AppHandle, list_id: String) -> Result<Config, String> {
    mutate(&app, |cfg| {
        cfg.lists.retain(|l| l.id != list_id);
        Ok(())
    })
}

/// The Settings form's Save, as one write. Every field is optional: `None` = leave unchanged.
/// `hide_dock` is part of it so Dock + the rest either both save or neither does.
#[derive(Debug, Default, Deserialize)]
pub struct SettingsPatch {
    pub critical_interval_secs: Option<u64>,
    pub noncritical_interval_secs: Option<u64>,
    pub timeout_ms: Option<u64>,
    pub ip_providers: Option<Vec<String>>,
    pub down_notify: Option<bool>,
    pub down_sound: Option<bool>,
    pub up_notify: Option<bool>,
    pub up_sound: Option<bool>,
    pub blocked_notify: Option<bool>,
    pub blocked_sound: Option<bool>,
    pub notify_volume: Option<u8>,
    pub hide_dock: Option<bool>,
    pub status_icon: Option<crate::models::StatusIcon>,
    pub tray_filled: Option<bool>,
    pub tray_shape: Option<crate::models::TrayShape>,
}

#[tauri::command]
pub fn update_settings(app: AppHandle, patch: SettingsPatch) -> Result<Config, String> {
    let hide_dock = patch.hide_dock;
    let tray_look = patch.status_icon.is_some() || patch.tray_filled.is_some() || patch.tray_shape.is_some();
    let cfg = mutate(&app, |cfg| {
        apply_settings(cfg, patch);
        Ok(())
    })?;
    if hide_dock.is_some() {
        apply_dock_policy(&app, cfg.hide_dock);
    }
    if tray_look {
        let (icon, filled) = cfg.tray_look();
        crate::tray::set_style(&app, icon, filled);
    }
    Ok(cfg)
}

fn apply_settings(cfg: &mut Config, p: SettingsPatch) {
    if let Some(v) = p.critical_interval_secs {
        cfg.critical_interval_secs = v.max(10); // floor to avoid hammering the network
    }
    if let Some(v) = p.noncritical_interval_secs {
        cfg.noncritical_interval_secs = v.max(10);
    }
    if let Some(v) = p.timeout_ms {
        cfg.timeout_ms = v;
    }
    if let Some(v) = p.ip_providers {
        let providers: Vec<String> = v
            .into_iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if !providers.is_empty() {
            cfg.ip_providers = providers;
        }
    }
    let flags = [
        (p.down_notify, &mut cfg.down_notify),
        (p.down_sound, &mut cfg.down_sound),
        (p.up_notify, &mut cfg.up_notify),
        (p.up_sound, &mut cfg.up_sound),
        (p.blocked_notify, &mut cfg.blocked_notify),
        (p.blocked_sound, &mut cfg.blocked_sound),
        (p.hide_dock, &mut cfg.hide_dock),
        (p.tray_filled, &mut cfg.tray_filled),
    ];
    for (new, field) in flags {
        if let Some(v) = new {
            *field = v;
        }
    }
    if let Some(v) = p.notify_volume {
        cfg.notify_volume = v;
    }
    if let Some(v) = p.status_icon {
        cfg.status_icon = v;
    }
    if let Some(v) = p.tray_shape {
        cfg.tray_shape = v;
    }
    // After the assignments, so an out-of-range `notify_volume` from this payload is clamped
    // rather than persisted as-is.
    crate::store::normalize_alerts(cfg);
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
    let last_seen = app.state::<AppState>().config.lock().unwrap().last_changelog_version.clone();
    if last_seen.as_deref() == Some(running.as_str()) {
        return Vec::new(); // already shown for this version
    }
    // Not fatal: at worst the notes show again next launch.
    if let Err(err) = commit(&app, |cfg| {
        cfg.last_changelog_version = Some(running);
        Ok(())
    }) {
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

/// Apply `hide_dock` live on macOS — menu-bar-only (Accessory) vs normal app (Regular). Called by
/// every path that can change the flag (settings, import, reset, startup), so the OS state can't
/// drift. A no-op elsewhere; the flag still persists.
pub fn apply_dock_policy(app: &AppHandle, hide: bool) {
    #[cfg(target_os = "macos")]
    {
        let policy = if hide {
            tauri::ActivationPolicy::Accessory
        } else {
            tauri::ActivationPolicy::Regular
        };
        let _ = app.set_activation_policy(policy);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, hide);
}

/// Reorder the top-level lists by id without triggering a network re-probe.
/// Reordering is pure UI state — mirrors `set_list_collapsed` (save-only, no `mutate`).
/// Unknown ids sink to the end of the Vec; nothing is ever silently dropped.
#[tauri::command]
pub fn reorder_lists(app: AppHandle, ordered_ids: Vec<String>) -> Result<Config, String> {
    let cfg = commit(&app, |cfg| {
        cfg.lists.sort_by_key(|x| ordered_ids.iter().position(|id| id == &x.id).unwrap_or(usize::MAX));
        Ok(())
    })?;
    crate::emit_layout(&app, &cfg);
    Ok(cfg)
}

/// Reorder services within a list by id without triggering a network re-probe.
/// Same save-only pattern as `reorder_lists` — no `mutate`, no background re-probe.
#[tauri::command]
pub fn reorder_services(
    app: AppHandle,
    list_id: String,
    ordered_ids: Vec<String>,
) -> Result<Config, String> {
    let cfg = commit(&app, |cfg| {
        find_list(cfg, &list_id)?
            .services
            .sort_by_key(|x| ordered_ids.iter().position(|id| id == &x.id).unwrap_or(usize::MAX));
        Ok(())
    })?;
    crate::emit_layout(&app, &cfg);
    Ok(cfg)
}

/// Persist the collapsed/expanded state of a list without triggering a network re-probe.
/// Collapse is a pure UI concern — firing a full probe on every chevron click would be wasteful.
#[tauri::command]
pub fn set_list_collapsed(app: AppHandle, list_id: String, collapsed: bool) -> Result<Config, String> {
    let cfg = commit(&app, |cfg| {
        find_list(cfg, &list_id)?.collapsed = collapsed;
        Ok(())
    })?;
    crate::emit_layout(&app, &cfg);
    Ok(cfg)
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
/// Rejects files whose `schema_version` is newer than `CURRENT_SCHEMA` (made by a newer app) and
/// files that fail `store::validate`. Nothing live changes unless the whole import succeeds.
#[tauri::command]
pub fn import_config(app: AppHandle, path: String) -> Result<Config, String> {
    let json = std::fs::read_to_string(&path)
        .map_err(|e| format!("Cannot read file: {e}"))?;
    let mut imported: Config = serde_json::from_str(&json)
        .map_err(|e| format!("Invalid config file: {e}"))?;

    if imported.schema_version > crate::models::CURRENT_SCHEMA {
        return Err(format!(
            "This config was made by a newer version of Qanary (schema {}). Please update the app first.",
            imported.schema_version
        ));
    }

    crate::store::migrate(&mut imported);
    crate::store::normalize_alerts(&mut imported);
    crate::store::repair_legacy_hosts(&mut imported); // exports from before 0.6.5
    crate::store::validate(&imported).map_err(|e| format!("Invalid config file: {e}"))?;

    let cfg = mutate(&app, |cfg| {
        *cfg = imported;
        Ok(())
    })?;
    apply_dock_policy(&app, cfg.hide_dock);
    let (icon, filled) = cfg.tray_look();
    crate::tray::set_style(&app, icon, filled);
    Ok(cfg)
}

/// The one-time warning from startup when `config.json` couldn't be used and was moved aside
/// (see `store::load`). Returns it once, then `None`.
#[tauri::command]
pub fn take_load_warning(state: State<AppState>) -> Option<String> {
    state.load_warning.lock().unwrap().take()
}

/// The single write path for the config. Applies `f` to a copy, saves the copy **while holding the
/// config lock** (so two quick writes reach disk in the same order they reach memory), and only
/// then swaps it in. On any error the live config and the file are both unchanged.
fn commit<F>(app: &AppHandle, f: F) -> Result<Config, String>
where
    F: FnOnce(&mut Config) -> Result<(), String>,
{
    let state = app.state::<AppState>();
    commit_to(&state.config, &state.config_path, f)
}

fn commit_to<F>(config: &std::sync::Mutex<Config>, path: &std::path::Path, f: F) -> Result<Config, String>
where
    F: FnOnce(&mut Config) -> Result<(), String>,
{
    let mut live = config.lock().unwrap();
    let mut next = live.clone();
    f(&mut next)?;
    crate::store::save(path, &next).map_err(|e| format!("Couldn't save your settings: {e}"))?;
    *live = next.clone();
    Ok(next)
}

#[cfg(test)]
mod settings_tests {
    use super::{apply_settings, SettingsPatch};
    use crate::models::Config;

    /// Omitted fields stay; given ones apply, Dock included; floors and clamps still run.
    #[test]
    fn patch_applies_only_given_fields() {
        let mut cfg = Config::default();
        let before = cfg.up_notify;
        apply_settings(
            &mut cfg,
            SettingsPatch {
                hide_dock: Some(true),
                critical_interval_secs: Some(3),
                notify_volume: Some(200),
                ..Default::default()
            },
        );
        assert!(cfg.hide_dock);
        assert_eq!(cfg.critical_interval_secs, 10, "floored");
        assert_eq!(cfg.notify_volume, 100, "clamped");
        assert_eq!(cfg.up_notify, before, "untouched");
    }

    /// The frontend sends the patch with Config's snake_case field names.
    #[test]
    fn patch_deserializes_from_frontend_shape() {
        let p: SettingsPatch =
            serde_json::from_str(r#"{"hide_dock":true,"ip_providers":["a.com"]}"#).unwrap();
        assert_eq!(p.hide_dock, Some(true));
        assert_eq!(p.ip_providers.unwrap(), vec!["a.com"]);
        assert!(p.down_sound.is_none());
    }

    /// The status icon and the menu-bar fill are plain settings: given → applies, omitted → stays.
    #[test]
    fn patch_sets_the_status_icon_and_tray_fill() {
        use crate::models::StatusIcon;
        let mut cfg = Config::default();
        assert_eq!((cfg.status_icon, cfg.tray_filled), (StatusIcon::Pulse, true), "default look");
        apply_settings(
            &mut cfg,
            SettingsPatch { status_icon: Some(StatusIcon::Rings), tray_filled: Some(false), ..Default::default() },
        );
        assert_eq!((cfg.status_icon, cfg.tray_filled), (StatusIcon::Rings, false));
        apply_settings(&mut cfg, SettingsPatch::default());
        assert_eq!((cfg.status_icon, cfg.tray_filled), (StatusIcon::Rings, false), "omitted = unchanged");
    }

    /// The menu-bar picture follows the app's status icon unless it is fixed to its own.
    #[test]
    fn tray_look_follows_the_status_icon_unless_fixed() {
        use crate::models::{StatusIcon, TrayShape};
        let mut cfg = Config::default();
        assert_eq!(cfg.tray_shape, TrayShape::Same, "default follows the app");
        assert_eq!(cfg.tray_look(), (StatusIcon::Pulse, true));
        apply_settings(&mut cfg, SettingsPatch { status_icon: Some(StatusIcon::Rings), ..Default::default() });
        assert_eq!(cfg.tray_look(), (StatusIcon::Rings, true), "same: the menu bar changes with the app");
        apply_settings(&mut cfg, SettingsPatch { tray_shape: Some(TrayShape::Pulse), ..Default::default() });
        assert_eq!(cfg.tray_look(), (StatusIcon::Pulse, true), "fixed: the app's icon no longer matters");
        apply_settings(&mut cfg, SettingsPatch { status_icon: Some(StatusIcon::Pulse), tray_shape: Some(TrayShape::Rings), tray_filled: Some(false), ..Default::default() });
        assert_eq!((cfg.status_icon, cfg.tray_look()), (StatusIcon::Pulse, (StatusIcon::Rings, false)), "orb and menu bar differ");
        apply_settings(&mut cfg, SettingsPatch::default());
        assert_eq!(cfg.tray_shape, TrayShape::Rings, "omitted = unchanged");
    }

    /// `tray_shape` travels as a lowercase word; a config from before it existed follows the app.
    #[test]
    fn tray_shape_wire_format_and_old_configs() {
        use crate::models::TrayShape;
        for (wire, shape) in [("same", TrayShape::Same), ("rings", TrayShape::Rings), ("pulse", TrayShape::Pulse)] {
            let p: SettingsPatch = serde_json::from_str(&format!(r#"{{"tray_shape":"{wire}"}}"#)).unwrap();
            assert_eq!(p.tray_shape, Some(shape));
            assert_eq!(serde_json::to_value(shape).unwrap(), wire);
        }
        assert!(serde_json::from_str::<SettingsPatch>(r#"{"tray_shape":"nope"}"#).is_err());
        let mut json = serde_json::to_value(Config::default()).unwrap();
        json.as_object_mut().unwrap().remove("tray_shape");
        let old: Config = serde_json::from_value(json).unwrap();
        assert_eq!(old.tray_shape, TrayShape::Same);
    }

    /// The frontend sends the icon as a lowercase word; a config file from before the settings
    /// existed loads as filled Pulse.
    #[test]
    fn status_icon_wire_format_and_old_configs() {
        use crate::models::StatusIcon;
        for (wire, icon) in [("rings", StatusIcon::Rings), ("pulse", StatusIcon::Pulse)] {
            let p: SettingsPatch = serde_json::from_str(&format!(r#"{{"status_icon":"{wire}"}}"#)).unwrap();
            assert_eq!(p.status_icon, Some(icon));
            assert_eq!(serde_json::to_value(icon).unwrap(), wire);
        }
        assert!(serde_json::from_str::<SettingsPatch>(r#"{"status_icon":"nope"}"#).is_err());

        let mut json = serde_json::to_value(Config::default()).unwrap();
        assert_eq!((json["status_icon"].as_str(), json["tray_filled"].as_bool()), (Some("pulse"), Some(true)));
        json.as_object_mut().unwrap().remove("status_icon");
        json.as_object_mut().unwrap().remove("tray_filled");
        let old: Config = serde_json::from_value(json).unwrap();
        assert_eq!((old.status_icon, old.tray_filled), (StatusIcon::Pulse, true));
    }
}

#[cfg(test)]
mod commit_tests {
    use super::commit_to;
    use crate::models::Config;
    use std::sync::Mutex;

    /// A save that fails leaves memory untouched and reports the error (A03): the UI must never
    /// show a change that isn't on disk.
    #[test]
    fn failed_save_keeps_memory_unchanged() {
        let dir = std::env::temp_dir().join(format!("qanary-commit-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let blocker = dir.join("not-a-dir");
        std::fs::write(&blocker, "").unwrap(); // a file where the config dir should be
        let live = Mutex::new(Config::default());
        let before = live.lock().unwrap().lists.len();

        let res = commit_to(&live, &blocker.join("config.json"), |cfg| {
            cfg.lists.clear();
            Ok(())
        });

        assert!(res.unwrap_err().starts_with("Couldn't save"));
        assert_eq!(live.lock().unwrap().lists.len(), before);
        std::fs::remove_dir_all(&dir).ok();
    }

    /// A rejected edit (validation error from `f`) writes nothing and changes nothing.
    #[test]
    fn rejected_edit_writes_nothing() {
        let dir = std::env::temp_dir().join(format!("qanary-commit-{}", uuid::Uuid::new_v4()));
        let path = dir.join("config.json");
        let live = Mutex::new(Config::default());

        let res = commit_to(&live, &path, |cfg| {
            cfg.lists.clear();
            Err("nope".into())
        });

        assert_eq!(res.unwrap_err(), "nope");
        assert!(!path.exists());
        assert!(!live.lock().unwrap().lists.is_empty());
    }
}

/// `commit`, then show affected services as Checking instantly and respawn the Service probe tasks
/// against the new config (the Service set may have changed); refetch WAN if providers changed.
fn mutate<F>(app: &AppHandle, f: F) -> Result<Config, String>
where
    F: FnOnce(&mut Config) -> Result<(), String>,
{
    let state = app.state::<AppState>();
    let providers_before = state.config.lock().unwrap().ip_providers.clone();
    let updated = commit(app, f)?;
    crate::scheduler::respawn_tasks(app); // paints Checking, then re-probes
    // One place for every path that can change providers (settings, import, reset).
    if updated.ip_providers != providers_before {
        state.wan_now.notify_one();
    }
    Ok(updated)
}
