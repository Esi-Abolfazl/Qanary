# 0006. Adopt the "Canary" design system (tokens, themes, blocked→amber)

- **Status:** accepted
- **Date:** 2026-06-19
- **Deciders:** Esi

## Context

The UI grew organically with a single hard-coded dark palette in `App.css`
(`--bg`, `--panel`, `--green/--yellow/--red`). Three problems forced a deliberate
redesign:

1. **No brand identity.** The app reads as a generic dark utility. We want a bold,
   branded look that earns the name "Qanary" (a play on the coal-mine canary).
2. **No light theme.** Only dark exists; we want to follow the OS with a manual
   override.
3. **A latent color collision.** `--yellow` is used for the `blocked` Endpoint
   state, leaving no color free to be the brand — and the canonical brand instinct
   for a "canary" is yellow.

We ran a Design-It-Twice exploration: three radically different bold/branded
directions — a glance-and-go status **hero** ("Lighthouse"), a dense **ops
console**, and a brand-character **mood** design ("Canary"). We needed to pick a
spine and resolve the yellow question before writing any tokens.

## Decision

Adopt **"Canary"** as the design spine, grafting the **Lighthouse** `size`-variant
idea for surface portability:

- The window has a **mood** driven by overall Severity — calm/warm when green,
  alarmed (red wash + heartbeat pulse on the brand mark) when any List is
  `all_down`. Microcopy shifts calm → urgent and names the failing List.
- One load-bearing primitive (`BrandMark`) with `size: hero|compact|micro` so the
  same component renders the main window now and the widget/tray later.
- **`blocked` is recolored from yellow to amber-orange (`#f2792b`)**, freeing
  **canary yellow (`#ffcc00`)** to be the brand color (identity only, never a
  status). Heat axis: up green → blocked amber → down red.
- Tokens centralized in `src/tokens.css`. Theme = `color-scheme: light dark` for
  free OS-follow, plus a `data-theme` attribute for manual override, resolved via
  CSS `light-dark()` so every adaptive token is a single declaration.

State/brand/type/spacing/radii tokens are **constant** across themes and surfaces;
only chrome (bg/text/border/wash/elevation) adapts.

## Alternatives considered

- **"Ops console" (max density)** — rejected for now: sparklines and uptime% need a
  per-Endpoint history ring buffer the backend doesn't keep. That's a backend
  commitment we don't need. Its cheap pieces (`StateCountStrip`, `ListHealthBar`)
  are kept as optional, deferred add-ons.
- **"Lighthouse" (pure status-hero)** — strong glance-and-go and great
  scale-down, but its qanat-water-blue brand is generic. We took its `size`-variant
  portability idea but not its identity.
- **Keep yellow = `blocked`** — rejected: forces a non-yellow brand and perpetuates
  the current collision. The convention cost (users expecting yellow=warning) is
  smaller than the identity gain for a brand-led utility.
- **Duplicated `[data-theme="dark"]` token block instead of `light-dark()`** —
  rejected as a maintenance hazard (two value lists to keep in sync). `light-dark()`
  needs WebView ≥ Safari 17.5, which the current macOS WKWebView satisfies.

## Consequences

## **Positive:**

- Single source of truth for theming; OS-follow with zero JS.
- Light + dark both specified from day one.
- Brand color finally exists and the blocked/severity color collision is gone.
- Components built against tokens are portable to the future widget/tray unchanged.

## **Negative / accepted trade-offs:**

- `blocked = amber` deviates from the yellow=warning convention; brief relearning.
- Canary yellow fails contrast on white and behind white text → a hard rule:
  text on `--brand` must use `--brand-ink`. Yellow is limited to fills/marks.
- `light-dark()` sets a WebView floor (Safari 17.5 / 2024). Fine today; if an old
  WebView ever matters, fall back to a duplicated dark block.
- The mood layer (wash + pulse) is opinionated; needs a reduce-motion path
  (`prefers-reduced-motion` handles the pulse).

## **Follow-ups:**

- Migrate components off the old `App.css` palette onto the new tokens.
- Build `ThemeProvider` + a settings toggle for the manual override and persist it.
- Defer widget/tray surfaces; reuse `BrandMark size` variants when built.
