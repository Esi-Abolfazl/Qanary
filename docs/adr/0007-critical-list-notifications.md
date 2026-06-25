# 0007. Critical-List notifications via notification plugin, detected frontend-side

- **Status:** accepted
- **Date:** 2026-06-21
- **Deciders:** Esi

## Context

Qanary needs to alert the user when a **critical** list crosses its `all_down`
boundary — an outage (`false→true`) or a recovery (`true→false`), the project's
_Transition_ concept. Two forces shaped the design:

- A native OS notification is the only way to surface a state change while the
  window is minimized, and Tauri has no built-in notification API — this requires
  a new dependency.
- The project convention (CLAUDE.md) is "backend owns probe/rollup/persistence;
  tray reuses the snapshot." Detection naturally belongs in the backend. But sound
  playback is web-only — there is no Rust audio path today — and the webview is the
  sole consumer of snapshots until a tray exists. Putting detection in the backend
  would split the alert across two layers for no present benefit.

## Decision

- Add `tauri-plugin-notification` (Rust + JS halves) and grant the
  `notification:default` capability.
- Detect _Transitions_ in the **frontend** by diffing consecutive snapshots
  (`criticalTransitions` in `src/utils/transitions.ts`), keeping the previous
  snapshot in a `useRef`. The snapshot already exposes `all_down` and `critical`,
  so no backend contract changes.
- Gate notification and sound independently with two persisted `Config` flags
  (`notify_enabled`, `sound_enabled`), defaulting to `true`, threaded through
  `update_settings` and the Settings UI.
- Play the alert sound in the webview via HTML5 `Audio`. Re-encode the source
  clips from `.wav` to mp3 (48 kHz stereo, 192 kbps) and drop the wavs.
- Suppress alerts on the first snapshot after load (no prior baseline) to avoid an
  alert storm on launch; `checking` is never a failure so `all_down` stays false
  during the initial paint.

## Alternatives considered

- **Backend detection + Rust audio crate (e.g. `rodio`)** — rejected: a heavier
  dependency, and sound would still need the webview anyway. There is no tray
  consumer yet, so moving detection to the backend now is premature (YAGNI).
- **Web Notification API without the plugin** — rejected: unreliable in WkWebView
  and it lacks a proper permission flow.
- **Keep the `.wav` sources** — rejected: ~1.8 MB for two short blips; mp3 at
  192 kbps is clean and small.

## Consequences

## **Positive:**

- Smallest diff; the backend stays minimal (the author is new to Rust).
- The snapshot contract is unchanged — `all_down` and `critical` were already
  exposed to the frontend.
- Notification and sound toggle independently and persist across restarts; the
  `serde(default)` flags keep old and new `config.json` mutually compatible.

## **Negative / accepted trade-offs:**

- Deviates from "backend owns rollup." When a tray ships, detection must move to
  the backend so tray and window share one alert source.
- No notifications while the app is fully closed (no background process pre-tray).

## **Follow-ups:**

- When the tray lands, relocate _Transition_ detection to the backend and have the
  tray and webview consume a single alert signal.
