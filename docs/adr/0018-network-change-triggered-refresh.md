# 0018. Network-change-triggered refresh via SCDynamicStore (macOS) + if-watch

- **Status:** accepted
- **Date:** 2026-06-26
- **Deciders:** Esi-Abolfazl

## Context

Qanary previously probed services only on a per-Service interval timer (30 s for critical lists,
60 s for non-critical, configurable via ADR-0017). When the system network state changed — wifi
toggled off then on, an ethernet cable plugged in, or a VPN brought up — status remained stale for
up to a minute until the next scheduled probe fired. This was especially noticeable with VPNs: a
user who just connected a VPN wanted to see updated intranet reachability immediately, not after
waiting out their interval.

Two requirements shaped the design:

1. **Sub-second latency on macOS** for wifi/ethernet/VPN transitions. The `if-watch` crate, while
   event-driven on Linux and Windows, uses a ~10 s polling backend on macOS — too slow.

2. **Split-tunnel VPN detection.** Split-tunnel VPNs route specific traffic through the tunnel
   without changing interface IPs. `if-watch` on macOS monitors interface IP changes, so it misses
   these. The macOS `SCDynamicStore` can watch route-table keys
   (`State:/Network/Service/.*/IPv4`) that change when split-tunnel routes are added.

## Decision

Add a `netwatch` background module (`src-tauri/src/netwatch.rs`) that fires the existing
`probe_now` broadcast whenever the OS network state changes. The module:

- Coalesces events with a **~500 ms debounce** (VPN bring-up fires several route changes within
  milliseconds; debounce collapses these into one probe round).
- Calls the **same `trigger` path** as the manual refresh button (`emit_checking` + `probe_now.send`),
  reusing all existing probe/rollup logic without any consumer changes.
- Spawns once in `lib.rs::setup`, after `spawn_wan_task`, via `netwatch::spawn_netwatch_task`.

Two detection layers feed the debounce channel:

**Layer 1 — `if-watch` (all platforms)**  
`if_watch::tokio::IfWatcher` runs as a tokio task on all platforms. On Linux it is event-driven
via netlink; on Windows via `NotifyIpInterfaceChange`. On macOS it polls every ~10 s and serves
only as a backstop (the SCDynamicStore layer covers mac with sub-second latency). Errors are
logged and cause this task to exit; the other layer and the interval timer remain.

**Layer 2 — SCDynamicStore (macOS only)**  
`SCDynamicStoreBuilder` from the `system-configuration 0.6` crate watches three key groups:
- `State:/Network/Global/IPv4` — default route / primary interface (wifi, ethernet)
- `State:/Network/Interface/.*/IPv4` — per-interface IP changes
- `State:/Network/Service/.*/IPv4` — per-service route changes (split-tunnel VPNs)

The `SCDynamicStore` callback API requires a `CFRunLoop` that does not exist on tokio worker
threads. The watcher runs on a dedicated `std::thread` with its own `CFRunLoop::run_current()`.
Events are forwarded into the debounce channel via `blocking_send` (safe on an OS thread). The
`system-configuration` crate provides a safe callback wrapper (`SCDynamicStoreCallBackT<T>`) that
takes a regular Rust `fn` with `info: &mut T` — no `extern "C"` or unsafe pointer casting needed
in application code.

**New dependencies (all additive, no schema or config changes):**

| Crate | Version | Use |
|---|---|---|
| `if-watch` | `3` (features: `tokio`) | Cross-platform interface events |
| `futures-util` | `0.3` | `StreamExt::next()` for the if-watch stream |
| `system-configuration` | `0.6` (macOS only) | SCDynamicStore bindings |
| `core-foundation` | `0.9` (macOS only) | `CFRunLoop`, `CFArray`, `CFString` |

## Alternatives considered

- **`if-watch` alone** — rejected: ~10 s latency on macOS (polling backend); no split-tunnel VPN
  detection (misses `State:/Network/Service/.*/IPv4` route changes).

- **Short polling timer (e.g. 1–2 s)** — rejected: defeats the goal of event-driven responsiveness;
  introduces constant background wakeups regardless of network activity; the interval-timer
  mechanism is already available as the safety floor.

- **Hand-rolled `PF_ROUTE` socket parsing** — rejected: significantly more code; `system-configuration`
  is a maintained crate that already covers the macOS route-table use case cleanly.

- **`SCDynamicStore` on a tokio worker thread** — rejected: `CFRunLoop` does not exist on tokio
  workers; attempting this would hang or panic at runtime.

## Consequences

### Positive:

- macOS status reflects connectivity changes within ≈1 s after wifi toggle, ethernet plug, or VPN
  connect/disconnect — without polling.
- Trigger reuses the existing `probe_now` broadcast — zero changes to probe, rollup, or UI event
  logic. The `refresh_now` command already exercises this path.
- Watcher failures are isolated: each layer logs and exits independently; the interval timer is
  the safety floor for both.
- No persisted state, no config/contract change, no migration. Rollback = remove one line
  in `lib.rs` (`netwatch::spawn_netwatch_task`) and three dep entries in `Cargo.toml`.

### Negative / accepted trade-offs:

- Three new dependencies (four counting `core-foundation` as a separate crate on macOS). All are
  maintained, Mac-first-class crates (Mullvad VPN maintains `system-configuration`; `if-watch` is
  widely used).
- macOS requires a dedicated OS thread for the CFRunLoop. One additional thread is negligible for
  a desktop app.
- `if-watch` on macOS provides only ~10 s backstop latency — but this is harmless: the SCDynamicStore
  layer delivers sub-second latency on mac, and the `if-watch` backstop costs nothing when idle.
- Non-macOS `if-watch` paths (Linux, Windows) ship build-tested on macOS only (mac-only CI today).
  `if-watch` is a maintained cross-platform crate; the interval timer is the safety floor.

### Follow-ups:

- Manual smoke tests (§5 of the implementation plan) — run once after next app launch:
  toggle wifi off→on, connect/disconnect a VPN, observe `netwatch: probe triggered` in logs and
  instant UI repaint.
- If watcher errors occur in production, add retry logic or exponential backoff per-watcher.
