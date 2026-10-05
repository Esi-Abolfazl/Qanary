//! The per-Service probe scheduler.
//!
//! One async **Service probe task** per enabled Service owns its own cadence and last-known
//! state, and pushes a **Status delta** the instant its probe lands. A supervisor respawns all
//! tasks on config change; a broadcast "probe now" signal (manual Refresh) wakes them all. WAN
//! refresh is its own task that pushes a full `status-update` snapshot.
//!
//! This module is heavily commented — the reader is new to Rust.

use crate::models::{
    worst_state, EndpointStatus, Service, ServiceDelta, ServiceState, ServiceStatus, Severity, Snapshot,
};
use crate::state::AppState;
use crate::{EVENT_SERVICE, EVENT_STATUS};
use std::sync::atomic::Ordering;
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

/// Ceiling on how far backoff can *grow* the interval. Keeps a short base from compounding into
/// minutes of silence while a Service is down. Never shortens a base the user set above it.
const BACKOFF_CEILING: Duration = Duration::from_secs(120);

/// Grow the interval with the consecutive-failure streak: `base * 2^min(streak, MAX_SHIFT)`,
/// capped at `max(BACKOFF_CEILING, base)`. A streak of 0 (healthy / just recovered) returns `base`,
/// and a configured 600s stays 600s (audit A07).
pub fn backoff(base: Duration, fail_streak: u32) -> Duration {
    let shift = fail_streak.min(BACKOFF_MAX_SHIFT);
    // `base * 2^shift` via left-shift on the secs; saturating so we never overflow.
    let grown = base.saturating_mul(1u32 << shift);
    grown.min(BACKOFF_CEILING.max(base))
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
    generation: u64,
) {
    // Task-local failure streak — drives backoff. Not stored in AppState; lives only here.
    let mut fail_streak: u32 = 0;

    loop {
        // Read the live base interval + timeout under the lock, then DROP the guard before any
        // await (the config can mutate; we always pick up the latest). Honour the floor.
        let (base, timeout_ms, client, sem, memory) = {
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
            (base, cfg.timeout_ms, state.probe_client.clone(), state.probe_sem.clone(), state.block_memory.clone())
        };

        // Probe with NO lock held (network I/O).
        let status =
            crate::probe::probe_service(&service, &client, &sem, timeout_ms, &memory).await;

        // Update the streak from this probe's outcome.
        if status.fully_failing() {
            fail_streak = fail_streak.saturating_add(1);
        } else {
            fail_streak = 0;
        }

        // Merge this Service's status into the shared snapshot, recompute rollups, and emit the
        // delta. The lock is held only for this synchronous block — never across an await.
        if let Some((overall, cut_off, settled)) = apply_service_status(&app, &list_id, generation, status) {
            crate::tray::update_icon(&app, overall, cut_off, settled);
        }

        // Wait the effective interval, but wake early on a "probe now" signal.
        let wait = effective_interval(base, fail_streak);
        tokio::select! {
            _ = tokio::time::sleep(wait) => {}
            recv = signal_rx.recv() => {
                // On a refresh, settle briefly so the UI's checking paint lands first.
                if recv.is_ok() {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
                // recv Err (lagged/closed) just falls through to re-probe — harmless.
            }
        }
    }
}

/// Replace one Service's status inside the live snapshot, recompute that List's `all_down` and the
/// overall Severity, emit the Status delta, and return the new (overall, cut_off, settled). Returns `None`
/// (and emits nothing) for a result from a superseded task generation, before the first snapshot,
/// or for an unknown list/service id.
///
/// Load-bearing: the snapshot `Mutex` is taken and dropped entirely within this synchronous
/// function — no `.await` happens while it's held. The generation check and the emit both happen
/// under it, so a stale result can't slip in after `respawn_tasks` and deltas leave in order.
fn apply_service_status(
    app: &AppHandle,
    list_id: &str,
    generation: u64,
    status: ServiceStatus,
) -> Option<(Severity, bool, bool)> {
    let state = app.state::<AppState>();
    let mut guard = state.snapshot.lock().unwrap();
    let current = state.generation.load(Ordering::SeqCst);
    let delta = accept_result(guard.as_mut()?, current, generation, list_id, status)?;
    crate::probe::note_cut_off(&state.was_cut_off, &state.block_memory, delta.cut_off);
    let _ = app.emit(EVENT_SERVICE, &delta);
    Some((delta.overall, delta.cut_off, delta.settled))
}

// ---------------------------------------------------------------------------
// One-off checks ("check this one now")
// ---------------------------------------------------------------------------

/// A Service's status with some endpoints put back to `Checking` — all of them when
/// `endpoint_id` is `None`, else just that one — so the UI can show "being re-checked" at once.
/// Pure. The Service's own state is rolled up again from its endpoints.
pub fn checking_status(current: &ServiceStatus, endpoint_id: Option<&str>) -> ServiceStatus {
    let mut s = current.clone();
    for ep in s.endpoints.iter_mut() {
        if endpoint_id.is_none_or(|id| ep.id == id) {
            ep.state = ServiceState::Checking;
            ep.latency_ms = None;
            ep.cause = None;
        }
    }
    s.state = worst_state(&s.endpoints.iter().map(|e| e.state).collect::<Vec<_>>());
    s
}

/// A Service's status with one endpoint's fresh result swapped in and the Service's state rolled
/// up again. An endpoint that is no longer in the Service (it was edited meanwhile) changes nothing.
pub fn merge_endpoint(current: &ServiceStatus, fresh: &EndpointStatus) -> ServiceStatus {
    let mut s = current.clone();
    if let Some(slot) = s.endpoints.iter_mut().find(|e| e.id == fresh.id) {
        *slot = fresh.clone();
    }
    s.state = worst_state(&s.endpoints.iter().map(|e| e.state).collect::<Vec<_>>());
    s
}

/// Put a Service (or one of its endpoints) back to `Checking` in the snapshot **without touching
/// the rollups**: `all_down`, `overall`, `cut_off` and `settled` stay exactly as they were, and
/// the returned delta carries those unchanged values. Re-checking one site is local — it must not
/// make the whole app look like it is refreshing (gray orb), nor flip an Offline machine out of
/// "offline" for the length of one probe. The real result later goes through `recompute_delta`.
/// `None` for an unknown list/service.
pub fn mark_checking(
    snap: &mut Snapshot,
    list_id: &str,
    service_id: &str,
    endpoint_id: Option<&str>,
) -> Option<ServiceDelta> {
    let list = snap.lists.iter_mut().find(|l| l.id == list_id)?;
    let slot = list.services.iter_mut().find(|s| s.id == service_id)?;
    *slot = checking_status(slot, endpoint_id);
    Some(ServiceDelta {
        list_id: list_id.to_string(),
        service: slot.clone(),
        list_all_down: list.all_down,
        overall: snap.overall,
        cut_off: snap.cut_off,
        settled: snap.settled,
    })
}

/// `mark_checking` on the live snapshot, with the same lock discipline and generation check as
/// `apply_derived`. Returns whether the target was marked.
fn apply_marking(
    app: &AppHandle,
    list_id: &str,
    service_id: &str,
    generation: u64,
    endpoint_id: Option<&str>,
) -> bool {
    let state = app.state::<AppState>();
    let mut guard = state.snapshot.lock().unwrap();
    let Some(snap) = guard.as_mut() else { return false };
    if state.generation.load(Ordering::SeqCst) != generation {
        return false;
    }
    match mark_checking(snap, list_id, service_id, endpoint_id) {
        Some(delta) => {
            let _ = app.emit(EVENT_SERVICE, &delta);
            true
        }
        None => false,
    }
}

/// Rewrite one Service in the live snapshot from its *current* status, then roll up, emit the
/// delta and return the new (overall, cut_off). Same lock discipline and generation check as
/// `apply_service_status`: the read, the rewrite and the emit all happen under the snapshot lock,
/// so a one-off check can't clobber a result that landed a moment earlier.
fn apply_derived(
    app: &AppHandle,
    list_id: &str,
    service_id: &str,
    generation: u64,
    derive: impl FnOnce(&ServiceStatus) -> ServiceStatus,
) -> Option<(Severity, bool, bool)> {
    let state = app.state::<AppState>();
    let mut guard = state.snapshot.lock().unwrap();
    let snap = guard.as_mut()?;
    let current = snap
        .lists
        .iter()
        .find(|l| l.id == list_id)?
        .services
        .iter()
        .find(|s| s.id == service_id)?
        .clone();
    let next = derive(&current);
    let live = state.generation.load(Ordering::SeqCst);
    let delta = accept_result(snap, live, generation, list_id, next)?;
    crate::probe::note_cut_off(&state.was_cut_off, &state.block_memory, delta.cut_off);
    let _ = app.emit(EVENT_SERVICE, &delta);
    Some((delta.overall, delta.cut_off, delta.settled))
}

/// Re-check one Service now — every endpoint of it, or only `endpoint_id` — leaving everything
/// else (other services, the schedule, the WAN lookup) alone. The target shows `Checking` at once;
/// the result arrives later as an ordinary Status delta.
///
/// Errors only for something that can't be checked: a list/service that isn't there (or is
/// disabled), or an endpoint that isn't in that service.
pub fn check_now(
    app: &AppHandle,
    list_id: &str,
    service_id: &str,
    endpoint_id: Option<&str>,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let (mut service, timeout_ms) = {
        let cfg = state.config.lock().unwrap();
        let service = cfg
            .lists
            .iter()
            .find(|l| l.id == list_id)
            .and_then(|l| l.services.iter().find(|s| s.id == service_id && s.enabled))
            .cloned()
            .ok_or("That service isn't being checked")?;
        (service, cfg.timeout_ms)
    };
    if let Some(eid) = endpoint_id {
        service.endpoints.retain(|e| e.id == eid);
        if service.endpoints.is_empty() {
            return Err("That endpoint isn't part of the service".into());
        }
    }

    let generation = state.generation.load(Ordering::SeqCst);
    if !apply_marking(app, list_id, service_id, generation, endpoint_id) {
        return Err("That service has no status yet".into());
    }

    let (client, sem, memory) = (state.probe_client.clone(), state.probe_sem.clone(), state.block_memory.clone());
    let (app, list_id, service_id) = (app.clone(), list_id.to_string(), service_id.to_string());
    let endpoint_only = endpoint_id.is_some();
    tauri::async_runtime::spawn(async move {
        // Probe with NO lock held (network I/O).
        let fresh = crate::probe::probe_service(&service, &client, &sem, timeout_ms, &memory).await;
        let landed = if endpoint_only {
            match fresh.endpoints.first() {
                Some(ep) => apply_derived(&app, &list_id, &service_id, generation, |cur| merge_endpoint(cur, ep)),
                None => None,
            }
        } else {
            apply_derived(&app, &list_id, &service_id, generation, |_| fresh.clone())
        };
        if let Some((overall, cut_off, settled)) = landed {
            crate::tray::update_icon(&app, overall, cut_off, settled);
        }
    });
    Ok(())
}

/// The ids of the services in `list_id` that are being checked (enabled ones), in order. `None` for
/// a list that isn't there. Pure, so "which services does a list check cover" is testable.
pub fn enabled_service_ids(cfg: &crate::models::Config, list_id: &str) -> Option<Vec<String>> {
    let list = cfg.lists.iter().find(|l| l.id == list_id)?;
    Some(list.services.iter().filter(|s| s.enabled).map(|s| s.id.clone()).collect())
}

/// Re-check every service of one list now, leaving all other lists alone. Each service shows
/// `Checking` at once and lands its own result, exactly like `check_now`.
pub fn check_list_now(app: &AppHandle, list_id: &str) -> Result<(), String> {
    let ids = {
        let state = app.state::<AppState>();
        let cfg = state.config.lock().unwrap();
        enabled_service_ids(&cfg, list_id).ok_or("That list isn't there")?
    };
    // One service that can't be checked (removed a moment ago) must not stop the rest.
    for id in ids {
        let _ = check_now(app, list_id, &id, None);
    }
    Ok(())
}

/// Apply a probe result only if it belongs to the live task generation. `abort()` lands only at an
/// await, so a task from before the last `respawn_tasks` can still finish its probe; its result
/// describes a config that no longer exists and must not touch the fresh snapshot.
fn accept_result(
    snap: &mut Snapshot,
    current_generation: u64,
    generation: u64,
    list_id: &str,
    status: ServiceStatus,
) -> Option<ServiceDelta> {
    if generation != current_generation {
        return None;
    }
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

    list.all_down = crate::models::list_all_down(&list.services);
    let list_all_down = list.all_down; // read before releasing the &mut for the overall recompute

    let overall = crate::probe::overall_severity(&snap.lists);
    snap.overall = overall;
    let cut_off = crate::probe::is_cut_off(&snap.lists);
    snap.cut_off = cut_off;
    // Written back into the stored Snapshot as well as the delta: the WAN task emits that stored
    // Snapshot wholesale on `status-update`, so a stale `settled` there would mislead the frontend.
    let settled = crate::probe::is_settled(&snap.lists);
    snap.settled = settled;

    Some(ServiceDelta {
        list_id: list_id.to_string(),
        service: status,
        list_all_down,
        overall,
        cut_off,
        settled,
    })
}

// ---------------------------------------------------------------------------
// Supervisor + WAN task
// ---------------------------------------------------------------------------

/// Abort all running Service probe tasks, paint Checking, and spawn a fresh one per enabled
/// Service. Called on startup and after every config mutation.
///
/// Order matters: abort → bump generation → Checking → spawn. Bumping before the Checking paint
/// means any old task still finishing its probe is dropped by `apply_service_status` instead of
/// overwriting the Checking state with a result for the old config.
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
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    crate::emit_checking(app);

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
            app, list_id, service, signal_rx, generation,
        )));
    }
    *state.tasks.lock().unwrap() = handles;
}

/// Refresh WAN every ~5 min (and on a "probe now" signal). Pushes a full `status-update` snapshot
/// reusing the existing event + frontend listener, rather than inventing a WAN-specific delta.
const WAN_REFRESH: Duration = Duration::from_secs(300);

/// Retry cadence after a failed/empty WAN fetch (e.g. right after a network/VPN change, before
/// the new route is ready) — much shorter than `WAN_REFRESH` so the header catches up in seconds
/// instead of waiting out the full 5 min cycle.
const WAN_RETRY: Duration = Duration::from_secs(10);

/// How long to wait before the next WAN fetch, given whether the last one succeeded. Pure so it's
/// unit-testable without an `AppHandle`. Keyed off the *fetch's* outcome, not whether a WAN IP is
/// cached — a failed refetch must keep retrying fast even if an old IP is still on screen.
pub fn next_wan_delay(last_ok: bool) -> Duration {
    if last_ok {
        WAN_REFRESH
    } else {
        WAN_RETRY
    }
}

/// True when any enabled service has the (experimental) block check on.
fn watches_blocks(cfg: &crate::models::Config) -> bool {
    cfg.lists.iter().flat_map(|l| &l.services).any(|s| s.enabled && s.check_block)
}

/// True when the fresh lookup is a different IP from the last known one (or there was none).
fn ip_changed(prev: Option<&crate::models::WanInfo>, fresh: &crate::models::WanInfo) -> bool {
    prev.is_none_or(|p| p.ip != fresh.ip)
}

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
                (state.wan_client.clone(), cfg.ip_providers.clone())
            };

            // Capture the fetch's own outcome — this (not whether a WAN IP is cached) drives the
            // next wait, so a failed post-change refetch keeps retrying fast (see next_wan_delay).
            let fetched = crate::wan::fetch_wan(&client, &providers).await;
            let last_ok = fetched.is_some();
            if let Some(info) = fetched {
                let state = app.state::<AppState>();
                // Read the config before taking the WAN lock: never hold both.
                let watching = watches_blocks(&state.config.lock().unwrap());
                let mut wan = state.wan.lock().unwrap();
                if ip_changed(wan.as_ref(), &info) {
                    state.block_memory.clear();
                    // Only when some service uses the block check: probe again at once rather than
                    // wait for the timer, so a stale answer does not linger. Everyone else is untouched.
                    if watching && wan.is_some() {
                        let _ = state.probe_now.send(());
                    }
                }
                *wan = Some(info);
            }

            // Put the fresh WAN into the stored snapshot and emit it (under the snapshot lock, so
            // it can't overtake a later delta). The Service tasks own the lists.
            let overall = {
                let state = app.state::<AppState>();
                let wan = state.wan.lock().unwrap().clone();
                let mut guard = state.snapshot.lock().unwrap();
                guard.as_mut().map(|snap| {
                    snap.wan = wan;
                    let _ = app.emit(EVENT_STATUS, &*snap);
                    (snap.overall, snap.cut_off, snap.settled)
                })
            };
            if let Some((overall, cut_off, settled)) = overall {
                crate::tray::update_icon(&app, overall, cut_off, settled);
            }

            // Refresh on schedule; retry sooner after a failed fetch; wake on manual refresh or
            // when the providers change.
            let wait = next_wan_delay(last_ok);
            let state = app.state::<AppState>();
            tokio::select! {
                _ = tokio::time::sleep(wait) => {}
                _ = signal_rx.recv() => {}
                _ = state.wan_now.notified() => {}
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

    /// A base above the ceiling is never shortened by backoff (A07): 600s stays 600s.
    #[test]
    fn backoff_never_shortens_a_long_base() {
        for secs in [120, 600] {
            let base = Duration::from_secs(secs);
            assert_eq!(backoff(base, 0), base);
            assert_eq!(backoff(base, 4), base);
        }
        assert_eq!(backoff(Duration::from_secs(60), 0), Duration::from_secs(60));
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

    #[test]
    fn next_wan_delay_picks_by_last_fetch_outcome() {
        assert_eq!(next_wan_delay(true), WAN_REFRESH, "success → full 300s cadence");
        assert_eq!(next_wan_delay(false), WAN_RETRY, "failure → short 10s retry");
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
                cause: None,
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
            cut_off: false,
            settled: true,
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

    // ----- one-off checks -----

    /// (state, latency) of each endpoint — `EndpointStatus` has no `==`, and these are what matter.
    fn shape(s: &ServiceStatus) -> Vec<(ServiceState, Option<u64>)> {
        s.endpoints.iter().map(|e| (e.state, e.latency_ms)).collect()
    }

    /// A group: three endpoints, each its own state.
    fn group(states: &[ServiceState]) -> ServiceStatus {
        let endpoints: Vec<EndpointStatus> = states
            .iter()
            .enumerate()
            .map(|(i, s)| EndpointStatus {
                id: format!("e{i}"),
                host: format!("h{i}"),
                state: *s,
                latency_ms: Some(10 + i as u64),
                cause: None,
            })
            .collect();
        ServiceStatus {
            id: "g".into(),
            label: "Claude".into(),
            state: worst_state(states),
            endpoints,
        }
    }

    #[test]
    fn the_extra_round_after_an_ip_change_is_only_for_block_check_users() {
        let mut cfg = crate::models::Config::default();
        assert!(!watches_blocks(&cfg), "defaults: nothing watches");
        let list = cfg.lists.first_mut().expect("a default list");
        let svc = list.services.first_mut().expect("a default service");
        svc.check_block = true;
        assert!(watches_blocks(&cfg));
        cfg.lists[0].services[0].enabled = false;
        assert!(!watches_blocks(&cfg), "a disabled service is not probed");
    }

    #[test]
    fn only_a_different_ip_counts_as_a_change() {
        let wan = |ip: &str| crate::models::WanInfo {
            ip: ip.into(),
            country_code: "US".into(),
            country_name: "United States".into(),
            flag_emoji: String::new(),
        };
        assert!(ip_changed(None, &wan("1.1.1.1")), "first lookup");
        assert!(!ip_changed(Some(&wan("1.1.1.1")), &wan("1.1.1.1")), "same IP");
        assert!(ip_changed(Some(&wan("1.1.1.1")), &wan("2.2.2.2")), "a new IP");
    }

    #[test]
    fn checking_clears_a_block_cause() {
        let mut g = svc("g", ServiceState::Blocked);
        g.endpoints[0].cause = Some(crate::models::BlockCause::Cloudflare);
        assert_eq!(checking_status(&g, None).endpoints[0].cause, None);
    }

    #[test]
    fn checking_status_marks_the_whole_service_or_one_endpoint() {
        use ServiceState::*;
        let g = group(&[Up, Down, Up]);

        let all = checking_status(&g, None);
        assert!(all.endpoints.iter().all(|e| e.state == Checking && e.latency_ms.is_none()));
        assert_eq!(all.state, Checking);

        let one = checking_status(&g, Some("e1"));
        assert_eq!(
            one.endpoints.iter().map(|e| e.state).collect::<Vec<_>>(),
            [Up, Checking, Up],
            "only the asked endpoint goes back to Checking"
        );
        assert_eq!(one.endpoints[0].latency_ms, Some(10), "the others keep their latency");
        assert_eq!(one.state, Checking, "worst-wins: a Checking endpoint makes the group Checking");
        assert_eq!(one.id, "g");
        assert_eq!(one.label, "Claude");

        // An unknown endpoint id changes nothing.
        assert_eq!(shape(&checking_status(&g, Some("nope"))), shape(&g));
    }

    #[test]
    fn merge_endpoint_swaps_one_result_in_and_rolls_up_again() {
        use ServiceState::*;
        // A group mid-check: e1 is being re-checked, the others are settled.
        let mid = checking_status(&group(&[Up, Down, Up]), Some("e1"));
        let fresh = EndpointStatus { id: "e1".into(), host: "h1".into(), state: Up, latency_ms: Some(42), cause: None };

        let merged = merge_endpoint(&mid, &fresh);
        assert_eq!(merged.endpoints[1].state, Up);
        assert_eq!(merged.endpoints[1].latency_ms, Some(42));
        assert_eq!(merged.state, Up, "all Up now");

        // …and when it is still Down, the group stays Down.
        let still = EndpointStatus { id: "e1".into(), host: "h1".into(), state: Down, latency_ms: None, cause: None };
        assert_eq!(merge_endpoint(&mid, &still).state, Down);

        // A result for an endpoint that is gone (edited meanwhile) changes nothing.
        let gone = EndpointStatus { id: "zzz".into(), host: "x".into(), state: Down, latency_ms: None, cause: None };
        assert_eq!(shape(&merge_endpoint(&group(&[Up, Up, Up]), &gone)), shape(&group(&[Up, Up, Up])));
    }

    /// The two steps of a one-off check, on a snapshot: the target shows Checking with every
    /// rollup left alone, then the real result rolls everything up.
    #[test]
    fn a_one_off_check_marks_only_the_target_then_settles() {
        use ServiceState::*;
        let mut snap = snap_with(false, vec![group(&[Up, Down, Up]), svc("other", Up)]);

        let marked = mark_checking(&mut snap, "l1", "g", Some("e1")).unwrap();
        assert_eq!(marked.service.state, Checking);
        assert_eq!(snap.lists[0].services[0].endpoints[1].state, Checking);
        assert_eq!(snap.lists[0].services[0].endpoints[0].state, Up, "other hosts untouched");
        assert_eq!(snap.lists[0].services[1].state, Up, "the other service is untouched");
        // Nothing global moved: the rest of the app must not look like it is refreshing.
        assert!(marked.settled && snap.settled, "a local re-check is not an unsettled snapshot");
        assert_eq!(marked.overall, Severity::Green);
        assert!(!marked.cut_off && !marked.list_all_down);

        let fresh = EndpointStatus { id: "e1".into(), host: "h1".into(), state: Up, latency_ms: Some(30), cause: None };
        let merged = merge_endpoint(&snap.lists[0].services[0].clone(), &fresh);
        let landed = recompute_delta(&mut snap, "l1", merged).unwrap();
        assert_eq!(landed.service.state, Up);
        assert!(landed.settled);
        assert_eq!(landed.overall, Severity::Green);
    }

    /// An offline machine stays "offline" while one site is re-checked (it used to flip to a plain
    /// alarm for the length of the probe, because a Checking endpoint ends cut-off).
    #[test]
    fn a_one_off_check_does_not_lift_cut_off() {
        use ServiceState::*;
        let mut snap = snap_with(true, vec![svc("a", Down), svc("b", Down)]);
        recompute_delta(&mut snap, "l1", svc("a", Down)); // settle the rollups: all down, cut off
        assert!(snap.cut_off && snap.lists[0].all_down && snap.overall == Severity::Red);

        let marked = mark_checking(&mut snap, "l1", "a", None).unwrap();
        assert_eq!(marked.service.state, Checking);
        assert!(marked.cut_off && snap.cut_off, "still offline while it re-checks");
        assert!(marked.list_all_down && snap.lists[0].all_down);
        assert_eq!(marked.overall, Severity::Red);
        assert!(marked.settled);
    }

    #[test]
    fn marking_an_unknown_target_does_nothing() {
        let mut snap = snap_with(false, vec![svc("a", ServiceState::Up)]);
        assert!(mark_checking(&mut snap, "nope", "a", None).is_none());
        assert!(mark_checking(&mut snap, "l1", "nope", None).is_none());
        assert_eq!(snap.lists[0].services[0].state, ServiceState::Up);
    }

    #[test]
    fn a_list_check_covers_exactly_its_enabled_services() {
        use crate::models::{Config, Endpoint, Service};
        let mut cfg = Config::default();
        let list = &mut cfg.lists[0];
        let all_ids: Vec<String> = list.services.iter().map(|s| s.id.clone()).collect();
        assert!(all_ids.len() >= 2, "the seeded list has several services");

        // Every service enabled → every id, in the list's order.
        assert_eq!(enabled_service_ids(&cfg, &cfg.lists[0].id), Some(all_ids.clone()));

        // A disabled one is skipped, a newly added one is included.
        cfg.lists[0].services[0].enabled = false;
        let mut extra = Service::with_endpoints("Extra", vec![Endpoint::new("example.com", 443)]);
        extra.enabled = true;
        let extra_id = extra.id.clone();
        cfg.lists[0].services.push(extra);
        let mut want: Vec<String> = all_ids[1..].to_vec();
        want.push(extra_id);
        assert_eq!(enabled_service_ids(&cfg, &cfg.lists[0].id), Some(want));

        // Another list is not part of it, and an unknown list is None.
        let other = cfg.lists[1].id.clone();
        assert!(enabled_service_ids(&cfg, &other).unwrap().iter().all(|id| !all_ids.contains(id)));
        assert_eq!(enabled_service_ids(&cfg, "nope"), None);
    }

    #[test]
    fn stale_generation_result_is_dropped() {
        let mut snap = snap_with(true, vec![svc("a", ServiceState::Checking)]);
        assert!(accept_result(&mut snap, 2, 1, "l1", svc("a", ServiceState::Down)).is_none());
        assert_eq!(snap.lists[0].services[0].state, ServiceState::Checking, "snapshot untouched");

        assert!(accept_result(&mut snap, 2, 2, "l1", svc("a", ServiceState::Down)).is_some());
        assert_eq!(snap.lists[0].services[0].state, ServiceState::Down);
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
