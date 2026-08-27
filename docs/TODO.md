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
- [x] Wildcard endpoint probing (`*.host.com` → probe resolved subdomain)
- [x] Notification sound volume — one level for all alert sounds (`notify_volume`, 0–100 in steps of 1, default 100), slider in the Critical-list alerts card. Volume 0 mutes the audio and leaves the three Sound toggles alone; `alerts.ts::soundAudible` is the one predicate for "this channel can reach the user", so a `{volume: 0, sound: true}` config can't silently swallow an outage. Does not touch the OS banners (ADR-0026, ADR-0028)
- [ ] `updateSettings` / `Settings.onSave` positional-argument debt (ADR-0026 follow-up, still open) — 11 positional args on the invoke wrapper, 10 on the prop. Appending is safe (the Rust command takes named arguments, so a mismatch surfaces as a null) but a mid-list insertion would shift arguments silently. Move both to a single options object.
- [ ] Backend "probe round complete" signal — the frontend currently *infers* a settled probe round from silence (alert batch re-armed per edge, quiet = `timeout_ms + 1s`, hard cap 12s — ADR-0027). Only the backend knows when a round actually finished. Emitting that would cut worst-case alert latency (up to 12s today), drop the cap, and close the one case where the cap can still let a cross-wave double alert through: a hand-edited `config.json` whose `timeout_ms` makes the quiet period exceed 12s (not reachable from Settings).
- [ ] Wildcard `Reachable`-masking of a critical list's `all_down` (ADR-0024 follow-up) — a wildcard endpoint sitting in `reachable` keeps `fully_failing` from tripping even when every *real* endpoint of that service has failed, so the list never reports `all_down` and never alerts. Cut-off detection sidesteps it (its predicate ignores `fully_failing`) rather than fixing it.
- [ ] Endpoint-status detection: classify by HTTP status code (403/401/500 + any error-range response) as a distinct blocked/degraded state, not just TCP/HTTPS reachability. Block-page content heuristics (HTTP 200 but wrong body) out of scope — not a problem for now.
- [ ] Probe accuracy (own plan): confirm-before-flip (require K consecutive failures before showing Down — kill transient false outages); backoff on success only (keep fast retries while Down so recovery shows quickly, back off only stable-Up services); HEAD→GET fallback. Separate from the per-Service probe-task rewrite (`.claude/plans/2026-06-25-probe-system-rewrite-per-service-tasks.md`), which keeps `classify` verbatim and only changes scheduling.
- [ ] Anonymous usage analytics — platform/OS split, app version, install/usage counts. Nothing wired yet; decisions below, all reversible. Needs an ADR (next: 0022) when picked up.
  - **Backend: Aptabase, not Google Analytics.** GA is web-only (needs the Measurement Protocol for desktop) *and* `google-analytics.com` is blocked in Iran — our target audience — so GA would silently undercount exactly the blocked users we most care about. Aptabase is open-source, Tauri-native, privacy-first: no PII, no cookies, no device IDs; it hashes client IP + per-app salt server-side and discards every 24h; GDPR/CCPA/PECR compliant.
  - **Integration:** official `tauri-plugin-aptabase` (`Cargo.toml`) + `@aptabase/tauri` (JS), register `aptabase:allow-track-event` in the ACL. Plugin auto-attaches OS + app version; sends nothing on its own — every event is a manual `trackEvent(name, props)` (props ≤125 chars).
  - **Hosting: Aptabase Cloud (EU) free tier to start.** Risk: the ingestion endpoint may itself be filtered for some Iran users → those events lost (undercount); acceptable for rough metrics.
    - [ ] (optional, later) Self-host Aptabase on our own domain (Docker Compose) for full control + a sink we trust. Revisit once cloud proves events actually arrive from real users.
  - **Consent: disclosed, always-on, no in-app toggle** (document in README + privacy note). ⚠️ Reconsider before shipping: an always-on outbound beacon from a censorship tool is itself a signal and gives the user no control — opt-in (off by default, one Settings toggle) is the more defensible default for this audience.
  - **"Install count" caveat:** Aptabase's anonymous model counts daily sessions / active users, **not** lifetime installs (the user hash resets every 24h). For a true lifetime install count, generate a random install UUID stored in `config.json` and send it as an event property.

- [ ] Wake detection could replace the `visibilitychange` update-check hack (ADR-0015 / ADR-0029 follow-up) — both exist because the webview's timers freeze during sleep, but they detect it two different ways. `handleWake` in `App.tsx` is the more direct signal; folding `runUpdateCheck` onto it would remove the visibility listener and the `lastCheckRef` bookkeeping.
- [ ] `WAKE_GRACE_MAX_MS` is a fixed 20s guess at OS network re-establishment time (ADR-0029). A slow VPN reconnect exceeds it and gets the old offline-then-recovered pair. Revisit only if real machines show it.


### Optional features
- [ ] Status widget (macOS first, then Windows/Linux)

## Known limitations

- Block pages that serve valid HTTPS 200 are indistinguishable from "up".

