# 0051. A CDN's block page (Cloudflare, Akamai) reads as Blocked: opt-in, asked once per IP

- **Status:** accepted (2026-11-07, by the project owner); amended 2026-11-07 (1.1.1: a global switch with a per-service override)
- **Date:** 2026-10-04
- **Deciders:** Sajjad (proposed), Esi-Abolfazl (accepted)

## Context

The probe sends one HTTPS `HEAD` and counts any answer as `Up` (see the header of
`src-tauri/src/probe.rs`). A site behind a CDN that refuses the user's IP, typically a VPN or proxy
exit, answers with a 403 and a block page: Cloudflare's "Sorry, you have been blocked", Akamai's
"Access Denied". The server is there, but the user cannot use it, and Qanary showed it green.

Reading the page costs a `GET`, and the probe runs every 30 / 60 seconds, so it must not be on by
default, nor repeated for a site already read.

## Decision

How it works in practice, with tables: [block-check.md](../block-check.md).

- **Opt-in, globally with a per-service override.** *Amended (1.1.1):* 1.1.0 had only a per-service
  switch, but a user learns a site is behind Cloudflare only after it reads `Up` wrongly, so picking
  services one by one in advance did not work. Settings › Block check has one switch
  (`Config::check_blocks`, default off, older configs load as off). The Add / Edit service dialog has a
  three-way "Check Cloudflare block (experimental)" control, Default / On / Off, with a "?" that explains
  it, stored as `Service::check_block: Option<bool>` (`None` = Default, not written). `Config::checks_block`
  is the one place that resolves them. A 1.1.0 service saved with `check_block: true` loads as a forced
  On, so nothing it did changes.
- **Read once per host and IP.** For a service with the check on, when the `HEAD` answers **403** from
  `server: cloudflare` or `AkamaiGHost` and nothing is known yet for that host, the probe sends one small
  `GET` and reads the first 16 KB. If the page is that CDN's own error page saying so (Cloudflare: "you
  have been blocked" or "Access denied" with its Ray ID; Akamai: "Access Denied" with its "Reference #"),
  the endpoint is `Blocked`, with `cause: "cloudflare"` or `"akamai"` (`block_cause` in `probe.rs`).
  The page marker is required because every answer through Cloudflare says `server: cloudflare`,
  including a site's own "Access denied" 403. A `GET` with no answer is not remembered, so the next
  probe reads again.
- **The answer is remembered**, blocked or clear (`BlockMemory`, `host:port` -> `Known`). While it is,
  later probes (manual or scheduled) send no `GET`: a known block stays `Blocked`, a clear 403 stays `Up`.
  The memory is cleared when the **WAN IP changes**, when the **network changes** (a VPN on or off), or
  when the **internet drops** (the app turns cut off), so the next probe reads once more. A host is also
  dropped as soon as its `HEAD` is no longer a 403 from a CDN (the block lifted). A restart starts empty.
- A probe that began before a clear cannot write its answer afterwards (a generation number), and a WAN
  IP change starts a probe round at once; both found by toggling a VPN several times quickly. The WAN
  lookup clears only when the memory was not already cleared since its last lookup, so a network
  change (cleared by the network watcher) is not read twice, and the first lookup at launch clears
  nothing.
- Switching a VPN on or off therefore costs one `GET` per such site and nothing more. (An earlier cut
  read only on a user's Refresh; a blocked VPN then read `Up` until the next Refresh, which tests showed
  to be wrong.)
- The latency is the real full-path one of the `HEAD`, because the server did answer.
- A CDN's block page never counts towards cut off: an HTTPS answer from the CDN proves the internet
  works. It still fails its service and list like any Blocked.
- The UI uses the existing Blocked colour and rollups. Only the tooltip changes: "Blocked by
  Cloudflare — the site answered but refused your IP (a VPN or proxy often causes this)".
- A challenge page ("Checking your browser"), a plain 403 and any 5xx are not blocks.

## Alternatives considered

- **On for every service** — extra requests nobody asked for, and a false "Blocked" on sites that only
  look like one. Opt-in keeps the default unchanged.
- **Only a per-service switch** (1.1.0) — the user must guess which sites sit behind a CDN before any
  of them reads wrongly. Replaced by the global switch plus override in 1.1.1.
- **Only a global switch** — simpler, but leaves no way to exempt one site whose own 403 page still
  looks like a block.
- **Read the page on every probe** — a `GET` per site every 30 s; the memory avoids it.
- **Read only on the user's Refresh** — tried first; a blocked IP read `Up` until the next Refresh.
- **A new state with its own colour** — clearer, but touches every colour, the tray, the list counts and
  the alerts for one cause. Not worth it yet.
- **Judge from the `HEAD` headers alone** — no extra request, but a 403 from Cloudflare is not always
  a block (it also fronts challenge and plain-403 pages), so it would give false Blocked results.

## Consequences

## **Positive:**

Nothing changes for anyone who does not turn it on. With it on, a site that answers 403 from a CDN costs
one `GET` per IP, not one per refresh or per 30 seconds, and other sites cost nothing extra.

## **Negative / accepted trade-offs:**

- Right after an IP or network change the first probe reads the page, so a blocked site flips to `Blocked`
  within one probe round (a few seconds), not instantly.
- A blocked site counts as failing, so a list where every site is behind a block reads all down (and a
  critical one turns red), though never cut off.
- Only these two CDNs' wording is recognised. Other firewalls still read as `Up`.
- The `GET` path needs a TLS server to test end to end; the recogniser, the memory and the decision are
  unit-tested.

## **Follow-ups:**

Other firewalls (Imperva, Sucuri) if they turn out to matter.
