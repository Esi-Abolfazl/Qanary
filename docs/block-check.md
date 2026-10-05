# Cloudflare / Akamai block check (experimental)

How a site that refuses your IP stops reading green. Decision record: [ADR-0051](adr/0051-cdn-block-page-reads-as-blocked.md).

## The problem

Qanary's normal probe sends one HTTPS `HEAD` and counts **any** answer as `Up`. A site behind
Cloudflare or Akamai that has blocked your IP (a VPN's, often) answers `403` with a "you have been
blocked" page. The server is alive, so it read green, though you cannot use it.

## Turning it on

Add / Edit service dialog → **Check Cloudflare block (experimental)** (switch). The **?** beside it
explains the same thing in short. It is stored per service as `check_block` in `config.json`. Default
**off**; older configs load as off. In Add mode the switch applies to every service added in that
dialog.

## What a probe does

For a service with the switch on, per endpoint, after the usual `HEAD`:

| `HEAD` answer | What is remembered for this host and IP | Result |
|---|---|---|
| not a 403 from a known CDN | (anything) | `Up`; the host is forgotten |
| 403 from Cloudflare / Akamai | nothing yet | **one `GET`**, read the page; remember the answer |
| 403 from Cloudflare / Akamai | "blocked" by the same CDN | `Blocked`, **no request** |
| 403 from Cloudflare / Akamai | "clear" (read, not a block page) | `Up`, **no request** |

"Known CDN" = the `server` header is `cloudflare` or contains `akamai` (`AkamaiGHost`). The same rule
applies to the 30 / 60 s timer, a Refresh and a check of one list, service or host.

### Reading the page

The `GET` reads at most 16 KB and looks for the CDN's own wording, only when the status is 403:

| CDN | The body must contain |
|---|---|
| Cloudflare | `you have been blocked` or `Access denied` |
| Akamai | `Access Denied` and `Reference` |

A challenge page ("Checking your browser"), a plain 403, a 5xx error or another CDN's wording is **not**
a block. If the `GET` fails, the site stays `Up` and is remembered as clear.

A match makes the endpoint `Blocked` with `cause: cloudflare | akamai`. The row's tooltip then says
"Blocked by Cloudflare — the site answered but refused your IP (a VPN or proxy often causes this)".
Colours, counts, rollups and alerts are the ordinary Blocked ones.

## Memory: read once per IP

`BlockMemory` (`host:port` -> blocked / clear, in memory only) keeps what was found. It is emptied when:

- the **WAN IP changes** (the WAN lookup returns a different IP);
- the **network changes**: Wi-Fi, Ethernet or a VPN on or off (the network watcher);
- the **internet drops** (the app turns cut off);
- the app **restarts**;

and a host is forgotten alone when its `HEAD` is no longer a 403 from a CDN (the block lifted).

So switching a VPN on or off makes the first probe after it read each such site once, and nothing more
until the next change. If the IP changes without a network event, the WAN lookup (every 5 minutes, or
at once after a network event) clears it and, **only if some enabled service has the switch on**, starts
a probe round at once. With no switch on, nothing about probing changes.

**Quick toggles.** The memory has a generation number that every clear bumps. A probe takes it before
it touches the network and hands it back when it writes; an answer from before a clear (a probe that
began on the VPN and ended after it was switched off) is dropped, so the old route's "blocked" cannot
shadow the new one.

## Cost

One `GET` (up to 16 KB) per site that answers a CDN 403, per IP. Sites that do not answer such a 403
cost nothing extra, and with the switch off nothing changes at all. The normal `HEAD` probes (about
100–200 MB a day for the default lists) are untouched.

## Limits

- Only Cloudflare's and Akamai's wording is recognised; other firewalls still read `Up`.
- After an IP or network change the site flips within one probe round, not instantly.
- The log line `blockcheck: read host:port -> …` appears (run from a terminal) each time a page is read.
- A block that starts or ends without the IP changing is noticed only when the host's `HEAD` stops being a
  403 (it ends), or after the next IP or network change (it starts).
- The `GET` path is not covered by an automated test (it needs a TLS server); the decision, the memory,
  the cut-off and IP-change rules, the old-config default and the dialog are.

## Where it lives

| Piece | File |
|---|---|
| Decision (`verdict`), memory (`BlockMemory`, `Known`), recogniser (`block_cause`, `cdn_of`), `GET` (`block_page_cause`) | `src-tauri/src/probe.rs` |
| Clearing on IP change, cut-off | `src-tauri/src/scheduler.rs` (`ip_changed`), `probe.rs` (`note_cut_off`) |
| Clearing on network change | `src-tauri/src/commands.rs` (`refresh_in_background`) |
| `check_block` on a service | `src-tauri/src/models.rs`, `src-tauri/src/commands.rs` |
| The switch and the ? | `src/components/ServiceModal.tsx` |
| The tooltip | `src/components/ServiceRow.tsx` |
