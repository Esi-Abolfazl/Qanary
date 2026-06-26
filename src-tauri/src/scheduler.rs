//! The per-Service probe scheduler.
//!
//! One async **Service probe task** per enabled Service owns its own cadence and last-known
//! state, and pushes a **Status delta** the instant its probe lands. A supervisor respawns all
//! tasks on config change; a broadcast "probe now" signal (manual Refresh) wakes them all. WAN
//! refresh is its own task that pushes a full `status-update` snapshot.
//!
//! This module is heavily commented — the reader is new to Rust.

use crate::models::{Service, ServiceDelta, ServiceStatus, Snapshot};
use crate::state::AppState;
use crate::{EVENT_SERVICE, EVENT_STATUS};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

// ---------------------------------------------------------------------------
// Cadence helpers — the "Effective interval" = jitter(backoff(base, fail_streak)).
// ---------------------------------------------------------------------------

/// How many consecutive failures before the backoff hits its ceiling. Each step doubles.
///
/// ponytail: fixed 2^streak doubling, capped at BACKOFF_CEILING. A flapping Service can't drift
/// past the ceiling. Upgrade path: make the multiplier configurable only if real outages show
/// the fixed curve is wrong.
const BACKOFF_MAX_SHIFT: u32 = 4; // 2^4 = 16× base at most

/// Hard ceiling on the backed-off interval, independent of `base`. Keeps a long-configured base
/// from compounding into minutes of silence while a Service is down.
const BACKOFF_CEILING: Duration = Duration::from_secs(120);

/// Grow the interval with the consecutive-failure streak: `base * 2^min(streak, MAX_SHIFT)`,
/// then clamp to `BACKOFF_CEILING`. A streak of 0 (healthy / just recovered) returns `base`.
pub fn backoff(base: Duration, fail_streak: u32) -> Duration {
    let shift = fail_streak.min(BACKOFF_MAX_SHIFT);
    // `base * 2^shift` via left-shift on the secs; saturating so we never overflow.
    let grown = base.saturating_mul(1u32 << shift);
    grown.min(BACKOFF_CEILING)
}

/// Spread of the random jitter as a fraction of the interval (±12.5%). Small relative to the
/// base so tasks de-correlate without meaningfully changing cadence.
const JITTER_FRAC: u32 = 8; // 1/8 = 12.5%

/// Add a small ± random spread so all tasks don't probe in lockstep. Randomness comes from the
/// system clock's nanosecond field — cheap and dependency-free; we don't need crypto-quality
/// randomness, just de-correlation.
///
/// ponytail: clock-nanos entropy instead of pulling in the `rand` crate. Swap to `rand` only if
/// a real statistical distribution is ever needed here.
pub fn jitter(d: Duration) -> Duration {
    let span = d / JITTER_FRAC; // full width of the ± window
    if span.is_zero() {
        return d;
    }
    // Nanos of "now" as a pseudo-random pick in [0, 2*span); subtract span to center on 0.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let window = span.as_millis().saturating_mul(2).max(1) as u64;
    let offset_ms = (nanos as u64) % window; // [0, 2*span)
    let centered = offset_ms as i64 - span.as_millis() as i64; // [-span, +span)
    let base_ms = d.as_millis() as i64;
    Duration::from_millis((base_ms + centered).max(0) as u64)
}

/// The actual sleep before a task's next probe.
pub fn effective_interval(base: Duration, fail_streak: u32) -> Duration {
    jitter(backoff(base, fail_streak))
}

// ---------------------------------------------------------------------------
// Service probe task
// ---------------------------------------------------------------------------

/// Minimum probe interval so a misconfigured base can't hammer the network. Mirrors the floor
/// applied in `update_settings`.
const MIN_INTERVAL_SECS: u64 = 10;

/// Pick a Service's base interval from its parent list's criticality, then apply the floor.
/// Pure so it's unit-testable without an `AppHandle`.
pub fn base_interval(critical: bool, critical_secs: u64, noncritical_secs: u64) -> u64 {
    let secs = if critical { critical_secs } else { noncritical_secs };
    secs.max(MIN_INTERVAL_SECS)
}

/// One **Service probe task**: probe this Service forever, pushing a Status delta each time, on a
/// cadence it owns. Runs until aborted by the supervisor (config change).
///
/// `signal_rx` is this task's subscription to the shared "probe now" broadcast — a manual Refresh
/// wakes every task at once.
async fn run_service_task(
    app: AppHandle,
    list_id: String,
    service: Service,
    mut signal_rx: tokio::sync::broadcast::Receiver<()>,
) {
    // Task-local failure streak — drives backoff. Not stored in AppState; lives only here.
    let mut fail_streak: u32 = 0;

    loop {
        // Read the live base interval + timeout under the lock, then DROP the guard before any
        // await (the config can mutate; we always pick up the latest). Honour the floor.
        let (base, timeout_ms, client, sem) = {
            let state = app.state::<AppState>();
            let cfg = state.config.lock().unwrap();
            // Base interval is decided by this Service's parent list criticality.
            let critical = cfg
                .lists
                .iter()
                .find(|l| l.id == list_id)
                .map(|l| l.critical)
                .unwrap_or(false);
            let base = Duration::from_secs(base_interval(
                critical,
                cfg.critical_interval_secs,
                cfg.noncritical_interval_secs,
            ));
            (base, cfg.timeout_ms, state.client.clone(), state.probe_sem.clone())
        };

        // Probe with NO lock held (network I/O).
        let status = crate::probe::probe_service(&service, &client, &sem, timeout_ms).await;

        // Update the streak from this probe's outcome.
        if status.fully_failing() {
            fail_streak = fail_streak.saturating_add(1);
        } else {
            fail_streak = 0;
        }

        // Merge this Service's status into the shared snapshot and recompute rollups. The lock is
        // held only for this synchronous block — never across an await (state.rs invariant).
        if let Some(delta) = apply_service_status(&app, &list_id, status) {
            let overall = delta.overall;
            let _ = app.emit(EVENT_SERVICE, &delta);
            crate::tray::update_icon(&app, overall);
        }

        // Wait the effective interval, but wake early on a "probe now" signal.
        let wait = effective_interval(base, fail_streak);
        tokio::select! {
            _ = tokio::time::sleep(wait) => {}
            recv = signal_rx.recv() => {
                // On a manual refresh, settle briefly so the UI's checking paint lands first.
                if recv.is_ok() {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
                // recv Err (lagged/closed) just falls through to re-probe — harmless.
            }
        }
    }
}

/// Replace one Service's status inside the live snapshot, recompute that List's `all_down` and the
/// overall Severity, and return the Status delta to emit. Returns `None` if there's no snapshot yet
/// or the list/service id is unknown (nothing to update).
///
/// Load-bearing: the snapshot `Mutex` is taken and dropped entirely within this synchronous
/// function — no `.await` happens while it's held.
fn apply_service_status(app: &AppHandle, list_id: &str, status: ServiceStatus) -> Option<ServiceDelta> {
    let state = app.state::<AppState>();
    let mut guard = state.snapshot.lock().unwrap();
    let snap = guard.as_mut()?;
    recompute_delta(snap, list_id, status)
}

/// Pure rollup: replace the Service in `list_id`, recompute that List's `all_down` and the overall
/// Severity (writing both back into `snap`), and return the Status delta to emit. `None` on an
/// unknown list/service id. Split out from `apply_service_status` so it's unit-testable without an
/// `AppHandle`.
fn recompute_delta(snap: &mut Snapshot, list_id: &str, status: ServiceStatus) -> Option<ServiceDelta> {
    let list = snap.lists.iter_mut().find(|l| l.id == list_id)?;
    let slot = list.services.iter_mut().find(|s| s.id == status.id)?;
    *slot = status.clone();

    // A List is all_down when it has services and every one is fully failing.
    list.all_down = !list.services.is_empty() && list.services.iter().all(|s| s.fully_failing());
    let list_all_down = list.all_down; // read before releasing the &mut for the overall recompute

    let overall = crate::probe::overall_severity(&snap.lists);
    snap.overall = overall;

    Some(ServiceDelta {
        list_id: list_id.to_string(),
        service: status,
        list_all_down,
        overall,
    })
}

// ---------------------------------------------------------------------------
// Supervisor + WAN task
// ---------------------------------------------------------------------------

/// Abort all running Service probe tasks and spawn a fresh one per enabled Service. Called on
/// startup and after every config mutation.
///
/// ponytail: abort-all then respawn-all — mutations are rare and user-driven, so per-Service task
/// diffing isn't worth it. Add diffing only if respawn churn ever shows up as a problem.
pub fn respawn_tasks(app: &AppHandle) {
    let state = app.state::<AppState>();

    // Stop the old generation first so we never double-probe a Service.
    {
        let mut tasks = state.tasks.lock().unwrap();
        for handle in tasks.drain(..) {
            handle.abort();
        }
    }

    // Snapshot what to spawn from the current config (clone out, drop the lock).
    let plan: Vec<(String, Service)> = {
        let cfg = state.config.lock().unwrap();
        cfg.lists
            .iter()
            .flat_map(|list| {
                let list_id = list.id.clone();
                list.services
                    .iter()
                    .filter(|s| s.enabled)
                    .map(move |s| (list_id.clone(), s.clone()))
            })
            .collect()
    };

    let mut handles = Vec::with_capacity(plan.len());
    for (list_id, service) in plan {
        let app = app.clone();
        let signal_rx = state.probe_now.subscribe();
        // tauri::async_runtime::spawn carries its own runtime handle, so this works from `setup`
        // (the main thread, with no Tokio reactor in scope). Its JoinHandle has `.abort()` too.
        handles.push(tauri::async_runtime::spawn(run_service_task(
            app, list_id, service, signal_rx,
        )));
    }
    *state.tasks.lock().unwrap() = handles;
}

/// Refresh WAN every ~5 min (and on a "probe now" signal). Pushes a full `status-update` snapshot
/// reusing the existing event + frontend listener, rather than inventing a WAN-specific delta.
const WAN_REFRESH: Duration = Duration::from_secs(300);

/// Spawn the single WAN task. Built once in `setup`.
pub fn spawn_wan_task(app: &AppHandle) {
    let app = app.clone();
    let mut signal_rx = app.state::<AppState>().probe_now.subscribe();
    tauri::async_runtime::spawn(async move {
        loop {
            // Clone client + providers out of the lock before awaiting.
            let (client, providers) = {
                let state = app.state::<AppState>();
                let cfg = state.config.lock().unwrap();
                (state.client.clone(), cfg.ip_providers.clone())
            };

            if let Some(info) = crate::wan::fetch_wan(&client, &providers).await {
                *app.state::<AppState>().wan.lock().unwrap() = Some(info);
            }

            // Rebuild a full snapshot from the current per-Service statuses + the fresh WAN, store
            // and emit it. The Service tasks own the lists; we only refresh `wan` + `overall`.
            let snapshot = {
                let state = app.state::<AppState>();
                let wan = state.wan.lock().unwrap().clone();
                let mut guard = state.snapshot.lock().unwrap();
                guard.as_mut().map(|snap| {
                    snap.wan = wan;
                    snap.clone()
                })
            };
            if let Some(snap) = snapshot {
                let overall = snap.overall;
                let _ = app.emit(EVENT_STATUS, &snap);
                crate::tray::update_icon(&app, overall);
            }

            // Refresh on schedule; retry sooner while WAN is still unknown; wake on manual refresh.
            let known = app.state::<AppState>().wan.lock().unwrap().is_some();
            let wait = if known { WAN_REFRESH } else { Duration::from_secs(10) };
            tokio::select! {
                _ = tokio::time::sleep(wait) => {}
                _ = signal_rx.recv() => {}
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_grows_with_streak_and_caps() {
        let base = Duration::from_secs(5);
        assert_eq!(backoff(base, 0), base, "streak 0 → base");
        assert_eq!(backoff(base, 1), Duration::from_secs(10), "doubles each step");
        assert_eq!(backoff(base, 2), Duration::from_secs(20));
        // 2^4 = 16× → 80s, still under the 120s ceiling.
        assert_eq!(backoff(base, 4), Duration::from_secs(80));
        // Shift is capped at MAX_SHIFT, so streak 9 == streak 4 here.
        assert_eq!(backoff(base, 9), backoff(base, 4));
        // A larger base hits the ceiling.
        assert_eq!(backoff(Duration::from_secs(60), 4), BACKOFF_CEILING);
    }

    #[test]
    fn base_interval_picks_by_criticality_and_floors() {
        assert_eq!(base_interval(true, 20, 60), 20, "critical → critical_secs");
        assert_eq!(base_interval(false, 20, 60), 60, "non-critical → noncritical_secs");
        // Below the floor → clamped to MIN_INTERVAL_SECS (10).
        assert_eq!(base_interval(true, 3, 60), 10, "critical below floor clamps to 10");
        assert_eq!(base_interval(false, 20, 1), 10, "non-critical below floor clamps to 10");
    }

    #[test]
    fn jitter_stays_within_bounds() {
        let d = Duration::from_secs(8);
        let span = d / JITTER_FRAC; // 1s
        for _ in 0..200 {
            let j = jitter(d);
            assert!(j >= d - span, "jitter {j:?} below lower bound");
            assert!(j <= d + span, "jitter {j:?} above upper bound");
        }
    }

    #[test]
    fn jitter_zero_interval_is_noop() {
        assert_eq!(jitter(Duration::ZERO), Duration::ZERO);
    }

    // ----- delta rollup -----

    use crate::models::{EndpointStatus, ListStatus, ServiceState, Severity};

    fn svc(id: &str, state: ServiceState) -> ServiceStatus {
        ServiceStatus {
            id: id.into(),
            label: id.into(),
            state,
            endpoints: vec![EndpointStatus {
                id: format!("{id}-e"),
                host: "h".into(),
                state,
                latency_ms: None,
            }],
        }
    }

    fn snap_with(critical: bool, services: Vec<ServiceStatus>) -> Snapshot {
        Snapshot {
            lists: vec![ListStatus {
                id: "l1".into(),
                name: "L".into(),
                icon: "".into(),
                all_down: false,
                services,
                collapsed: false,
                critical,
            }],
            overall: Severity::Green,
            wan: None,
        }
    }

    #[test]
    fn delta_replaces_service_and_recomputes_rollup() {
        // Critical list, two services: one already Down, one Up. Flip the Up one to Down → the
        // whole list is now all_down → overall Red.
        let mut snap = snap_with(true, vec![svc("a", ServiceState::Down), svc("b", ServiceState::Up)]);
        let delta = recompute_delta(&mut snap, "l1", svc("b", ServiceState::Down)).unwrap();

        assert_eq!(delta.service.id, "b");
        assert_eq!(delta.service.state, ServiceState::Down, "service replaced");
        assert!(delta.list_all_down, "every service now fully failing");
        assert_eq!(delta.overall, Severity::Red, "critical list all_down → Red");
        // Written back into the snapshot too.
        assert!(snap.lists[0].all_down);
        assert_eq!(snap.overall, Severity::Red);
    }

    #[test]
    fn delta_recovery_clears_all_down() {
        let mut snap = snap_with(true, vec![svc("a", ServiceState::Down), svc("b", ServiceState::Down)]);
        snap.lists[0].all_down = true;
        let delta = recompute_delta(&mut snap, "l1", svc("b", ServiceState::Up)).unwrap();
        assert!(!delta.list_all_down, "one service back up → not all_down");
        assert_eq!(delta.overall, Severity::Green);
    }

    #[test]
    fn delta_unknown_ids_return_none() {
        let mut snap = snap_with(false, vec![svc("a", ServiceState::Up)]);
        assert!(recompute_delta(&mut snap, "nope", svc("a", ServiceState::Down)).is_none());
        assert!(recompute_delta(&mut snap, "l1", svc("ghost", ServiceState::Down)).is_none());
    }
}
