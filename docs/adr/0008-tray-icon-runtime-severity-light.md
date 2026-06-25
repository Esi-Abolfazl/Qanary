# 0008. Tray icon as a runtime-rendered Severity light, detection still frontend-side

- **Status:** accepted
- **Date:** 2026-06-22
- **Deciders:** Esi-Abolfazl

## Context

The project TODO called for a system-tray (menu-bar) icon so Qanary stays useful when
its main window is hidden. For a connectivity monitor the primary value of such an icon
is a live traffic-light that mirrors the in-window Severity: green when all lists are
reachable, amber when a non-critical list is fully down, red when a critical list is
fully down.

The Rust backend already computes `overall Severity` on every probe cycle
(`probe::overall_severity`). ADR-0007 left Transition detection in the TypeScript
frontend (`src/utils/transitions.ts`) and noted that a backend move should happen
"when tray lands" — but only if the tray needed background notification support, which
was not requested here.

A coloured icon requires a raster image. The options were to bundle designed PNGs, to
use a macOS monochrome template image, or to generate the pixels at runtime. The
Tauri v2 `Image::new_owned` API accepts a raw RGBA `Vec<u8>`, making runtime generation
possible without any new library dependency.

## Decision

Add the `tray-icon` feature to the `tauri` dependency. Build the tray icon and its
context menu inside `setup()` using `TrayIconBuilder` from `tauri::tray`; isolate all
tray code in a new `src-tauri/src/tray.rs` module.

Generate the icon in-process: a 22×22 RGBA buffer with an analytic anti-aliased filled
circle in the palette colour for each Severity level (Green `#1fb872`, Yellow `#f2792b`,
Red `#e03131`, matching `src/tokens.css` as the authoritative source). The icon is
rebuilt and pushed to the tray at the end of every `run_cycle` call and at
`emit_checking` startup. No binary asset files are authored, no new runtime dependency
is added.

The tray context menu provides three actions: Show / Hide (toggle the main window),
Refresh now (spawn a probe cycle), and Quit. Left-clicking the tray icon also toggles
the window. Closing the window hides it to the tray rather than quitting; the probe
loop continues running in the background.

Transition detection remains in the TypeScript frontend. The tray consumes only
`snapshot.overall` (a `Severity` value), which is already available from the backend.
The ADR-0007 follow-up to move Transition detection to the backend is explicitly
deferred: the tray has no need for it until background tray notifications for
transitions are requested.

## Alternatives considered

- **Bundle 3 designed PNGs** — rejected: binary assets in the repository require an
  art-authoring step and tooling for what is, in the end, a flat coloured dot. Swapping
  to `Image::from_path` later is a one-line change if designed art is ever produced.

- **macOS monochrome template image** — rejected: template images are always rendered
  in the system accent colour, which loses the green/amber/red traffic-light signal
  that is the whole point of the icon.

- **Move Transition detection to the backend now (ADR-0007 follow-up)** — rejected as
  scope creep. The tray icon only needs `snapshot.overall`, not per-transition events.
  Moving detection to the backend becomes worthwhile when background tray notifications
  for transitions are implemented; until then it is YAGNI.

## Consequences

### Positive:

- Smallest possible diff: one new module (`tray.rs`), two small additions to `lib.rs`,
  one Cargo feature line.
- Zero new runtime dependencies or binary assets.
- Fully reversible: revert the `tray.rs` add, the two `lib.rs` hunks, and the
  `Cargo.toml` feature — no persisted state or frontend contract change.
- Designed tray art can replace the runtime circle later via `Image::from_path` with no
  rewiring.
- Probe loop continues while the window is hidden; the tray icon stays live.

### Negative / accepted trade-offs:

- The runtime-drawn circle is plainer than designed artwork.
- Alert Transition detection remains split between frontend and backend; ADR-0007
  follow-up stays open until tray notifications for background transitions are needed.

### Follow-ups:

- Replace the runtime circle with a designed 22×22 PNG if a design pass is done;
  change `severity_icon` to `Image::from_path` and bundle the assets.
- When background tray notifications (e.g. "Intranet just went red") are wanted, move
  Transition detection to the backend (ADR-0007 follow-up) and add a
  `tray.notify_transition` call in `run_cycle`.
- Consider hiding the macOS Dock icon (`ActivationPolicy::Accessory`) when the window
  is hidden, if a pure menu-bar-only mode is desired.
