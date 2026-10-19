# Changelog

All notable changes to Qanary are documented here. The section for each released
version is what the in-app "What's new" dialog shows after an update.

Format: one `## [version]` heading per release; the lines under it (until the next
heading) become that release's notes. Dev-log-only subsections (`## Internal`, `## Dev`,
`## Development`, `## Chore`, `## CI`, `## Build`, `## More info`) appear on the GitHub
release page but are hidden from the in-app "What's new" modal.

## [1.0.3]

## What's new

- Updates now install in the background and start the next time Qanary opens, which for most people is the next login. To turn this off: Settings › System › Install updates automatically.
- If the update check runs before the network is up (right after login), it retries in 5 minutes, not 6 hours.

## Fix

- Outage alerts work again while the window is hidden. Before, a disconnect could pass silently and you heard only the recovery sound.

## More info

- [ADR 0029: post-wake alert grace](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0029-settled-snapshots-and-post-wake-alert-grace.md) now tells a real sleep from a throttled window. [ADR 0001](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0001-github-releases-and-self-update.md) and [ADR 0015](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0015-background-interval-visibility-self-update-check.md) cover the background install.

## [1.0.2]

## What's new

- Choose a different icon for the menu bar than in the app: Same as app, Pulse or Rings, in Settings.
- The filled menu bar look has its own switch.
- Click "?" next to Status icon to see every state before you pick.
- UI polish for the status icons, the Offline icon and the ☰ button.

## Fix

- Screen readers now describe the menu bar picker correctly.

## More info

- [ADR 0044: the status icon setting](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0044-one-status-icon-setting-for-orb-and-menu-bar.md), updated for the separate menu bar icon. ADR 0043 covers the new Offline icon.

## Internal

- GitHub now runs the type check and the unit tests on every pull request.

## [1.0.0]

## What's new

- A new glass look, with a status orb that moves.
- Pick rings or a pulse for the status icon, in the app and in the menu bar.
- The menu bar menu shows how each list is doing.
- Click a service or a list name to check just that one.
- Lists sit side by side in a wide window.
- Mac shortcuts: ⌘N new list, ⇧⌘O edit order, ⌘, Settings, ⌘R refresh.
- Thanks to [Sajjad](https://github.com/DevSajjadX), who designed and built the whole new look.

## Fix

- TCP-only services no longer stop a list from showing as down when the rest of it is blocked or disconnected.

## More info

- [ADR 0032: the Glass redesign](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0032-glass-ui-redesign.md). The follow-up decisions are ADR 0033 to ADR 0047.

## Internal

- `pnpm dev` at `/?mock` runs the interface in a browser on sample data. The end-to-end tests use the same mock.
- pnpm 12.8.1, pinned once in `package.json`.

## [0.6.5]

## What's new

- **Edit order** is now in each list's ⋯ menu, so you can rearrange without going to the main menu.
- With no lists, Qanary offers a quick **Add list** link.

## Fix

- Editing a service and saving it no longer breaks it. Services broken this way are repaired automatically.
- Your settings are never lost. If the settings file is damaged, Qanary keeps a backup and tells you.
- If a change can't be saved, you now see a message instead of losing it on restart.
- Pasting a full web address (like `https://x.com/home`) now just works.
- Collapsed lists stay collapsed, and rearranged lists stay in place.
- Dragging a list or service no longer stretches it.
- Alerts after waking your Mac are calmer and more accurate.
- Updating always installs the version you downloaded.
- Qanary says "Checking…" at startup instead of "All clear" before it has checked anything.

## More info

- [ADR 0030 — config writes never lose data](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0030-config-writes-never-lose-data.md).
- [ADR 0031 — live state has one owner](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0031-live-state-has-one-owner.md).

## Internal

- Fixes from the 2026-09-23 audit: atomic config saves, one validation rule for hosts, stale probe results dropped, a single owner for update state.
- Releases now run the type check, unit tests, and a tag/version check before building.

## [0.6.4]

## Fix

- Waking your Mac from sleep no longer sets off a burst of notifications and alert sounds. Qanary now waits for the network to come back before deciding anything is wrong, and tells you once — not once per retry.
- A refresh while something was down no longer announced a false "Recovered" a moment before repeating the outage. Refreshing is silent again; only real changes speak.
- An outage that starts while your Mac is asleep is still reported when you come back, so nothing is quietly swallowed.

## More info

- [ADR 0029 — settled snapshots and a post-wake alert grace window](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0029-settled-snapshots-and-post-wake-alert-grace.md).

## Internal

- Agent workflow guidance now requires short, scannable status footers, and the repo-local plan-draft, plan-execute, and plan-review skill copies were removed.

## [0.6.3]

## What's new

- The sound volume slider now moves in single percent steps instead of jumping between 25% marks, so you can set any level you like.

## Fix

- Muting the volume no longer switches your Sound alerts off. Sliding to **Muted** (0) silences Qanary's sounds and leaves the Sound checkboxes exactly as you set them, so turning the level back up brings your alerts back — previously it unchecked all three and you had to redo them. The slider now goes inactive only when no alert is set to make a sound at all. Notifications are unaffected either way.
- If a previous version cleared your Sound checkboxes when you muted the volume, re-check the ones you want; they will stick from now on.

## More info

- [ADR 0028 — volume independent of the Sound flags](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0028-volume-independent-of-sound-flags.md).

## [0.6.2]

## What's new

- Sound volume for alerts — one level for every alert sound, set from a slider in the Critical-list alerts section of Settings (off, 25%, 50%, 75%, 100%). Dragging it to 0 turns the Sound checkboxes off; enabling a Sound alert brings the volume back. Notifications are unaffected, so you can keep the banners with no sound at all.

## Fix

- Losing your connection now gives a single "You're offline" alert instead of two overlapping ones. Qanary waits for the whole check round to settle, then speaks once at the worst thing it found — being offline outranks any individual list being down, and a list still down when you come back online is announced then instead of being lost.

## More info

- [ADR 0026 — notification sound volume](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0026-notification-sound-volume.md), [ADR 0027 — one alert per settled probe round](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0027-single-alert-per-settled-probe-round.md).

## [0.6.0]

## What's new

- Blocked alert for critical lists — when every endpoint of a critical list turns blocked (the TLS-interception fingerprint), Qanary sends a dedicated "Blocked" notification instead of the generic outage one. Opt-out via the new toggle in Settings.
- Cut-off detection — when nothing at all is reachable (no endpoint up anywhere), the app now reads a red "Offline" instead of a wall of orange dots. Total loss of connectivity is a red alarm, not a soft warning.

## Fix

- WAN IP now refreshes correctly after a network or VPN change — probes no longer reuse a connection bound to the old route, and a failed refetch retries quickly instead of waiting up to five minutes.

## More info

- [ADR 0023 — blocked-list notification](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0023-blocked-list-notification.md), [ADR 0024 — cut-off "offline" red escalation](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0024-cut-off-offline-red-escalation.md), [ADR 0025 — fresh WAN IP after network change](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0025-disable-idle-pooling-fresh-wan-ip.md).

## [0.5.6]

## What's new

- Export & import your config — back up your lists and settings to a `.json` file, or move them to another machine, from the new Config section at the top of Settings. Importing replaces your current setup and asks you to confirm first.
- Wildcard endpoints — add a host as `*.example.com` and Qanary keeps it as one endpoint, probing a fresh random subdomain of the zone each round instead of the often-dead bare domain. This reflects whether the wildcard zone is actually reachable.
- Wildcard endpoints are checked at the TCP layer only — their certificate can't be verified for a made-up subdomain — so they show a blue "reachable" dot with a "TCP only" note in place of a latency. A service that mixes normal and wildcard endpoints stays green as long as its normal endpoints are up.

## Note
- Upgrading? Wildcard endpoints only apply to newly added services. To pick up the updated default list, reset to default from the Settings menu — note this clears any lists or services you added yourself.

## Internal

- Versioned config schema (`schema_version`) with a numbered migration runner, so future config-shape changes upgrade old configs automatically on load and on import.

## More info

- [ADR 0019 — versioned config schema + JSON export/import](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0019-config-export-import-migration.md),[ADR 0020 — wildcard endpoint probing](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0020-wildcard-endpoint-probing.md), [ADR 0021 — TCP-only reachable state for wildcards](https://github.com/Esi-Abolfazl/Qanary/blob/main/docs/adr/0021-wildcard-tcp-only-reachable-state.md).

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
