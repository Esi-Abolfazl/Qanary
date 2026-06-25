# ADR 0001 — Configurable WAN IP providers + separate geolocation

**Date:** 2026-06-17  
**Status:** Accepted

## Context

- `ip-api.com` was queried over plain HTTP. Behind a proxy or VPN the HTTP request exits a
  different network interface than the browser, reporting a different IP than the user sees
  in online scanners.
- `ifconfig.me` and `ipify.ir` (the preferred replacements) return only a bare IP address
  as plain text — no country or flag data.
- The header shows a country flag derived from the WAN IP lookup; this must be preserved.
- The user wants to see and edit the provider URLs, with a third fallback slot.

## Decision

1. **Store providers without scheme** as `host/path` strings (e.g. `ifconfig.me/ip`).
   The backend prepends `https://` at fetch time. Users type without the prefix; the
   frontend `parseHost` utility strips it if they include it anyway.

2. **Resolve IP and geolocation in two steps:**
   - Try each provider in order; accept the first response that parses as a valid
     `IpAddr` (via `std::net::IpAddr::from_str`). Garbage/HTML/JSON bodies self-reject.
   - Pass the resolved IP explicitly to `https://ipwho.is/{ip}` for country + flag.
     Because the IP is in the URL (not derived from the request's egress), the result is
     egress-independent regardless of proxy/VPN.

3. **`ip_providers: Vec<String>`** added to `Config` with `#[serde(default)]` so existing
   `config.json` files without the field load the three seeded defaults without error.

4. **`get_config` command** added so the frontend can read the current provider list on
   startup and seed the Settings panel inputs.

5. **`update_settings`** extended with an optional `ip_providers` param. Empty strings are
   filtered; saving triggers an immediate `refresh_now` (WAN re-resolve) from the frontend.

6. **`parseHost` utility** (`src/utils/parseHost.ts`) normalises any messy host string —
   markdown links, `https://`, `www.`, `*.`, `/*`, trailing slashes — into a clean
   `host` or `host/path`. Used in both Settings (providers) and AddServiceForm (service hosts).

## Alternatives considered

- **JSON endpoints + configurable field name** — more config surface for no gain; plain-text
  covers all chosen providers.
- **Keep ip-api.com, force HTTPS** — still a single hardcoded provider; the egress problem
  persists for the IP query itself.
- **User-configurable geo endpoint** — YAGNI; geo correctness is independent of provider
  choice once the IP is explicit in the request URL.

## Consequences

**+** IP reported matches what online scanners show, independent of proxy/VPN egress.  
**+** User can reorder or replace providers without touching code.  
**+** Graceful fallback: a provider returning non-IP text is skipped; geo failure still shows the IP.  
**−** Two HTTP round-trips per WAN refresh instead of one.  
**−** Depends on `ipwho.is` availability for the country/flag (falls back to empty flag).
