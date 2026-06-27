# 0021. TCP-only "reachable" state for wildcard endpoints

- **Status:** accepted
- **Date:** 2026-06-27
- **Deciders:** Esi-Abolfazl

## Context

ADR-0020 introduced wildcard endpoint probing: a host stored as `*.host.com` is probed by
swapping the `*` for a fresh random label (`<rand>.host.com`) at probe time. That ADR
accepted a known trade-off — a synthesised subdomain that doesn't match the zone's TLS
certificate would fail the HTTPS leg and read as **Blocked**, which was deemed "honest".

In practice this trade-off turned out to be the common case, not the edge case. Most wildcard
zones either serve an apex-only certificate or reject unknown SNI outright, so a made-up
random subdomain almost always fails TLS. The result: **every** wildcard endpoint read as
Blocked (amber), even when the zone was plainly reachable at the TCP layer. A user who added a
wildcard would see a wall of false "blocked" status, which defeats the purpose of supporting
wildcards at all.

The HTTPS leg therefore carries no useful signal for a wildcard endpoint — its outcome is
predetermined by the synthesised name not matching the cert, not by the zone's real health.
Spending a TLS handshake to derive a misleading classification is both wasteful and wrong.

## Decision

**Probe wildcard endpoints at the TCP layer only.** When a stored host begins with `*.`,
`probe_endpoint` performs the TCP connect (which also exercises DNS) and stops there. It does
not send the HTTPS HEAD request.

**Add a fourth endpoint state, `reachable` (blue).** A wildcard endpoint whose TCP connect
succeeds is classified `reachable`; one whose connect fails is `down`. A wildcard is never
`blocked` (no TLS leg runs) and records no latency (there is no full-path HTTPS timing to
report — the UI shows a "TCP only" note in place of a latency).

**Rank `reachable` below `up` in the worst-wins rollup.** The service-dot precedence becomes
`down > blocked > checking > up > reachable`. Failures and in-flight `checking` dominate as
before, but among settled non-failures a single fully-verified `up` endpoint promotes the
service dot to green. The blue `reachable` dot shows for a service only when *every* one of
its endpoints is reachable-but-unverified. `reachable` is a non-failure, so it never
contributes to a list's `all_down` rollup or the overall Red/Yellow severity.

**Render the blue dot identically to green otherwise** — same breathing animation — so it
reads as a healthy state, distinguished only by colour and the "TCP only" note.

## Alternatives considered

- **Keep probing TLS and report Blocked (ADR-0020's original stance)** — rejected. It produces
  a misleading wall of amber for healthy wildcard zones and wastes a TLS handshake whose
  outcome is predetermined.

- **Probe TLS but remap a wildcard's TLS failure to the new blue state** — rejected. It keeps
  the wasted handshake and adds branching, and the user's intent was explicitly "wildcards get
  a TCP check only, not TLS". Skipping TLS entirely is simpler and matches the signal that
  actually exists.

- **Rank `reachable` above `up` (blue wins a mixed service)** — rejected. A service that mixes
  a verified `up` endpoint with a TCP-only wildcard is healthier than "TCP only" implies;
  showing it blue understated its status. Letting `up` win keeps the green dot meaningful.

## Consequences

### Positive:

- Wildcard zones that are reachable read as healthy (blue) instead of a misleading Blocked.
- No wasted TLS handshake on a probe whose HTTPS outcome carries no information.
- A mixed service (normal + wildcard endpoints) stays green while its verified endpoints are
  up, so adding a wildcard never downgrades an otherwise-healthy service.

### Negative / accepted trade-offs:

- A wildcard zone that genuinely *does* serve a matching wildcard certificate is still shown
  as blue `reachable` rather than green `up`, because TLS is skipped for all wildcards. This is
  an accepted simplification: blue means "reachable, HTTPS not verified", which is true.
- Wildcard endpoints report no latency. The "TCP only" note replaces the millisecond reading.
- The endpoint-state model grows from three terminal states to four; the TypeScript union,
  the colour palette, and the worst-wins ranking all had to absorb the new variant.

### Follow-ups:

- None. The `reachable` state is self-contained; severity, alerts, and the tray light are
  unaffected because `reachable` is a non-failure.
