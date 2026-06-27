# Qanary

Desktop connectivity monitor. Probes lists of services for reachability and shows a
traffic-light status. This glossary fixes the canonical domain terms.

## Language

**Service**:
One named thing the user wants reachable (e.g. "Claude", "Cursor"). Owns a label and one
or more Endpoints. Carries a single `enabled` flag for the whole service.
_Avoid_: site, host (a host is part of an Endpoint, not the Service)

**Endpoint**:
One `host:port` pair that a Service probes. A Service with several Endpoints is reachable
to varying degrees depending on how many of its Endpoints respond.
_Avoid_: host (bare), target, address

**Endpoint state**:
The probe result for a single Endpoint: `up` / `reachable` / `blocked` / `down` / `checking`.
`blocked` = TCP connected but HTTPS failed (likely interception).
`reachable` (blue) = TCP-only confirmation, HTTPS deliberately skipped — used for
Wildcard endpoints, whose synthesised subdomain would falsely fail TLS. No latency recorded.
_Avoid_: status

**Service state**:
The Service's displayed dot, computed **worst-wins** over its Endpoint states with
precedence `down > blocked > checking > up > reachable`. Reuses the Endpoint-state palette
(green/blue/orange/red/grey). `reachable` is a non-failure ranked below `up`: a single
fully-verified `up` Endpoint shows the Service green; blue shows only when *every* Endpoint
is `reachable` (TCP-only wildcards). A Service is **fully failing** (the separate rollup used
for List `all_down`) only when *every* Endpoint is failing (blocked or down).
_Avoid_: health, grade, severity (reserve "severity" for the overall app traffic light)

**List**:
A named, ordered group of Services (e.g. "Global", "Iran"). Rolls up to `all_down` when
every Service in it is fully failing (health = red).
_Avoid_: group, category

**Severity**:
The overall app-level traffic light: `green` / `red` (binary). Red when any List is
all_down. Distinct from per-Service health.
_Avoid_: status, health

**Transition**:
A change in a **critical** List's `all_down` between two consecutive snapshots:
`false→true` is an **outage**, `true→false` is a **recovery**. The only events that fire
a notification + sound. Non-critical Lists and per-Service flips do not transition.
_Avoid_: change, flip, event (when you mean this specific critical-List crossing)

**Service probe task**:
One independent async task per enabled Service, owning that Service's probe cadence and
its last-known state. Tasks run concurrently (bounded by a shared concurrency limit), so
one slow Service never blocks the others.
_Avoid_: worker, thread, job, scheduler (one shared scheduler is exactly what this replaces)

**Status delta**:
The per-Service push a Service probe task emits the instant its probe lands: that Service's
new status plus its List's recomputed `all_down` and the new overall Severity. The Frontend
merges a delta into its local Snapshot. Distinct from the full Snapshot push.
_Avoid_: update, patch, event (bare)

**Self-update check**:
Querying the GitHub release endpoint (via the Tauri updater) for a newer app **binary**
version — distinct from a Service probe, which checks reachability. Runs at startup, on the
manual Settings button, and on a background interval. Always returns the *latest* available
version, so a re-check supersedes any older pending version.
_Avoid_: update (bare — reserved for Status delta), refresh (refresh = re-probe Services)

**Changelog entry**:
One `## [version]` section of CHANGELOG.md (dev-only subsections stripped for the modal).
The "What's new" modal shows a *list* of entries — every version released since the user
last saw notes — newest expanded, older collapsed.
_Avoid_: release note (bare), section

**Wildcard endpoint**:
An Endpoint whose host is written `*.domain` (e.g. `*.cursor.sh`). The wildcard is stored
literally and shown verbatim in the UI; at probe time the backend swaps the `*` for a fresh
random label (e.g. `<rand>.cursor.sh`) so it tests the wildcard zone's reachability rather
than the (often dead) apex. One Endpoint, one probe — not an enumeration of subdomains.
Probed **TCP-only**: the synthesised label rarely matches the zone's TLS cert, so HTTPS is
skipped — TCP-ok → `reachable` (blue), TCP-fail → `down`; never `blocked`, never latency.
_Avoid_: glob, pattern, apex (the apex is the bare domain, which is what this avoids probing)

**Effective interval**:
The actual sleep a Service probe task waits before its next probe, derived from the
configured `probe_interval_secs` with backoff (longer while the Service keeps failing) and
jitter (a small random spread so tasks don't all probe in lockstep).
_Avoid_: delay, period, cadence (when you mean this computed value)
