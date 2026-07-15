# 0023. Notify when a critical list goes fully blocked (TLS interception), opt-in

- **Status:** accepted
- **Date:** 2026-06-27 (revised 2026-07-15: scope changed from non-critical to critical lists)
- **Deciders:** Esi-Abolfazl

## Context

Critical lists alarm on `all_down`, which counts `blocked` endpoints as down. That means a
critical list going fully **blocked** — every endpoint `Blocked` (TCP connected, HTTPS
failed = TLS interception fingerprint) — fires only a generic "Outage" notification. The
user cannot tell interception/filtering at the ISP or national level apart from an ordinary
connectivity loss, and the distinction matters: an outage means "wait", a block means "the
network is filtering you".

The requirement is to surface fully-blocked as its own alert for **critical** lists.
Non-critical lists stay silent for all failure modes, as they always have — their status is
visible in the UI, and alerting on them is noise.

> **Revision note (2026-07-15):** the original version of this ADR targeted *non-critical*
> lists and excluded critical ones (to avoid double-notifying alongside the `all_down`
> outage alert). That inverted the actual need — nobody wants alerts for non-critical
> lists; the interception signal is wanted precisely for the lists that matter. The
> double-notify concern is instead solved by precedence (below).

## Decision

A `blocked_notify` boolean flag on `Config` (`#[serde(default = "default_true")]`, default
on, no schema migration needed). When enabled, a **critical** list transitioning into
*fully blocked* — every service has at least one endpoint and every endpoint's state is
`"blocked"` — fires a "Blocked" notification (title: "Blocked", body: "X appears blocked.")
and plays a sound (the down sound asset is reused — no new asset — gated by its own
`blocked_sound` flag).

**Precedence over the outage alert (no double-notify).** Fully-blocked implies `all_down`,
so entering fully-blocked can coincide with the `all_down` outage edge. Both transition
detectors feed the same `pendingRef` batch in `App.tsx`, keyed by list id, and the blocked
edge is applied last — so within one alert window a list fires **either** "Blocked" **or**
"Outage", never both, with "Blocked" (the more specific signal) winning. If the user has
disabled both blocked toggles, the edge falls back to the "down" direction at flush time so
a fully-blocked outage is never silently swallowed.

**Detection is frontend-computed** from the endpoint states already present in the merged
snapshot — no new backend snapshot field. `blockedTransitions` in `src/utils/transitions.ts`
mirrors the structure of `criticalTransitions` and feeds the same batching pipeline, keyed
with a `"blocked"` direction in the `Dir` type in `alerts.ts`. Both snapshot and delta paths
funnel through `handleSnapshot`, so the hook point is a single location.

The alert is **down-direction only**: fully-blocked → cleared fires no dedicated recovery
notification. Recovery is already covered — fully-blocked implies `all_down`, so clearing it
flips `all_down` and fires the existing "Recovered" alert (gated by `up_notify`/`up_sound`).

A "Blocked list" row sits in the Settings **Critical-list alerts** grid with Notify and
Sound checkboxes, with an amber status dot (red = Outage, green = Recovery).

The `blocked_notify` flag benefits from ADR-0022's confirm-before-flip FSM: a Service only
shows as `blocked` after K consecutive failing probes, so the blocked alert inherits the
same de-flap guarantee and will not fire on a single transient interception event.

## Alternatives considered

- **Notify on non-critical lists instead (the original decision)** — reversed: non-critical
  lists are non-critical precisely because the user does not want to be interrupted about
  them. The interception signal is only actionable for lists the user has marked critical.
- **Fire both "Outage" and "Blocked" for the same edge** — rejected: double notification for
  one event. Precedence (blocked wins, falls back to down when disabled) keeps it to one.
- **Add a backend `all_blocked` field + plumb through `ServiceDelta`** — rejected: the
  frontend already has all endpoint states needed to compute fully-blocked locally; a
  backend field would be premature. If later wanted (tray icon), it can be added additively.
- **New sound asset for blocked** — rejected: the down sound is appropriate. A separate
  `blocked_sound` *toggle* exists (so the alert can be silenced independently of the outage
  sound), but it reuses the down sound asset — no new file.

## Consequences

## **Positive:**

- Interception/filtering of a critical list is now distinguishable from an ordinary outage,
  within K probe rounds (ADR-0022).
- No schema migration: `blocked_notify` is additive with `serde(default = "default_true")`.
- Detection stays in the frontend, reusing endpoint states already in the snapshot — no new
  network round-trips or backend contract changes.
- Non-critical lists remain fully silent — no new noise.

## **Negative / accepted trade-offs:**

- The fully-blocked check is frontend-computed, so it could theoretically drift from the
  backend rollup in a future refactor. The constraint `all_blocked ⊆ all_down` means no new
  contract risk. If a backend field is added later, it is strictly additive.
- Precedence is batch-window-local: if a list goes all-down via `down` endpoints in one
  window ("Outage" fires) and turns fully-blocked in a later window, "Blocked" fires as a
  second notification. This is intended — the state genuinely changed to a more specific one.

## **Follow-ups:**

- A dedicated blocked sound *asset* (distinct from the down sound) if user feedback shows
  the reused sound is confusing in the interception context.
- If tray icon or menu-bar badge ever needs to reflect blocked state separately from
  outage, add a backend `all_blocked` field additively.
