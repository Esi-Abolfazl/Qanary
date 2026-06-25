# 0014. Per-Service probe tasks with Status deltas

- **Status:** accepted
- **Date:** 2026-06-25
- **Deciders:**

## Context

The probe engine ran a single shared loop. Within a List, Services were probed
**sequentially** (`probe_list` awaited each Service in turn); Lists themselves were probed
sequentially (`probe_all`). Only a Service's own Endpoints fanned out concurrently. The
consequence: one slow or timing-out host stalled the entire round, so the whole UI lagged
behind a single unreachable Service.

The loop also emitted **one full snapshot per round**. Every Service dot therefore updated
together, at the cadence of the slowest probe in the round — never as each individual probe
landed. The requester wanted the experience to be *fast* (no head-of-line blocking) and
*smooth* (each dot refreshes the instant its own probe resolves).

An earlier iteration had `probe_gen` / `netwatch` / `force_round` / backoff-jitter machinery,
but that was reverted; the starting point for this change was the flat shared loop. The
transition/alert/notify logic lives entirely on the frontend (it diffs consecutive snapshots
for critical-List `all_down` crossings) and had to keep working unchanged.

## Decision

Replace the shared loop with **one independent async task per enabled Service**. Each
**Service probe task** owns its own cadence and its task-local failure streak, and pushes a
**Status delta** (`service-update` event) the instant its probe lands — that Service's new
status plus its List's recomputed `all_down` and the new overall `Severity`. The frontend
merges the delta into its local Snapshot (`mergeDelta`) and then runs the *unchanged*
transition/alert diff against the merged snapshot.

Supporting pieces:

- A shared `Arc<Semaphore>` (the existing `MAX_CONCURRENT = 8`) now lives in `AppState` and
  bounds total simultaneous Endpoint probes across all tasks, so N tasks can't open
  N×Endpoints sockets at once.
- The **effective interval** each task sleeps is `jitter(backoff(probe_interval_secs,
  fail_streak))` — backoff grows the interval while a Service keeps failing (doubling, capped
  at 16× the base and a hard 120 s ceiling); jitter adds a small ±12.5% spread so tasks
  de-correlate. Jitter draws entropy from the system clock's nanosecond field rather than
  adding a `rand` dependency.
- A **supervisor** (`respawn_tasks`) aborts all live task handles and spawns a fresh set on
  startup and after every config mutation. Handles are owned solely in `AppState.tasks`.
- A `tokio::sync::broadcast` **"probe now"** signal, fired by `refresh_now` (the manual
  Refresh button) and the tray "Refresh now" menu item, wakes every task at once.
- **WAN** refresh became its own task: a ~5 min timer (retrying sooner while WAN is still
  unknown, and waking on "probe now") that pushes a full `status-update` snapshot, reusing the
  existing event and frontend listener rather than inventing a WAN-specific delta.
- Deleted: `run_cycle`, `probe_all`, `probe_list`, the background loop, and
  `WAN_REFRESH_EVERY`.

The snapshot `Mutex` is never held across an `.await`: each task probes with no lock held,
then takes the lock only for the synchronous replace-service + recompute-rollup + clone, and
drops it before emitting.

## Alternatives considered

- **Just parallelise the round (concurrent `probe_all`)** — rejected. It removes the
  head-of-line blocking (fast) but still emits one full snapshot per round, so dots update
  together, not as each probe lands (not smooth).
- **Concurrent round with per-Service emit inside one loop** — rejected. Gets most of the
  smoothness, but the requester chose the full per-task lifecycle (each task owning its own
  cadence and backoff), which a single shared loop can't express.
- **Flat interval, no backoff/jitter** — rejected. The requester chose to re-introduce
  backoff (so a persistently-down Service is probed less aggressively) and jitter (so tasks
  don't all fire in lockstep).
- **Add the `rand` crate for jitter** — rejected as over-reach for a de-correlation spread;
  clock-nanosecond entropy is dependency-free and good enough. (Upgrade path noted in code.)

## Consequences

## **Positive:**

- Full concurrency: a slow or Down Service no longer delays any other Service's dot.
- Per-dot smoothness: each Service updates as its own probe resolves.
- Reuses the existing Endpoint fan-out and shared semaphore, so the backend stays small.
- The frontend transition/alert/notify path is untouched — deltas just feed it coherent
  merged snapshots, and `mergeDelta` is a pure, unit-tested function.
- Additive event contract: `service-update` is new; `status-update` is retained (WAN +
  initial), so a reverted backend still drives the UI with no frontend change.

## **Negative / accepted trade-offs:**

- A new event contract plus a supervisor/task lifecycle to manage (abort-all-then-respawn on
  every config mutation). Acceptable because mutations are rare and user-driven; per-Service
  task diffing is deferred until respawn churn is ever shown to matter.
- Backoff + jitter add a small amount of per-task cadence state (the task-local failure
  streak). The backoff ceiling caps how far a flapping Service can drift.
- The shared semaphore is acquired at Endpoint granularity, so a Service with many Endpoints
  can briefly hog permits and slow others' progress (total in-flight sockets stay ≤ 8).
  Acceptable at current List sizes; a per-Service permit cap is the upgrade path if
  starvation ever matters.

## **Follow-ups:**

- Network-change-triggered re-probe (netwatch) is explicitly out of scope — separate future
  work.
- Consider per-Service task diffing on config mutation if respawn churn becomes a problem.
- Consider a per-Service permit cap if Endpoint-granularity semaphore starvation appears.
