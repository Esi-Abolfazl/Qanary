# Qanary — TODO

## Feature backlog

- [x] Lazy probing on mutations: adding/editing a service or opening the app should return immediately; connection tests run in background after the UI is already updated. Never block the user waiting for probe results.
- [x] Loading states on all async buttons (refresh, remove service, modal submit)
- [x] Multi-endpoint services: single service with multiple hosts, expandable in UI
- [x] Bulk service input: paste `label: host1, host2` lines to add multiple services at once
- [x] Edit option for individual services (label + endpoints)
- [x] Tray icon
- [x] System notifications on status transitions (up→down, down→up)
- [x] Show changelog after update (in-app release notes on new version)
- [x] Hide-in-dock option (macOS)
- [x] Add to system startup (launch on login)
- [x] Drag & drop reordering for lists, services, and IP provider (change their place/order)
- [x] Probe interval by list criticality (critical 30s / non-critical 60s defaults, min 10s, editable from Settings) — reframed from "per-service override" (ADR-0017)
- [x] Network-change-triggered refresh: probe immediately when system network state changes (wifi on/off, ethernet plug, VPN up/down) instead of only on the interval timer. Use interface-change watching (`if-watch`: route socket on macOS, netlink on Linux, `NotifyIpInterfaceChange` on Windows) for wifi/ethernet/tunnel-interface VPNs. Additionally watch the route table (macOS `SCDynamicStore`/`PF_ROUTE`) to catch split-tunnel VPNs that change routes without changing interface IPs. Debounce burst events (~500ms) into a single probe round. (ADR-0018)
- [x] Export / import config (JSON file picker) — native save/open dialog; Config card at top of Settings (standalone, outside the Save form); import guarded by an overwrite-confirmation modal (ADR-0019)
- [x] DB/config migration system: versioned schema so each new version's config changes apply automatically for existing users on upgrade — integer `schema_version` + numbered `store::migrate` runner (ADR-0019)
- [ ] Wildcard endpoint probing (`*.host.com` → probe resolved subdomain)
- [ ] Block-page detection via content heuristics (HTTP 200 but wrong content)
- [ ] Probe accuracy (own plan): confirm-before-flip (require K consecutive failures before showing Down — kill transient false outages); backoff on success only (keep fast retries while Down so recovery shows quickly, back off only stable-Up services); HEAD→GET fallback. Separate from the per-Service probe-task rewrite (`.claude/plans/2026-06-25-probe-system-rewrite-per-service-tasks.md`), which keeps `classify` verbatim and only changes scheduling.


### Optional features
- [ ] Status widget (macOS first, then Windows/Linux)

## Known limitations

- Wildcard endpoints (`*.cursor.sh`) have `*.` stripped; probes the bare domain only.
- Block pages that serve valid HTTPS 200 are indistinguishable from "up".

