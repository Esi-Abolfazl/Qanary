# 0051. A CDN's block page (Cloudflare, Akamai) reads as Blocked — opt-in, asked once per IP

- **Status:** proposed (needs the owner's OK: it adds a GET to the probe)
- **Date:** 2026-10-04
- **Deciders:** Sajjad (requested), project owner (to confirm)

## Context

The probe sends one HTTPS `HEAD` and counts any answer as `Up` (see the header of
`src-tauri/src/probe.rs`). A site behind a CDN that refuses the user's IP, typically a VPN or proxy
exit, answers with a 403 and a block page: Cloudflare's "Sorry, you have been blocked", Akamai's
"Access Denied". The server is there, but the user cannot use it, and Qanary showed it green.

Reading the page costs a `GET`, and the probe runs every 30 / 60 seconds, so it must not be on by
default, nor repeated for a site already read.

## Decision

How it works in practice, with tables: [block-check.md](../block-check.md).

- **Opt-in per service.** The Add / Edit service dialog has a switch "Check Cloudflare block
  (experimental)" with a "?" that explains it. Stored as `Service::check_block`, default off; older
  configs load as off.
- **Read once per host and IP.** For a service with the switch on, when the `HEAD` answers **403** from
  `server: cloudflare` or `AkamaiGHost` and nothing is known yet for that host, the probe sends one small
  `GET` and reads the first 16 KB. If the page is that CDN's block page (Cloudflare: "you have been
  blocked" or "Access denied"; Akamai: "Access Denied" with a "Reference #"), the endpoint is `Blocked`,
  with `cause: "cloudflare"` or `"akamai"` (`block_cause` in `probe.rs`).
- **The answer is remembered**, blocked or clear (`BlockMemory`, `host:port` -> `Known`). While it is,
  later probes (manual or scheduled) send no `GET`: a known block stays `Blocked`, a clear 403 stays `Up`.
  The memory is cleared when the **WAN IP changes**, when the **network changes** (a VPN on or off), or
  when the **internet drops** (the app turns cut off), so the next probe reads once more. A host is also
  dropped as soon as its `HEAD` is no longer a 403 from a CDN (the block lifted). A restart starts empty.
- A probe that began before a clear cannot write its answer afterwards (a generation number), and a WAN
  IP change starts a probe round at once; both found by toggling a VPN several times quickly.
- Switching a VPN on or off therefore costs one `GET` per such site and nothing more. (An earlier cut
  read only on a user's Refresh; a blocked VPN then read `Up` until the next Refresh, which tests showed
  to be wrong.)
- The latency is the real full-path one, because the server did answer.
- The UI uses the existing Blocked colour and rollups. Only the tooltip changes: "Blocked by
  Cloudflare — the site answered but refused your IP (a VPN or proxy often causes this)".
- A challenge page ("Checking your browser"), a plain 403 and any 5xx are not blocks.

## Alternatives considered

- **On for every service** — extra requests nobody asked for, and a false "Blocked" on sites that only
  look like one. Opt-in keeps the default unchanged.
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
- A blocked site counts as failing, so a list where every site is behind a block can read as cut off.
- Only these two CDNs' wording is recognised. Other firewalls still read as `Up`.
- The `GET` path needs a TLS server to test end to end; the recogniser, the memory and the decision are
  unit-tested.

## **Follow-ups:**

Other firewalls (Imperva, Sucuri) if they turn out to matter.
