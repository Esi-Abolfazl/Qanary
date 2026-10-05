# Qanary — project notes for Codex

Desktop connectivity monitor. Traffic-light status for reachability of service lists.
Full v1 design: `.claude/plans/qanary-v1.md` (local only — `.claude/` is gitignored).

## What it does

- Probes two seeded lists (Internet: Codex/Telegram/ChatGPT/Google/X; Intranet: digikala/torob/divar/snapp).
- Internet list all-down → yellow (warn). Intranet list all-down → red (critical).
- Shows WAN IP + country flag + short name.
- Users add own services/lists. Config persisted as local JSON.

## Stack

- **Tauri v2** (Rust backend) + **React + Vite + TypeScript** frontend.
- Probe = TCP connect + HTTPS HEAD (classify Up / Blocked / Down).
- Storage: JSON in app config dir (`~/Library/Application Support/Qanary/config.json` on mac).
- mac first; Windows/Linux + tray/widget later (same codebase).

## Build / run

```bash
source "$HOME/.cargo/env"      # until login shell picks up cargo
pnpm install                   # frontend deps
pnpm tauri dev                 # run app (dev)
pnpm tauri build               # release bundle
pnpm test                      # frontend (vitest) + backend (cargo)
pnpm test:ui                   # frontend only — vitest run (jsdom)
pnpm test:rust                 # backend only — cargo test
pnpm test:e2e                  # Playwright e2e vs pnpm dev (port 1420)
pnpm dev                       # then http://localhost:1420/?mock (or ?mock=ok, ?mock=down, ?mock=critical, ?mock=offline): UI on canned data, no Tauri
```

## Testing

- **Backend logic** (`pnpm test:rust`): probe classify, rollup, persistence — cargo unit tests.
- **Frontend unit** (`pnpm test:ui`): vitest + jsdom. Pure-logic specs (`src/utils/*.test.ts`) plus
  component tests that render the real tree against a mocked `./api` (`src/App.test.tsx`).
  No Tauri runtime needed — `vi.mock("./api")` stands in for the `invoke` bridge.
- **Frontend e2e** (`pnpm test:e2e`): Playwright drives `pnpm dev` (port 1420) in headless
  system Chrome (`channel: "chrome"` — no `playwright install`). The Tauri IPC bridge is the app's
  own dev mock (`src/dev/mockTauri.ts`, ADR-0042): fixtures open `/?mock` and hand it data as
  `window.__MOCK__`. Covers: initial render, refresh,
  add-list, settings, Config card, a list reorder surviving the next `service-update`, list columns across window widths,
  the hero and cards on shared lines, control and card radii, the ☰ drawer, and the orb's motion.
  Native WKWebView (the actual app) still can't be WebDriver-driven on macOS — e2e targets the
  web frontend served by Vite, not the bundled native binary.
- **Self-verify before declaring done.** After touching frontend code, run `pnpm test:ui`
  (logic + component) and, for interaction/UI changes, `pnpm test:e2e`. These replace driving
  the native app — use them instead of asking the user to test. Add/extend specs for new logic.

## Env

- Rust via rustup: cargo/rustc 1.96.0, toolchain stable-aarch64-apple-darwin.
- Node v24.16.0, pnpm 12.8.1 (package manager; pinned only by `packageManager`, which CI reads too; build settings in `pnpm-workspace.yaml`). Xcode CLT present. brew at /opt/homebrew.

## Conventions

- User new to Rust → keep backend small + heavily commented.
- Frontend subscribes to the `status-update` (full snapshot) and `service-update` (per-Service
  delta) Tauri events (no polling), plus `menu-action` from the macOS app menu (ADR-0045).
- Backend owns all probe/rollup/persistence logic; the tray reuses the same snapshot.

## Every reply: scannable, ends with a status footer

The user has ADHD — optimize every reply for scanning, not reading:
front-load the answer, keep paragraphs short, make actions explicit.

End every reply — even one-liners — with this block, always last,
always in this order:

---
**Status:** ✅ done — or ⏳ in progress + what remains, in one line
**Need from you:** one concrete question or action — or "nothing"
**Heads-up:** ⚠️ must-know / must-do with consequences — or "none"
---

- One short line per row, never a paragraph.
- "Need from you" is a specific ask ("reply yes to apply", "paste the
  error"), never a vague "let me know".
- Heads-up is only for real consequences: side effects, processes
  left running, things that will break, deadlines. No filler.
- If all three are trivial, compress to one line:
  `Status: ✅ done · Need: nothing · Heads-up: none`

## ADRs

- Location: `docs/adr/` (in the project root, checked into git).
- Template: `docs/adr/_TEMPLATE.md`.
- Numbering: 4-digit zero-padded, continuing from highest existing file.
- Current highest: the largest number in `docs/adr/`; open PRs may already hold the next ones, so check them before picking a number.

## TODO

- Location: `docs/TODO.md`.
