# 0015. Background interval + visibility self-update check with version supersede

- **Status:** accepted
- **Date:** 2026-06-25
- **Deciders:** Esi-Abolfazl

## Context

Qanary previously checked for a newer version only at startup (once, in the main `useEffect`)
and when the user pressed "Check for updates" in Settings. A machine left running for days or
weeks would never re-check between those two events. This meant users could run a stale version
indefinitely without knowing a fix or feature was available.

A secondary bug compounded the problem: `checkForUpdate()` in `update.ts` stored the returned
`Update` handle in a module-level `pending` variable unconditionally on every call. If the
updater returned the same version on a background re-check, it replaced the previously stored
handle — even if that handle had already been downloaded (`pending.download()` called). A
subsequent "Restart" call to `pending.install()` would then attempt to install a handle that
was never downloaded, causing a silent failure or crash.

## Decision

**Guard the `pending` handle (update.ts).** `checkForUpdate()` now replaces `pending` only
when the incoming version differs from what is already stored. A same-version re-check
preserves the existing (potentially downloaded) handle, so "Restart" remains safe regardless
of how many background checks have fired since the download completed.

**Centralise the update check in `runUpdateCheck()` (App.tsx).** All three call sites
(startup, interval, visibility event) route through one function that:
- skips while a download is in progress (`updatePhaseRef.current === "downloading"`),
- records `lastCheckRef.current = Date.now()` so the visibility handler can tell whether
  enough time has passed,
- feeds the result through `nextUpdatePhase` to compute the new UI state safely.

**`nextUpdatePhase` supersede rule (src/utils/updateCheck.ts).** A pure function that takes
`{phase, version}` + `UpdateInfo | null` and returns the next state:
- `null` → unchanged (up-to-date re-check, nothing to do),
- newer version → `{phase: "available", version}` (reset, force re-download even if ready),
- same version → unchanged (preserves `downloading` or `ready`).

**6-hour `setInterval` + `visibilitychange` re-check (App.tsx useEffect).** The interval
fires `runUpdateCheck` every 6 hours while the window is open. The visibility listener fires
it when the document becomes visible *and* at least one interval period has elapsed since the
last check — covering webview timer throttling during laptop sleep or app backgrounding.
Both are cleaned up in the `useEffect` return.

## Alternatives considered

- **Backend Rust scheduler** — rejected. The Tauri updater API is entirely JS-side; adding a
  Rust-to-frontend bridge just to trigger a JS function adds complexity for no benefit.
- **Showing the version number in the hero banner** — rejected. The plan scoped this out
  (YAGNI); the banner remains button-only.
- **Polling every minute** — rejected. The update endpoint is external; 6 hours matches the
  cadence of most self-update tools and avoids hammering the release endpoint.

## Consequences

## **Positive:**

- Updates are caught within ~6 hours on any machine, not just at next restart.
- The "Restart installs a never-downloaded handle" bug is closed at the root (one guard covers
  all three call sites).
- Version supersede works correctly: a user who ignored 1.0.1 and then 1.0.2 ships is moved
  directly to 1.0.2 without needing to install 1.0.1 first.

## **Negative / accepted trade-offs:**

- The Settings modal's own `updateInfo` label (its local `checkForUpdate` call result) may
  momentarily lag behind a background supersede. Low severity — the shared `pending` handle
  in `update.ts` stays correct, so any install is always the right version.

## **Follow-ups:**

- None. The interval and listener are cleaned up in the existing `useEffect` return; no leak.
