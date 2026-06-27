# Changelog

All notable changes to Qanary are documented here. The section for each released
version is what the in-app "What's new" dialog shows after an update.

Format: one `## [version]` heading per release; the lines under it (until the next
heading) become that release's notes. Dev-log-only subsections (`## Internal`, `## Dev`,
`## Development`, `## Chore`, `## CI`, `## Build`, `## More info`) appear on the GitHub
release page but are hidden from the in-app "What's new" modal.

## [0.5.5]

## What's new

- Export & import your config — back up your lists and settings to a `.json` file, or move them to another machine, from the new Config section at the top of Settings. Importing replaces your current setup and asks you to confirm first.

## Internal

- Versioned config schema (`schema_version`) with a numbered migration runner, so future config-shape changes upgrade old configs automatically on load and on import.

## More info

- [ADR 0019 — versioned config schema + JSON export/import](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0019-config-export-import-migration.md).

## [0.5.3]

## What's new

- Instant refresh on network changes — Qanary now probes the moment your system network state shifts (wifi on/off, ethernet plug/unplug, VPN connect/disconnect) instead of waiting for the interval timer, so status updates within about a second.

## More info

- [ADR 0018 — network-change-triggered refresh](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0018-network-change-triggered-refresh.md).

## [0.5.2]

## What's new

- Probe interval by list criticality — critical lists refresh every 30s and non-critical lists every 60s by default (minimum 10s), both adjustable in Settings.

## Fix

- Automatic update checks — Qanary re-checks for a new version every 6 hours.

## More info

- [ADR 0015 — background interval self-update check](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0015-background-interval-visibility-self-update-check.md), [ADR 0017 — list-criticality probe intervals](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0017-list-criticality-probe-intervals.md).

## [0.5.0]

## What's new

- Drag-and-drop reordering — rearrange lists and the services within them by dragging.
- Independent per-service probing — each service refreshes on its own as its probe lands, so dots update one by one instead of waiting for a whole round. Backoff + jitter cadence with an auto-respawn supervisor keeps probes resilient, and WAN/IP runs on its own task.
- More accurate latency — readings now reflect the full reachability cost of a probe.

## Internal

- Frontend test harness: vitest + jsdom unit/component specs and Playwright e2e against the dev server (Tauri IPC mocked).

## More info

- [ADR 0010 — drag-reordering](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0010-drag-drop-reordering.md), [ADR 0014 — per-service probe tasks](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0014-per-service-probe-tasks-status-deltas.md), [ADR 0013 — frontend test harness](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0013-frontend-test-harness.md).

## [0.4.5]

## What's new

- Show a "What's new" changelog the first time the app runs after an update.
- Hide Dock icon option (macOS) — run as a menu-bar-only app.
- Launch at login option — start Qanary automatically, hidden to the tray.

## Fix

- Settings: switches for the new options apply only when you press Save.

## More info

- [ADR 0009 — launch-on-login, hide-in-dock, post-update changelog](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0009-changelog-dock-autostart.md).

## [0.4.0]

## What's new

**System Tray Support**
Qanary now lives in your system tray with a dynamic icon that reflects current connectivity status at a glance — green, yellow, or red without opening the window.

**Critical-List Status Notifications**
Get native desktop notifications when a service on a **critical list** changes state. Qanary alerts you on both `up → down` and `down → up` transitions, so you know the instant a critical service drops or recovers — with optional sound.

> **Note:** Notifications fire only for services on a critical list. Create a critical list first to start receiving them.

## More info

- [ADR 0007 — critical-list notifications](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0007-critical-list-notifications.md), [ADR 0008 — tray icon as a severity light](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0008-tray-icon-runtime-severity-light.md).

## [0.3.0]

## What's new

- Critical list alarm — each list now has a Critical toggle (in its add/edit modal). When a critical list goes fully down, the header turns red. Non-critical lists going down warn yellow instead.
- Three-level severity — Green → Yellow (warn) → Red (alarm), replacing the old binary green/red.
- New app icon & wordmark — refreshed Qanary brand mark across all platforms and sizes.
- Dark/light mode — UI follows system appearance, with a manual override in the menu.

## More info

- [ADR 0006 — Canary design system](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0006-canary-design-system.md).

## [0.2.0]

## What's new

- Multi-endpoint services: one service, many hosts (Cursor ships with 10)
- Worst-wins dot color: green all up, yellow any blocked, red all down
- Expand service for per-host status + latency; count badge shows reachable / blocked / down
- Bulk add: `Label: host1, host2, host3`
- Edit label + endpoints in place
- Edit/Remove moved into per-service ⋮ menu
- Service favicons for faster scanning

## Fix

- All UI glyphs replaced with inline Lucide SVG icons — zero new deps, smoother refresh spinner
- Fix: refresh button no longer shows loading state on startup
- Loading states on all async buttons
- Lazy probing — UI updates immediately, results fill in after

## More info

- [ADR 0005 — optimistic checking snapshot for lazy probing](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0005-optimistic-checking-snapshot.md).

## [0.1.2]

## What's new

- Services show instantly with a pulsing dot when added or refreshed — no more waiting for the probe to finish
- Buttons disable while their action is in flight (refresh, remove, modal submit)
- UI polish: uniform list header icons and button sizes
