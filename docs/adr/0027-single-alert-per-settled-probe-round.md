# 0027. One alert per settled probe round — cut-off outranks blocked outranks outage

- **Status:** accepted
- **Date:** 2026-07-27
- **Deciders:**

## Context

Losing connectivity fired **two** notifications and two sounds: the "You're offline" Cut-off
alert and, moments later, the critical-list outage alert ("Total outage" / "Intranet is down").

Two independent causes produced that, and both had to be fixed.

The first is precedence. ADR-0024 gave the Cut-off alert its own inline fire path in
`App.tsx`, straight off the `false→true` edge of `Snapshot.cut_off`, while the outage and
Blocked-list alerts went through the batched `pendingRef` pipeline. Nothing ranked the two
paths against each other. Cut off *is* the disconnection — every List is `all_down` *because*
of it — so naming individual Lists alongside it is redundant noise, but no code expressed
that. Partial precedence did already exist (`effectiveDir` ranks blocked over down), which
made the omission of the cut-off half the more glaring.

The second is timing. Since ADR-0014 the backend pushes per-Service Status deltas the instant
each probe lands, so a single probe round's edges arrive spread out — up to one `timeout_ms`
apart as straggling waves complete. The batch window was a fixed 2500ms opened by the first
edge, so a round whose List `all_down` crossing and `cut_off` crossing landed in different
waves could never have collapsed into one alert, even with a precedence rule in place: the
window had already closed and alerted before the cut-off edge arrived.

A third, latent exposure sat alongside these: a `cut_off` value that flickered
false→true→false inside one round would announce an outage the user never actually had. The
ADR-0022 revert left the frontend with no confirm-before-flip step, and ADR-0024 flagged this.

## Decision

**One function owns alert precedence.** `fireBatch` in `src/utils/alerts.ts` decides what a
settled Alert batch is owed, ranking **Cut-off alert > Blocked-list alert > outage**. It takes
the batch's pending entries plus the settled round's state (`cutOff`, `cutOffEdge`, `allDown`,
`allUp`) and either fires the Cut-off alert or falls through to the three existing `fireAlert`
calls. `App.tsx` no longer selects alerts; it only collects edges and decides when the round
has settled. The bucketing loop moved wholesale out of the component — the ranking is not
duplicated anywhere.

Three properties of that rule are deliberate:

- **The cut-off edge must still hold at settle.** The offline alert requires `cutOffEdge && cutOff`.
  A cut-off that has already resolved by flush time announces nothing, while its List
  down/blocked edges still alert normally. A within-round flicker therefore self-suppresses.
- **A muted rank cannot outrank anything.** Cut off suppresses the others only while
  `down_notify || down_sound` is on. With both off the Cut-off alert is inaudible, so it must
  not swallow a Blocked-list alert the user *did* opt into. This mirrors `effectiveDir`'s
  existing fall-through convention, for the same reason.
- **A rank that loses stays pending.** `fireBatch` reports whether it suppressed entries, and
  on suppression `App.tsx` leaves `pendingRef` populated. Otherwise an outage could be lost
  forever: if `cut_off` clears while a critical List is still `all_down` (partial recovery),
  no fresh Transition edge exists and that List would never be announced. `pendingRef`'s
  list-id keying makes retention safe — a later recovery overwrites the stale `down` entry
  with `up` (latest-edge-wins).

**The batch window becomes idle-debounced.** The fixed 2500ms window is replaced by a timer
re-armed on every edge-bearing snapshot: quiet period `timeout_ms + 1s`, capped at 12s from
batch start. A cut-off change in either direction counts as an edge and can open a batch on
its own — cut-off can trip with no List transition at all, and its clearing is what releases a
retained entry. The quiet period is derived from `timeout_ms` rather than hard-coded because a
straggling probe wave lands at most one timeout behind the previous one; that constant is the
honest input, and a hard-coded 4s would be a silent duplicate of it. Alerts consequently
describe settled round state, never a mid-round partial.

## Alternatives considered

- **A sticky gate on the inline cut-off fire path (~3 lines).** Cheapest option, but it only
  suppresses the second alert when the outage window is still open. In the reported case the
  2500ms window had already closed and fired before `cut_off` tripped, so the double survives.
  It treats the symptom and leaves the precedence rule unexpressed.
- **A backend "probe round complete" event.** The truest fix — the backend is the only party
  that knows when a round has actually finished, so the frontend would stop inferring it from
  silence. Rejected as disproportionate: it changes probe scheduling and the event contract to
  fix a frontend presentation bug, and it is still available later as a refinement of the
  timing half without disturbing the precedence half.
- **Suppress cut-off once any outage alert has fired.** Inverts the severity ordering: the
  user would hear "Intranet is down" and never learn they are entirely offline.

## Consequences

## **Positive:**

- One notification and one sound per disconnect. The reported bug is closed and pinned by
  regression tests in both shapes: edges in a single step, and edges split across probe waves.
- Alert precedence lives in exactly one tested place, covering the cut-off, blocked, outage and
  muted-channel combinations. `App.tsx` shrinks to edge collection plus settle timing.
- A `cut_off` flicker inside one round no longer false-alerts, closing the exposure ADR-0024
  flagged after the ADR-0022 revert.
- An outage that outlives a cut-off episode is still announced once cut-off clears, even
  though no new Transition edge exists for it.

## **Negative / accepted trade-offs:**

- Up to 12s of silence after a disconnect on installs with many probe waves (typical case
  ~4s after the last endpoint fails), where the old fixed window was ~2.5s. Accepted by the
  requester; both numbers are single constants in `App.tsx`.
- A hand-edited `config.json` with a very large `timeout_ms` makes the quiet period exceed the
  12s cap, so the cap always wins and a cross-wave double alert can return. Not reachable from
  Settings (no timeout field there), so it is recorded rather than guarded.
- A wildcard-`Reachable` "recovery" landing while `cut_off` still holds is silenced. That
  combination is only reachable through the `all_down` masking noted in ADR-0024, where
  announcing "Recovered" under a "You're offline" headline would itself be a bug.
- Re-arming on every edge could in principle extend a batch indefinitely; the 12s cap is the
  only guard. Probe intervals are ≥10s (ADR-0017), so a real flap cannot outrun it.

## **Follow-ups:**

- The wildcard-`Reachable` `all_down` masking follow-up from ADR-0024 remains open.
- Confirm-before-flip / probe accuracy (`docs/TODO.md`) is untouched. The debounce incidentally
  suppresses a *cut-off* flicker but is not a general flip-confirmation mechanism.
- A backend round-complete signal would let the frontend stop inferring settle from silence,
  removing the 12s cap and the large-`timeout_ms` edge case.
