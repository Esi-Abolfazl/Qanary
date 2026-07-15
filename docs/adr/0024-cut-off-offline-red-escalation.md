# 0024. Cut-off detection — escalate total no-access to red "offline"

- **Status:** accepted
- **Date:** 2026-07-15
- **Deciders:** Esi-Abolfazl

## Context

`classify` (`src-tauri/src/probe.rs`) treats a TCP connection that succeeds but whose HTTPS
layer fails as `Blocked` — the fingerprint of TLS interception. That heuristic is a false
positive whenever the "middlebox" is actually the entire path: an ISP filtering box, or a
local proxy/VPN interface, will often complete the TCP handshake itself (even with wifi off)
and then fail the TLS leg. The result is that total loss of connectivity renders identically
to mild per-service filtering — a wall of orange `Blocked` dots and a yellow "Heads up"
headline — when the honest situation is "you're offline".

`Blocked` vs `Down` is a meaningful distinction when *some* services are still reachable
(it tells the user "this looks like filtering, not a dead link"), but it is meaningless once
*nothing at all* is reachable: there is no partial signal left to preserve, and the app is
actively under-reporting a total outage as a soft warning.

## Decision

Add an app-wide, **endpoint-granular** predicate, `is_cut_off(&[ListStatus])` in
`src-tauri/src/probe.rs`: true when, across every List's every Service's every Endpoint, no
Endpoint is `Up`, no Endpoint is `Checking` (still settling), and at least one Endpoint is
`Blocked` or `Down`. Endpoint-granular — not service-dot-granular — matters because
`worst_state`'s rank order (`Down > Blocked > Checking > Up > Reachable`) means a Service's
rolled-up dot can read as `Blocked` while one of its Endpoints is still fully `Up`; looking
past the dot to the raw Endpoint states means a single live Endpoint anywhere disqualifies
cut-off, even if its Service dot looks bad.

This predicate is computed **backend-side**, in the same place `overall_severity` already
lives, and overrides it straight to `Red` before the existing `all_down`/`critical` checks —
severity is backend-owned, and cut-off is a severity concern, not a display concern.

The result is carried on `Snapshot` and `ServiceDelta` as a new `cut_off: bool` field
(mirrored in `src/types.ts`, propagated through `mergeDelta` on the streaming
`service-update` path). The frontend reads this flag to:

- Show a distinct "offline" hero headline ("You're offline" / "Can't reach anything — check
  your connection.") instead of the normal severity copy.
- Render every dot — `Blocked`, `Down`, and `Reachable` alike — as red, via a `.cut-off`
  class placed on the shared `main.app` ancestor (not the header) so the CSS override reaches
  `ServiceRow`'s dots, which live outside the hero.
- Fire the existing **down** notification channel (reusing `down_notify`/`down_sound` and the
  `down.mp3` asset — no new setting) on the `false → true` edge, via its own fire path
  (`fireCutOffAlert` in `src/utils/alerts.ts`) rather than the list-id-keyed `pendingRef`
  batch, since cut-off is a listless, app-wide event with fixed copy that doesn't fit
  `buildMessage`'s per-list-name construction.

Per-Endpoint `blocked`/`down` distinction is preserved for the ordinary partial-outage case —
the `.cut-off` class, and the predicate that drives it, only ever apply when nothing at all
is reachable.

## Alternatives considered

- **Recolor `Blocked` → red always** — rejected: this would lose the genuine
  filtering-vs-outage signal for the partial case, where some services still work and the
  distinction between "looks filtered" and "looks dead" is actionable information.
- **Frontend-derive cut-off from the snapshot, mirroring how `Fully blocked` is computed**
  (ADR-0023) — rejected: severity is backend-owned. Computing this specific severity override
  in the frontend would split one rule across two layers, violating the project's
  single-source-of-truth principle for backend-owned concerns.
- **Service-dot-granular predicate** (check `ServiceStatus.state` instead of individual
  `EndpointStatus.state`) — rejected: `worst_state`'s rank order can hide a live Endpoint
  behind a worse dot, so this would false-fire "offline" while a service still actually works.
- **Fix the TCP probe to detect middlebox/proxy handshakes directly** — rejected: fragile and
  unreliable in practice; there is no dependable way to distinguish a genuine TCP accept from
  an interception device's TCP accept at the probe layer. The aggregate, endpoint-granular
  predicate is the robust fix, sidestepping the probe-layer ambiguity entirely.

## Consequences

## **Positive:**

- Total loss of connectivity now reads as a clear red "you're offline" state for both
  censorship-style interception and mundane connectivity loss (wifi off, unplugged, etc.),
  robust to the underlying `tcp_ok` false positive.
- The per-Endpoint `blocked`/`down` distinction remains intact and visible for the normal
  partial-connectivity case — cut-off is strictly additive, not a replacement for existing
  states.
- No schema migration: `cut_off` is a runtime-only field, never persisted to `config.json`.

## **Negative / accepted trade-offs:**

- Additive data-contract field: `cut_off` must be kept in sync between the Rust `Snapshot`/
  `ServiceDelta` structs and their TypeScript mirrors in `src/types.ts`. There is no automated
  cross-check for this — `tsc` only catches a missing TS field once something actually reads
  it, so the `StatusHero`/`mergeDelta` read sites and their tests are the practical guard.
- Does not fix wildcard `Reachable`-masking of a single critical List's `all_down` (a
  wildcard Endpoint in `Reachable` state can prevent `fully_failing` from tripping even when
  every *real* endpoint in that Service has failed). Cut-off sidesteps this bug rather than
  fixing it, since its own predicate never consults `fully_failing`. Left as a follow-up.
- An Endpoint stuck permanently `Checking` (e.g. one unusually slow host) suppresses cut-off
  indefinitely. Accepted as rare and preferable to false-firing "offline" mid-probe — the
  predicate's `Checking` exclusion is, since ADR-0022's flip-confirmation work was reverted,
  the only mid-probe guard against a flicker false-positive.
- A `Reachable`-only configuration (all wildcard Endpoints, no real failure) never trips
  cut-off, since the predicate requires at least one `Blocked`/`Down` Endpoint. Accepted: TCP
  reached *something* in that case, and wildcard Endpoints can't verify HTTPS regardless.

## **Follow-ups:**

- Fix the wildcard `Reachable`-masking of a single critical List's `all_down` noted above, so
  a critical list that is fully failing except for a wildcard Endpoint correctly reports
  `all_down` instead of being masked by the wildcard's `Reachable` state.
