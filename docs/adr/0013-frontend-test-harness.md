# 0013. Frontend test harness — vitest + jsdom + Playwright/mockIPC, local-only

- **Status:** accepted
- **Date:** 2026-06-25
- **Deciders:** Esi-Abolfazl

## Context

Before this ADR, the project had no frontend test layer. The `.claude/CLAUDE.md` file
described a vitest setup that was never actually created, meaning frontend changes shipped
completely unverified by automated tooling. The only automated tests were Rust unit tests
for backend logic (probe classification, rollup, persistence), run via `cargo test`.

The core constraint is that the native macOS app wraps a WKWebView, which has no WebDriver
protocol support — it cannot be driven by Playwright, Selenium, or any other external
automation tool. This means the fully bundled binary can never be e2e-tested without manual
human intervention.

However, the frontend is a plain React + Vite TypeScript app that can be served standalone
(without Tauri) via `pnpm dev`. This web-server mode is fully testable: vitest can run
component tests in a jsdom environment, and Playwright can drive the Vite dev server in a
headless browser.

## Decision

We introduce a two-layer frontend test harness:

**Layer 1 — vitest + jsdom (unit + component):**
All logic in `src/utils/` is tested with pure-function vitest specs. The `App` component is
rendered in a jsdom environment against a fully mocked `./api` module (`vi.mock("./api")`),
so no Tauri runtime is needed. Tauri plugin packages (`@tauri-apps/plugin-notification`,
`@tauri-apps/plugin-autostart`, etc.) are mocked globally in `src/test/setup.ts`.

**Layer 2 — Playwright + mockIPC (e2e against Vite dev server):**
Playwright drives `pnpm dev` (port 1420) in headless Chromium. The `@tauri-apps/api/mocks`
`mockIPC` function is injected via `page.addInitScript` before the page loads, wiring
`window.__TAURI_INTERNALS__.invoke` to a canned handler. This exercises the real `api.ts`
wrapper layer (the actual `invoke` calls) rather than replacing it at the module level.
Command invocations are recorded in `window.__INVOKED_CMDS__` for assertions.

**Local-only:** No CI workflow is added. Both test layers run on developer/Claude machines.

**Live event emit:** The `status-update` event channel is not exercised in e2e (emitting
a Tauri event back through mockIPC requires holding a listener id that crosses the
`addInitScript` / page-script boundary). Snapshot-driven UI assertions use the
`refresh_now` return-value path instead, which is simpler and sufficient.

## Alternatives considered

- **Logic-only (no jsdom, no Playwright)** — rejected: would miss render bugs and wiring
  issues between the component tree and the api module.
- **VITE_MOCK module-swap for e2e** — rejected: replacing the entire `api.ts` with a
  mock module at build time would bypass the real `invoke` calls, defeating the purpose of
  e2e. `mockIPC` exercises the real api wrapper layer.
- **`node:test` + `tsx` with no framework** — rejected: no jsdom or component rendering
  story; the existing `transitions.test.ts` (which used this approach) was explicitly
  marked with a "upgrade to vitest if a suite is added" comment.
- **CI integration** — deferred by user choice: local-only is sufficient for the current
  solo development workflow; CI can be wired later without changing the test structure.

## Consequences

### Positive:

- Claude can now verify frontend changes before committing: `pnpm test:ui` for logic +
  component correctness, `pnpm test:e2e` for interaction correctness against the dev server.
- `CLAUDE.md` testing section accurately describes what exists.
- The test layer is fully additive: no source or runtime code was modified.

### Negative / accepted trade-offs:

- New devDependencies: `vitest`, `@testing-library/{react,user-event,jest-dom}`, `jsdom`,
  `@playwright/test`. All dev-only; zero runtime/bundle impact.
- Playwright requires a local Chromium download (~171 MiB, one-time, stored in the
  Playwright cache).
- The `status-update` live event channel is not covered by e2e (best-effort stretch goal,
  not a blocker).

### Follow-ups:

- Consider CI wiring (GitHub Actions) once the local suite is stable.
- Stretch: emit `status-update` events through `mockIPC` to test live transition handling.
