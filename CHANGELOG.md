# Changelog

All notable changes to Qanary are documented here. The section for each released
version is what the in-app "What's new" dialog shows after an update.

Format: one `## [version]` heading per release; the lines under it (until the next
heading) become that release's notes.

## [0.4.5]

## What's new
- Show a "What's new" changelog the first time the app runs after an update.
- Hide Dock icon option (macOS) — run as a menu-bar-only app.
- Launch at login option — start Qanary automatically, hidden to the tray.

## Fix
- Settings: switches for the new options apply only when you press Save.


## [0.4.0]

## What's new
**System Tray Support**
Qanary now lives in your system tray with a dynamic icon that reflects current connectivity status at a glance — green, yellow, or red without opening the window.

**Critical-List Status Notifications**
Get native desktop notifications when a service on a **critical list** changes state. Qanary alerts you on both `up → down` and `down → up` transitions, so you know the instant a critical service drops or recovers — with optional sound.

> **Note:** Notifications fire only for services on a critical list. Create a critical list first to start receiving them.


## [0.3.0]

## What's new
- Critical list alarm — each list now has a Critical toggle (in its add/edit modal). When a critical list goes fully down, the header turns red. Non-critical lists going down warn yellow instead.
- Three-level severity — Green → Yellow (warn) → Red (alarm), replacing the old binary green/red.
- New app icon & wordmark — refreshed Qanary brand mark across all platforms and sizes.
- Dark/light mode — UI follows system appearance, with a manual override in the menu.


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


## [0.1.2]

## What's new
- Services show instantly with a pulsing dot when added or refreshed — no more waiting for the probe to finish
- Buttons disable while their action is in flight (refresh, remove, modal submit)
- UI polish: uniform list header icons and button sizes
