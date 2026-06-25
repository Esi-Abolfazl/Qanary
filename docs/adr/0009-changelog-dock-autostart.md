# 0009. Launch-on-login, hide-in-dock, and post-update changelog for Qanary

- **Status:** accepted
- **Date:** 2026-06-22
- **Deciders:** Esi-Abolfazl

## Context

Three desktop-integration features were missing from Qanary:

1. **Post-update changelog.** The self-update mechanism (ADR 0001) downloads, installs, and
   relaunches the app, but never surfaces what changed. The `@tauri-apps/plugin-updater`
   already provides `update.version` and `update.body` (GitHub release notes), but these
   values live in JavaScript module state that does not survive the process restart triggered
   by `relaunch()`. The notes must be persisted somewhere durable before the old process
   exits.

2. **Hide-in-dock (macOS).** Qanary runs as a tray/menu-bar monitor (ADR 0008). Some users
   want it to be completely invisible from the Dock — a common pattern for tray-resident
   utilities on macOS. The macOS Cocoa framework exposes this via `NSApplication
   setActivationPolicy:NSApplicationActivationPolicyAccessory`, which hides the Dock icon
   and removes the app from the Cmd-Tab switcher.

3. **Launch-on-login.** A connectivity monitor is most useful when it starts automatically.
   macOS supports login items via LaunchAgents. Tauri v2 provides `tauri-plugin-autostart`
   which wraps platform-specific startup registration behind a single cross-platform JS API.
   Because Qanary normally launches with its window visible, the autostart registration needs
   a flag that tells it to start hidden (tray-only).

## Decision

**Post-update changelog:** Persist `{version, body}` to `config.json` via a new backend
command (`set_pending_changelog`) immediately before the updater's `install()` call. On the
next startup, `App.tsx` compares the stored version against the running version (via
`@tauri-apps/api/app getVersion()`). On a match it shows a `ChangelogModal` once, then
clears the persisted data. A version mismatch (stale data from a failed/mismatched update)
also clears silently. The `config.json` store is the only mechanism that survives the
process restart, making it the right place to park this data.

**Hide-in-dock:** Add a `hide_dock: bool` field (default `false`) to `Config`. A backend
command (`set_hide_dock`) persists the value and immediately applies
`AppHandle::set_activation_policy(ActivationPolicy::Accessory | Regular)`, which is live on
macOS in Tauri v2 (confirmed at `tauri-2.11.2/src/app.rs:640`). The flag is also re-applied
during `setup()` so the preference survives restarts. The Settings UI shows the toggle only
on macOS (`navigator.userAgent` contains "Mac").

**Launch-on-login:** Register `tauri-plugin-autostart` (v2) in `Cargo.toml` and `lib.rs`,
using the `MacosLauncher::LaunchAgent` backend with `args: ["--hidden"]`. On startup,
`setup()` checks `std::env::args()` for `--hidden` and hides the main window if found,
reusing the existing close-to-tray mechanism. The Settings UI reads the OS state via
`isEnabled()` and writes it via `enable()`/`disable()`. Autostart state is not mirrored
to config — the OS is the single source of truth. A permission failure (missing
`autostart:default` capability) surfaces as an inline error in the toggle row instead of
failing silently.

## Alternatives considered

- **Fetch changelog from GitHub API post-relaunch** — rejected. Requires an extra network
  request, a GitHub API token for private repos, and adds latency. We already hold the body
  at install time; persisting it to disk is simpler and works offline.
- **Mirror autostart state in config** — rejected. `isEnabled()` from the plugin already
  queries the OS at the one place where the state lives. A config copy would become stale
  any time the user modifies Login Items externally.
- **Markdown-render the changelog body** — deferred. The GitHub release body is typically
  Markdown. A `<pre>` block is acceptable for now and requires no additional library. Can be
  upgraded to a renderer if the formatted notes are important to the user experience.
- **Apply hide-dock only on restart** — rejected. `AppHandle::set_activation_policy` works
  live; making the toggle immediate is a strictly better UX with no extra cost.

## Consequences

**Positive:**
- Three integration features land with one new dependency (`tauri-plugin-autostart`).
- Changelog display is fully offline — no post-relaunch network call.
- Hide-dock applies instantly without a restart.
- Autostart registration uses the platform-recommended LaunchAgent path on macOS.
- Degraded gracefully: permission failures show an inline error; stale changelog data
  self-clears on version mismatch.

**Negative / accepted trade-offs:**
- `hide_dock` is macOS-only. The Settings row is hidden on other OSes until a per-platform
  equivalent is implemented.
- A stored `pending_changelog` entry lingers in `config.json` until the target version
  runs. It is self-clearing and harmless but is visible to anyone who hand-edits the file.
- `navigator.userAgent` for macOS detection is an approximation; it is overridable but
  has no known failure mode in the Tauri webview context.

**Follow-ups:**
- Consider markdown rendering of the changelog body (replace `<pre>` with a renderer).
- Extend autostart + hide-dock to Windows/Linux when those platforms are targeted.
- Validate that `--hidden` is not passed by macOS system invocations other than our
  LaunchAgent (unlikely but worth a smoke test on a release build).
