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
The probe result for a single Endpoint: `up` / `blocked` / `down` / `checking`.
`blocked` = TCP connected but HTTPS failed (likely interception).
_Avoid_: status

**Service state**:
The Service's displayed dot, computed **worst-wins** over its Endpoint states with
precedence `down > blocked > checking > up`. Reuses the Endpoint-state palette
(green/yellow/red/grey). A Service is **fully failing** (the separate rollup used for
List `all_down`) only when *every* Endpoint is failing (blocked or down).
_Avoid_: health, grade, severity (reserve "severity" for the overall app traffic light)

**List**:
A named, ordered group of Services (e.g. "Global", "Iran"). Rolls up to `all_down` when
every Service in it is fully failing (health = red).
_Avoid_: group, category

**Severity**:
The overall app-level traffic light: `green` / `red` (binary). Red when any List is
all_down. Distinct from per-Service health.
_Avoid_: status, health
