# 0020. Probe wildcard endpoints via a per-probe random synthesized subdomain

- **Status:** accepted
- **Date:** 2026-06-27
- **Deciders:** Esi-Abolfazl

## Context

Qanary lets users add endpoints by hostname. When a user entered a wildcard hostname like
`*.cursor.sh`, the frontend's `parseHost` helper stripped the `*.` prefix before the host
reached storage, reducing the entry to the bare apex (`cursor.sh`). This caused a systemic
problem: apex domains very commonly have no server (DNS exists, but nothing listens on
port 443), so Qanary reported the endpoint as Down even when the actual service was reachable
under any concrete subdomain.

Wildcard DNS records (`*.host.com`) resolve any label to the same set of servers, and wildcard
TLS certificates cover any subdomain under the zone. This means that to probe whether a
wildcard zone is reachable, a probing tool only needs to pick *any* concrete label — it
doesn't matter which one. The challenge is that DNS wildcards can't be enumerated, so the tool
must synthesise a concrete name at probe time rather than storing one or asking the user to
supply one.

A secondary constraint is that backend code owns all probe logic in this project; the frontend
is responsible only for normalising user input into a canonical stored form. The display layer
must always show the human-readable wildcard (`*.host.com`), not an opaque synthesised name.

## Decision

**Stop stripping `*.` in the frontend.** The `parseHost` utility now preserves wildcard host
prefixes verbatim. A host entered as `*.cursor.sh` is stored and displayed as `*.cursor.sh`.
Path wildcards (`google.com/*`) are unaffected — those were and remain stripped.

**Synthesise a random concrete subdomain at probe time in the backend.** A new pure helper
function `probe_host(stored: &str) -> String` is called at the start of `probe_endpoint`.
If the stored host begins with `*.`, the function strips the prefix and prepends a fresh
random 8-character hex label derived from the first 8 characters of a UUID v4 (simple
format). Otherwise it returns the host unchanged. The synthesised name is used for both the
TCP connect and the HTTPS HEAD request.

**Display is unaffected.** `EndpointStatus.host` is set by `probe_service_endpoints` directly
from the stored `ep.host` value, which is never touched by `probe_endpoint`. The swap is
therefore entirely internal to the probe round and invisible to the UI layer.

**No new dependency.** The `uuid` crate (v1, `v4` feature) is already present for model
construction. The `probe_host` helper reuses it.

## Alternatives considered

- **Fixed probe label (`qanary-probe.host.com`)** — rejected. A censor or firewall aware of
  Qanary's exact probe name could blocklist it selectively, producing false-Up or false-Down
  results. A per-probe random label defeats this targeted blocking, which aligns with the
  project's censorship-monitoring purpose.

- **Require user to enter a concrete example subdomain** — rejected. This adds input burden
  and defeats the purpose of the wildcard notation, which users enter precisely because they
  don't want to specify (or don't know) a concrete subdomain.

- **Keep probing the apex** — rejected. This is the bug being fixed. Apex domains for wildcard
  zones routinely have no server on port 443, causing Qanary to report Down when the zone is
  perfectly reachable under any subdomain.

## Consequences

### Positive:

- One Endpoint entry now represents an entire wildcard DNS zone, so users don't need to
  enumerate concrete subdomains manually.
- Reachability probes reflect the zone's actual health rather than the state of the often-idle
  apex record.
- The fix is contained to two call sites (one line in `parseHost`, one function call in
  `probe_endpoint`); no schema or storage change is required.

### Negative / accepted trade-offs:

- A wildcard zone whose operator chose an apex-only TLS certificate (not a wildcard cert) will
  read as Blocked instead of Up. This is an honest result — the synthesised subdomain genuinely
  fails TLS on such a zone — and is noted as acceptable in the design.
- Each probe round generates an extra DNS lookup for the synthesised name. At Qanary's probe
  cadence (10–60 s intervals per list) this is negligible and does not defeat DNS caching in
  any meaningful way.
- Existing stored hosts that were silently stripped to the apex before this change remain as
  apex entries. No migration is performed; users who want wildcard probing must re-add those
  endpoints.

### Follow-ups:

- The seed endpoint list for `*.cursor.sh` in `models.rs` still enumerates concrete subdomains
  (`api2..api5`). Leaving it alone is intentional — changing seed data would not migrate
  existing users and is out of scope for this change.
