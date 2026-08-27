# 0029. Settled snapshots and a post-wake alert grace window

- **Status:** accepted
- **Date:** 2026-08-26
- **Deciders:**

## Context

Leaving the app running through a system sleep, lock or hibernate produced a burst of
notifications and alert sounds on wake — the reporter heard the sound more than five times in
a row. Three independent defects stacked up.

**1. Placeholder rollups were read as measurements.** `emit_checking` (ADR-0005) publishes a
synthetic Snapshot with `all_down: false` and `cut_off: false` for every List *before any probe
runs*, purely so the UI can paint checking dots. The frontend diffed it like any other
snapshot, so every checking round fabricated a full **recovery** edge. macOS wake fires a
stream of network-configuration changes; `netwatch` (ADR-0018) turns each debounced burst into
a probe round, and each round begins with one of these placeholders. Every round therefore cost
one fake "Recovered" plus one real "Total outage". With the shipped defaults
(`down_sound: true`, `up_sound: true`, `up_notify: false`) the fake recovery is audible but
invisible, which is why the report was about sound. Reproduced: baseline up → settled down →
checking → settled down fired three notifications instead of one.

This was never sleep-specific. Pressing Refresh during an outage did the same thing.

**2. The alert debounce measured batch age on the wall clock.** `armFlush` (ADR-0027) caps a
batch at `ALERT_MAX_MS` from batch start, using `Date.now()`. The wall clock runs through a
sleep while the webview's timers do not, so a batch left open across one computes a negative
remaining cap and collapses to a `0 ms` flush. Reproduced: an edge arriving after a simulated
one-hour suspension alerted 1 ms later instead of waiting out the quiet window.

**3. Nothing knew the machine had just woken.** For several seconds after a wake the OS is
still re-establishing wifi, DHCP, DNS and VPN. Probes fail fast and honestly, and the snapshot
settles to cut-off — so even a perfectly-batched app announces "You're offline" on every
lid-open, followed by "Recovered" once the network is up.

## Decision

**The backend says whether a Snapshot is a measurement.** `probe::is_settled` returns true when
no Endpoint anywhere is still `Checking`, and its result ships on both `Snapshot.settled` and
`ServiceDelta.settled` — the same shape and for the same reason as `cut_off`: only the backend
sees every Service. `emit_checking` computes the flag from the lists it just built rather than
hard-coding `false`, so the two cannot drift.

**The frontend diffs Transitions only between settled Snapshots.** `App.tsx` now keeps two
references where it kept one: `prevSnapshotRef` is the merge base for per-Service deltas (the
last snapshot handed to the UI), and `baselineRef` is the Transition baseline (the last settled
snapshot). An unsettled snapshot repaints and nothing more — it produces no edges and does not
become the baseline. `flushAlerts` reads `baselineRef` for its `cutOff` / `allDown` / `allUp`
context, because an alert must describe a settled round.

**A batch that outlived a suspension starts fresh.** A live batch always flushes within one
quiet period of its last edge, so a longer gap proves the flush never ran. `armFlush` clears
the stale batch start in that case, restoring the full quiet window. In normal operation the
guard cannot trigger, because the flush would have fired and cleared the batch already.
Two thresholds bound where the guard matters, and they are not the same one. It *runs* on any
gap over the quiet period, but below `ALERT_MAX_MS` the remaining cap is still positive, so
clearing the stale start only lengthens a delay that was never going to be zero. The gap has to
reach `ALERT_MAX_MS` before the cap goes negative and the flush actually collapses — so
`ALERT_MAX_MS` to `WAKE_GAP_MS` is the band where the guard changes the outcome, i.e. a
suspension long enough to strand a batch but too short to read as a system sleep (App Nap, a
paused debugger, severe CPU starvation). Above `WAKE_GAP_MS` it is `handleWake` that clears the
batch, so the two mechanisms partition the range rather than overlap.

**A detected wake opens a grace window.** A `WAKE_TICK_MS` heartbeat compares wall-clock gaps
between its own ticks; a gap over `WAKE_GAP_MS` means the process was suspended. While the
window is open, settled snapshots repaint but are not diffed and the baseline is not advanced.
The window closes on the first settled snapshot with no cut-off (the network has proven itself)
or when `WAKE_GRACE_MAX_MS` expires, whichever comes first — a timer forces the latter, because
a Service settled to Down backs off to 120s and no further snapshot may arrive for that long.

Closing the window runs exactly one diff, of the settled state the user is now looking at
against the state they last saw, and then flushes anything the interrupted batch still owed.
Those two halves are both load-bearing:

- **Keeping the pre-sleep baseline** is what makes an outage that *began* during the sleep still
  announce itself. Re-baselining on wake would have been simpler and would have swallowed it —
  a monitoring hole for the exact case the app exists to catch: lid closed green at 18:00, lid
  opened at 09:00 with the intranet down.
- **Keeping `pendingRef`** is what makes an edge collected moments before the sleep still
  announce itself. `diffAgainstBaseline` advances the baseline as soon as it collects an edge,
  so a dropped batch would leave nothing behind to rediscover it.

The four wake cases this yields: up→up silent; up→down one alert; down→down silent (already
alerted before the sleep); down→up one "Recovered".

## Alternatives considered

- **Filter checking snapshots in the frontend** by testing whether every endpoint is `checking`.
  Same effect, but it re-derives a rollup in TypeScript that the backend already owns — the
  duplication ADR-0005 explicitly rejected.
- **Suppress alerts for a fixed delay after wake and re-baseline.** Roughly ten lines instead of
  the diff machinery, and it never false-alerts. Rejected because it goes silent about an outage
  that started during the sleep, which is the case a connectivity monitor most needs to report.
- **`NSWorkspace.didWakeNotification` for the wake signal.** The platform's own answer, but it
  needs Objective-C bindings, has no Tauri v2 wrapper, and would need a separate implementation
  per platform. The clock-gap heartbeat needs no dependency and behaves identically on
  Windows/Linux, which are planned on this codebase.
- **Debounce `netwatch` harder so a wake produces one probe round.** Treats a symptom: the fake
  recovery would survive at one per round, and manual Refresh would still trigger it.

## Consequences

### Positive:

- One alert per real connectivity change across a wake, instead of two per probe round.
- The standing Refresh-during-an-outage false "Recovered" is fixed as a side effect, since it
  was the same defect.
- An outage that starts while the machine sleeps is still reported, once, when the user comes
  back.
- The wake detector needs no OS API and carries no new dependency.

### Negative / accepted trade-offs:

- A real outage arriving within `WAKE_GRACE_MAX_MS` of a wake is announced up to that late.
- A false-positive wake (a debugger pause, or severe CPU starvation for over `WAKE_GAP_MS`)
  opens one grace window. No alert is lost — the window still closes with a diff — but a genuine
  outage in that span is delayed.
- `WAKE_GRACE_MAX_MS` is a fixed guess at how long an OS takes to re-establish a network. A slow
  VPN reconnect can exceed it, in which case the offline alert fires and the recovery alert
  follows — the pre-fix behaviour, for that case only.
- `Snapshot` and `ServiceDelta` grow a field, so `src/types.ts` and both test-fixture sets had
  to be updated in lockstep. No persisted schema change, so no config migration.
- `netwatch` still fires several probe rounds during a wake. That is now only wasted network
  traffic, not alerts, so it was left alone.
- The two suspension mechanisms are only separable by duration, so the `armFlush` guard's
  regression test has to pick a suspension between `ALERT_MAX_MS` and `WAKE_GAP_MS` (12s–20s as
  configured) to exercise the guard rather than the wake path, and it documents that band
  inline. Only one of the three ways to leave that band fails loudly: an offset above
  `WAKE_GAP_MS` trips `handleWake` and the test goes red. The other two are silent — an offset
  below `ALERT_MAX_MS` leaves the cap positive, so the test passes even with the guard deleted,
  and raising `ALERT_MAX_MS` past `WAKE_GAP_MS` closes the band altogether. Both silent cases
  were confirmed by experiment while writing the test, not by reading the arithmetic.

### Follow-ups:

- The backend "probe round complete" signal in `docs/TODO.md` would let the frontend stop
  inferring settle from silence; `settled` is a step toward it but not a substitute — it says a
  round has *landed*, not that a new one has *begun*.
- The wake heartbeat could replace the `visibilitychange` update-check hack (ADR-0015), which
  exists to work around the same frozen-timer problem. Not done here — out of scope.
