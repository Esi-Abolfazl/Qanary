# 0025. Disable idle HTTP connection pooling so WAN IP is fresh after a network change

- **Status:** accepted
- **Date:** 2026-07-15
- **Deciders:** Esi-Abolfazl

## Context

A network/VPN change already triggers a WAN refetch (ADR-0018 / commit `cd53a35`): `netwatch`
fires `probe_now`, and the WAN task at `src-tauri/src/scheduler.rs` subscribes and refetches.
The gap is **freshness** of that refetch, and it has two independent causes.

First, the single shared `reqwest::Client` (`src-tauri/src/lib.rs`, used by every probe HEAD
and the WAN GET alike) keeps idle keep-alive connections by reqwest's default (up to ~90 s). A
WAN GET issued right after a network change can reuse a socket that is still bound to the
pre-change route, silently returning the *old* egress IP instead of erroring — a stale reading
disguised as success.

Second, the WAN task's retry decision (`spawn_wan_task`) keyed its wait off whether a WAN IP
was already *cached* (`wan.is_some()`), not off whether the *last fetch* actually succeeded. If
the netchange-triggered refetch ran before the OS had the new route ready, `fetch_wan` returned
`None`; the task correctly kept the old IP visible rather than blanking it, but then fell back
to the full 300 s cadence — leaving the header showing a stale IP for up to five minutes.

## Decision

Build the shared client with `.pool_max_idle_per_host(0)` (`src-tauri/src/lib.rs`), so every
request — probe HEAD and WAN GET alike — opens a fresh connection over whatever route is
current at the moment it's made. This directly removes the stale-socket-reuse path; a fresh
TCP+TLS handshake is also, incidentally, a truer reachability signal than a reused keep-alive
that may already be half-dead.

Separately, in `src-tauri/src/scheduler.rs`, capture `fetch_wan`'s own outcome as `last_ok:
bool` and drive the WAN loop's wait off it instead of `wan.is_some()`. The decision is now a
pure function, `next_wan_delay(last_ok: bool) -> Duration`, returning the existing `WAN_REFRESH`
(300 s) on success and a new named constant `WAN_RETRY` (10 s, replacing the prior inline
literal) on failure — unit-tested for both branches. The prior behavior of leaving the last
known IP on screen when a fetch returns `None` is unchanged; only the *wait* before the next
attempt changes.

## Alternatives considered

- **WAN-only client with pooling disabled, probes keep pooling** — rejected: adds a second
  client field plus plumbing (`AppState`, every construction site) for no real benefit, since
  probe HTTPS legs go stale after a network change for exactly the same reason the WAN GET
  does. One builder flag on the one shared client covers both.
- **Swap or rebuild the whole client on a netchange event** — rejected: `AppState.client` is a
  plain `reqwest::Client` field, not behind a `Mutex`/`ArcSwap`; making it swappable would touch
  every call site that reads `state.client` for a problem the pool-disable flag solves in one
  line.
- **Leave pooling on, fix only the retry cadence** — rejected: this closes gap #2 (slow retry)
  but leaves gap #1 (a reused stale socket silently returning the old IP, with no error to
  retry on) completely unaddressed — the two causes are independent and both needed a fix.

## Consequences

## **Positive:**

- WAN info reflects the current default route within seconds of a network/VPN change, robust
  to both full-tunnel and split-tunnel VPN configurations.
- Probe HTTPS legs also become fresh-per-probe, which is a truer reachability signal than a
  possibly-stale reused connection.
- No persisted-config, schema, or contract change — both edits are internal to the Rust
  backend's client construction and one scheduling decision.

## **Negative / accepted trade-offs:**

- Slightly more TCP/TLS handshake overhead per request, since every probe HEAD and WAN GET now
  pays a fresh handshake instead of reusing a warm connection. Accepted as negligible at the
  current cadence (30/60 s probes, 300 s WAN); revisit only if a much larger endpoint list ever
  shows measurable cost.
- If WAN fetches never succeed (sustained offline), the loop retries every 10 s indefinitely
  rather than backing off further. Accepted: this mirrors the same 10 s floor already used for
  the startup-unknown case, offline is a genuine "keep trying" state, and each attempt is one
  cheap GET.

## **Follow-ups:**

- None — rollback is a two-edit revert (the builder line in `lib.rs`, the wait-decision block
  in `scheduler.rs`) with no persisted state to unwind.
