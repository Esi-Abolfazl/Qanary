# Qanary Design System — "The Canary"

Status: **shipped** — tokens in [`src/tokens.css`](../src/tokens.css), components live
under [`src/components/`](../src/components/). Direction decided in
[ADR-0006](adr/0006-canary-design-system.md).

## The idea

Qanary is named for the canary in a coal mine — the thing that warns you of
danger. So the app **behaves like a living creature that reacts to danger**: calm
and warm when everything is reachable, uneasy on a warning, alarmed when a
critical List goes `all_down`. The whole window has a *mood*, set by the overall
Severity (green / yellow / red), and you feel it before you read it.

Visual spine = brand character (Design "Canary"). Portability spine = a single
load-bearing primitive that shrinks cleanly to the future widget and tray panel
(Design "Lighthouse"'s `size` variant). We deliberately skipped the dense
ops-console direction — its sparklines/uptime need per-endpoint history the
backend doesn't keep, and that's a backend commitment we don't need yet.

## The one important decision: yellow → amber

Conventionally `blocked` (TCP ok, HTTPS failed) would be **yellow**. We reassign
it to **amber-orange `#f2792b`** so canary **yellow `#ffcc00`** is free to be the
brand. This also fixes a latent collision in the old CSS, where `--yellow` meant
both "blocked" and had no brand owner. Heat axis now reads cleanly:

```
up (green) → blocked (amber-orange) → down (red)
```

Cost: a first-time user may briefly expect yellow=warning. Worth it — Qanary's
whole pitch is identity, and amber-orange still reads "interference". See ADR-0006.

## Severity is ternary (green / yellow / red)

The window mood now has three levels, not two:

- **green** — all clear, `--wash-calm`.
- **yellow** (warn) — a non-critical List is `all_down`. `--wash-warn`; the hero
  egg + border tint to **amber `--state-blocked`** (there is no separate
  `--sev-yellow` token, warn reuses the blocked amber).
- **red** (alarm) — a **critical** List is `all_down`. `--wash-alarm`; egg
  heartbeats.

`--sev-green`/`--sev-red` alias the up/down states. Yellow has no severity token
because it borrows the amber blocked color.

## Tokens

All tokens live in [`src/tokens.css`](../src/tokens.css). Two classes:

- **Constant** — `--state-*`, `--sev-*`, `--brand-*`, type/spacing/radii. Identical
  in light, dark, window, widget, and tray. A green dot means one thing everywhere.
- **Adaptive** — chrome layers, text, border, `--wash-*`, `--elevation`. Wrapped in
  CSS `light-dark()` so each is one line and resolves per theme automatically.

### Color reference

| Token | Light | Dark | Role |
|---|---|---|---|
| `--state-up` | `#1fb872` | (same) | Endpoint/Service `up`, Severity green |
| `--state-blocked` | `#f2792b` | (same) | `blocked` — interception/interference |
| `--state-down` | `#e03131` | (same) | `down`, Severity red |
| `--state-checking` | `#8b93a3` | (same) | in-flight (pulses) |
| `--brand` | `#ffcc00` | (same) | canary yellow — identity only, never a status |
| `--brand-ink` | `#3d2e00` | (same) | **required** text color on `--brand` fills |
| `--brand-press` | `#e6b800` | (same) | pressed/active brand fills |
| `--bg-base` | `#fbfaf6` | `#14130f` | window base (warm, not clinical) |
| `--bg-layer` | `#ffffff` | `#1c1b16` | cards |
| `--bg-inset` | `#f2f0e9` | `#24221b` | inputs / wells |
| `--text-strong` | `#1a1a17` | `#f4f1e8` | primary text |
| `--text-muted` | `#6b6f76` | `#9a968a` | secondary text |
| `--border` | `#e6e3da` | `#2e2c24` | hairlines |

### Type / spacing / radii

System font stack throughout for now (`--font-brand` can take a display face
later without other changes). Scale `12/14/16/20/28/40`. Spacing 4px base
(`--sp-1..6`). Radii `8 / 14 / 20 / pill` — rounded is a brand signal.

## Theming (follow OS + manual override)

OS-follow is free: `color-scheme: light dark` on `:root` makes every `light-dark()`
token pick the system theme with **zero JavaScript**.

Manual override sets `data-theme` on the document element:

```ts
// "system" | "light" | "dark"; persist the choice (e.g. backend config or localStorage)
function applyTheme(mode: "system" | "light" | "dark") {
  const root = document.documentElement;
  if (mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
}
```

No flash-of-wrong-theme handling needed — `light-dark()` resolves before paint.
Shipped as the [`useTheme`](../src/theme.ts) hook (cycles system → light → dark),
persisting the choice to `localStorage`.

## Component inventory (shipped)

The actual building blocks under [`src/components/`](../src/components/). Each
consumes tokens only — no hard-coded hex (the one exception: the canary beak is
constant amber `#f2792b`) — which is what keeps them portable to the widget/tray.
Names below are the real files; some merged or renamed from the original plan.

| Component | File | Notes |
|---|---|---|
| **Canary** | [`Canary.tsx`](../src/components/Canary.tsx) | The brandmark SVG bird. Body fill themes via `--mark-body` (charcoal on light, yellow on dark); the **eye is the live status light** — `currentColor`, set by `.logo-mark`. Beak is constant amber. Replaces the planned "egg" BrandMark. |
| **StatusHero** | [`StatusHero.tsx`](../src/components/StatusHero.tsx) | Emotional center. Owns the `hero-{green\|yellow\|red}` wash, headline/submessage (`severityCopy()` map, inline), the Canary mark, the WAN chip, the hamburger menu, and the self-update button. Contains `StatusButton` — the "egg" refresh control (ping rings + breathe while busy, heartbeat `qhb` on red). |
| **ServiceList** | [`ServiceList.tsx`](../src/components/ServiceList.tsx) | The ListCard. Header (icon · name · add · options menu · collapse chevron) + the `banner-critical` strip when `all_down` + rows. Drives drag reordering of its services (inner `DndContext`). |
| **ServiceRow** | [`ServiceRow.tsx`](../src/components/ServiceRow.tsx) | dot · favicon (Google s2) · label · host · latency; single/multi-endpoint. Multi-endpoint folds in the endpoint disclosure (`endpoint-list`) and an `up/blocked/down` count strip. Edit/remove menu; grip replaces the dot in reorder mode. |
| **Icon** | [`Icon.tsx`](../src/components/Icon.tsx) | Inline SVG icon set (menu, plus, grip, refresh, chevrons, sun/moon/monitor, x, ellipsis…). |
| **Settings / ListModal / ServiceModal** | resp. files | Forms for WAN providers, system options (Dock, autostart), and list/service add+edit. |
| **ChangelogModal** | [`ChangelogModal.tsx`](../src/components/ChangelogModal.tsx) | Renders bundled CHANGELOG on update. |
| **Switch** | [`Switch.tsx`](../src/components/Switch.tsx) | Toggle primitive. |

State dots are **color-only**, not glyphs (see below). Theming is the
[`useTheme`](../src/theme.ts) hook, not a `ThemeProvider` component.

### State dots

A dot is a CSS `.dot.dot-{up|blocked|down|checking}` whose `::after` carries the
state color from `--state-*`. **Color only — no glyph characters.** `up` breathes
(`qbreathe`), `checking` emits a ping ring. The planned `●/◐/✕/○` glyph layer for
colorblind/monochrome was not built; if needed it's a CSS `::before` content add,
not a backend change.

### Optional density add-ons (deferred — from the ops-console direction)

`StateCountStrip` (`▲5 ◆2 ▼3`) and `ListHealthBar` (segmented per-Service bar) are
cheap on existing `Snapshot` data and can be added if a denser view is wanted.
Sparklines and uptime% are **not** — they need backend history. YAGNI for now.

## Layout sketches

### Calm (Severity green)

```
╭──────────────────────────────────────────────╮
│ ░ warm yellow wash ░░░░░░░░░░░░░░░░░░░░░░░░░ │
│  ☰                              ( • )🔄      │  ← menu · StatusButton egg = refresh
│             🐦  All clear                    │  ← Canary mark, eye = green light
│              Everything's reachable.         │
│  🇩🇪 DE · 84.13.22.7                           │
╰──────────────────────────────────────────────╯
╭──────────────────────────────────────────────╮
│  🌐 Internet                     5 up   ⌄  ⋯ │  ← ServiceList (ListCard)
│   ● Claude        claude.ai          42 m    │
│   ● Telegram      api.telegram.org   88 ms   │
╰──────────────────────────────────────────────╯
```

Yellow (warn) is the same layout with `--wash-warn` and the egg + Canary eye in
amber — used when a non-critical List is `all_down`.

### Alarmed (Severity red, critical List all_down)

```
╭──────────────────────────────────────────────╮
│ ▓ red wash floods from top ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
│  ☰                              (◉♥)🔄       │  ← egg heartbeats (qhb)
│             🐦  Something's wrong            │  ← Canary, eye = red light
│              Intranet is fully unreachable.  │
╰──────────────────────────────────────────────╯
╭──────────────────────────────────────────────╮
│ ▌ All services unreachable                   │  ← banner-critical
│  🏠 Intranet                 0 up · 4 ●  ⌄ ⋯ │
│   ● digikala      digikala.com    timed out  │  ← red dot
│   ● snapp         snapp.ir        blocked    │  ← amber dot
╰──────────────────────────────────────────────╯
```

(Dots are color-only — the glyphs above are sketch shorthand.)
`prefers-reduced-motion` disables the heartbeat pulse automatically.

## Scales down (widget / tray)

Personality lives in color + wash + the single Canary mark, not in layout, so it
survives shrinking:

- **Tray** — shipped ([ADR-0008](adr/0008-tray-icon-runtime-severity-light.md)).
  The menubar icon carries the severity light (calm vs red when a critical List
  is `all_down`), rendered at runtime from the same Severity the hero uses.
- **Widget** — still later. Plan: compact Canary + one-line SeverityCopy + a
  strip of state chips; wash becomes a soft inner glow.
