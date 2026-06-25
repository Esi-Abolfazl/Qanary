# 0005. Optimistic checking snapshot for lazy probing

- **Status:** accepted
- **Date:** 2026-06-18
- **Deciders:** Esi

## Context

Mutations (add/remove service or list, edit list, reset config) and explicit refresh must not block the UI on network probes. The backend `mutate()` helper already persists changes and spawns a background `run_cycle` without waiting — so the command returns immediately. The block was in the **frontend**: mutation handlers chained `await api.refreshNow()` after each mutation, and `refresh_now` awaits the entire probe cycle before returning. This froze the modal and the UI for the full probe duration (up to several seconds across all services).

A secondary issue: a freshly added service was invisible until the next probe emit, because the UI renders from `snapshot.lists`, not config. The snapshot is only updated after probing completes.

The design needed a way to show immediate, correct visual state (the new service exists; all services are being re-checked) without waiting for network results.

## Decision

The backend synchronously emits a synthetic "checking" snapshot immediately before any probe work begins:

1. A new pure function `checking_lists(config)` in `probe.rs` maps every enabled service to `ServiceState::Checking` with `all_down: false` — no I/O.
2. A helper `emit_checking(app)` in `lib.rs` builds a full `Snapshot` from this function (preserving current WAN info), stores it as the current snapshot, and emits the `status-update` event.
3. `emit_checking` is called: at the top of `refresh_now` (before `run_cycle`); inside `mutate()` after save and before spawning the background probe; inside `reset_config` after save and before spawning.
4. It is also called once at startup, right after `app.manage(AppState{..})`, so the first paint shows the lists in checking state instead of the "Starting first probe…" placeholder.

On the frontend, the blocking `await api.refreshNow()` calls after mutations are removed. The `status-update` listener is already wired up and handles both the synthetic checking snapshot and the real probe result when it arrives. All async buttons (refresh `↻`, modal submit, remove service/list, reset-to-defaults) now track a local `busy` boolean and disable + relabel while their underlying command is in flight.

## Alternatives considered

- **Frontend rebuilds a checking snapshot from config** — rejected because it would duplicate the `compute_all_down` / `overall_severity` rollup logic in TypeScript, creating two sources of truth for severity computation. The backend already owns all probe and rollup logic.
- **Accept the delay** — rejected because a multi-second freeze for every add/remove action is a significant UX regression, especially on slow or filtered connections where individual probes time out.

## Consequences

### Positive:

- Add/edit/remove/refresh return to the UI instantly; the row is visible and pulsing immediately.
- First paint shows the populated list instead of a placeholder text.
- All async controls disable during flight, preventing double-submits.
- The `status-update` event contract is unchanged — no frontend event schema migration.
- Rollup logic (`compute_all_down`, `overall_severity`) stays backend-only.

### Negative / accepted trade-offs:

- Each mutation emits one extra cheap (sync, no I/O) event before the real probe emit. There is a brief moment where all dots pulse `Checking`; this is the intended visual feedback.
- A minor 1-frame flicker is possible if the checking emit and the probe emit arrive in rapid succession; harmless since the final state wins.
- A rejected mutation (Tauri command error) leaves the modal open with `busy` cleared — the row reverts to its prior state when the next probe cycle runs. No explicit error toast is shown (out of scope for v1).

### Follow-ups:

- Toast / inline error display if a mutation command rejects (post-v1).
- Tray icon: can reuse `emit_checking` to pulse the tray dot on refresh (when tray is implemented).
