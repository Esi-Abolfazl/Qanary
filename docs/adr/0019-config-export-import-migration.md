# 0019. Versioned config schema + JSON export/import via native file picker

- **Status:** accepted
- **Date:** 2026-06-27
- **Deciders:** Esi-Abolfazl

## Context

Qanary persists all user configuration as a JSON file (`config.json` in the OS config dir).
Until this change there was no mechanism for users to back up or transfer their configuration,
and schema changes were handled ad-hoc by a single `migrate_legacy` function keyed on whether
specific fields were empty — not on any version counter. This meant:

1. **No upgrade path** for future shape changes: every new migration had to piggyback on
   field-emptiness heuristics, making it fragile and hard to reason about.
2. **No portability**: users could not export their lists to another machine or keep a backup
   before a reset.
3. **Import of an old file** (e.g. a backup) would need to run the same upgrade steps as load,
   but there was no shared chain to call.

The two TODO items (§18 export/import, §19 migration system) are tightly coupled: import must
run the same migration as load, so the migration system had to be built first.

## Decision

### 1. Integer `schema_version` on `Config`

Add `pub schema_version: u32` with `#[serde(default)]` (absent in old files → 0).
A module-level constant `CURRENT_SCHEMA: u32 = 1` marks the latest known shape.

New settings added as `#[serde(default)]` fields do **not** need a schema bump — serde fills
the default automatically. A bump + migration step is only needed for structural reshapes
(renames, field restructuring, type changes) that serde cannot handle on its own.

### 2. Numbered migration runner in `store::migrate`

`pub fn migrate(cfg: &mut Config)` loops while `cfg.schema_version < CURRENT_SCHEMA`,
applying the step for each version and then incrementing the counter. Adding a new step:
bump `CURRENT_SCHEMA` and add one `match` arm for the old version number.

Step 0→1 absorbs the existing `migrate_legacy` logic: fold legacy `{host, port}` service
fields into `endpoints[0]`. The old `migrate_legacy` function is removed.

`load()` calls `migrate()` instead of `migrate_legacy()`. `import_config` also calls
`migrate()` — a single chain shared by both paths.

### 3. Export / import as Rust commands, path chosen by the frontend

`export_config(state, path: String) -> Result<(), String>` serialises the live config to the
picked path via `store::save`.

`import_config(app, path: String) -> Result<Config, String>`:
- Reads and parses the file (parse error → `Err`).
- Rejects `schema_version > CURRENT_SCHEMA` with an error ("made by a newer version").
- Runs `store::migrate` on the parsed config.
- Replaces `state.config`, saves to the real config path, `emit_checking`, `respawn_tasks`.
- Returns the migrated `Config` (mirrors `reset_config`; does NOT use `mutate` because
  validation + migration must happen before the state swap).

### 4. File picker via `tauri-plugin-dialog`

The frontend picks the file path using `@tauri-apps/plugin-dialog` (`save()` for export,
`open()` for import) and passes the path string to the Rust command. This keeps all file IO
and migration inside the backend (which already owns persistence), avoiding a second plugin
(`tauri-plugin-fs`) and extra path-scope permissions.

### 5. Settings "Config" card

A `settings-card` fieldset ("Config") with Export… and Import… buttons sits at the **top of
the Settings modal**, **outside the settings `<form>`**. This is deliberate: export/import are
standalone file actions that take effect immediately and are not governed by the form's
Save/Cancel buttons (Save persists probe intervals, providers, alerts, system toggles — not
the config file IO). Keeping the card out of the form avoids implying the user must press
Save for an export/import to "stick".

Export shows a save-file dialog defaulting to `qanary-config.json`; on a path being returned,
calls `api.exportConfig(path)` and shows inline feedback (success in neutral-green, failure in
alarm-red — success is intentionally not styled as an error).

Import shows an open-file dialog (JSON filter); on a path being returned it does **not** import
immediately. Because import is a full destructive replace, it first opens a second
confirmation modal ("This will overwrite and clear your current setup… This cannot be undone")
with Cancel / Overwrite (the Overwrite button styled as a destructive/danger action). Only on
confirm does it call `onImport(path)`, which App.tsx wires to
`api.importConfig(path).then(() => window.location.reload())` — the same reload pattern used by
"Reset to defaults".

Import is a full replace (no merge). Users wanting to undo can re-import a prior backup or
reset to defaults.

## Alternatives considered

- **App-semver-keyed migrations** — rejected: couples config shape changes to release cadence.
  Two releases could share a schema; one release could introduce two schema bumps. The integer
  counter is independent of the app version.

- **Merge-on-import** — rejected: requires conflict resolution rules (which fields win?).
  Full replace is predictable and mirrors "Reset to defaults" semantically.

- **File IO in JS via `tauri-plugin-fs`** — rejected: the backend already owns persistence
  and the migration chain. Doing IO in JS would require a second plugin, extra permission
  tokens, and would split the "read → migrate → save" pipeline across the IPC boundary.

- **Backup on import** — rejected (for now): import is intentional; the prior config is
  available via reset-to-defaults. Add if users report needing it (TODO §future).

## Consequences

### Positive:

- One migration chain (`store::migrate`) serves both `load` and `import_config`. Future
  shape changes = one new `match` arm + one `CURRENT_SCHEMA` bump.
- **Two-tier upgrade path**: additive fields with `#[serde(default)]` are free (no step
  needed); structural changes get a numbered step. The distinction is explicit.
- Users can back up, transfer, and restore their configuration.
- Import of an older config (e.g. a backup from before a schema bump) is handled correctly.
- A confirmation modal guards the destructive import (full overwrite), so an accidental file
  pick or wrong file can be backed out before any data is replaced.
- The new `schema_version` field is forward-compatible: an old binary silently ignores the
  unknown field; the file still loads (though the migration step won't run).

### Negative / accepted trade-offs:

- **Bump discipline required**: a structural change that forgets the step + `CURRENT_SCHEMA`
  bump imports with a stale shape silently. Additive-only changes are safe by default.
  Migrations key off `schema_version`, never the app version — a config file's schema integer
  is the single source of truth for upgrade decisions.
- **Import replaces wholesale** with no automatic backup of the prior config. Mitigated by
  the overwrite-confirmation modal (front-stop) and the reset-to-defaults escape hatch.
- New dependency: `tauri-plugin-dialog` + `dialog:default` capability. Adds ~100 kB to the
  binary (already transitive via `rfd`).

### Follow-ups:

- If users request undo-on-import, add a pre-import backup of `config.json` to a sibling
  `.bak` file (one step, no new plugin needed).
- Each future structural config change: add a step in `store::migrate`, bump `CURRENT_SCHEMA`.
