# Qanary Design System — "The Canary", Glass look

Status: **shipped** — tokens in [`src/tokens.css`](../src/tokens.css), components live
under [`src/components/`](../src/components/). Direction decided in
[ADR-0006](adr/0006-canary-design-system.md); the Glass look in
[ADR-0032](adr/0032-glass-ui-redesign.md). The design prototype is
[`docs/design/glass-preview.html`](design/glass-preview.html) (open it in a browser; it has
a demo bar to switch states, theme and the Settings view).

## The idea

Qanary is named for the canary in a coal mine — the thing that warns you of
danger. So the app **behaves like a living creature that reacts to danger**: calm
when everything is reachable, uneasy on a warning, alarmed when a critical List
goes `all_down`. The whole window has a *mood*, and you feel it before you read it.

The mood is one color, `--sev`. It tints the logo's eye, the orb, and a soft glow
behind the orb. Shape and motion say it too, so color is never the only signal.
The moods keep the pre-Glass (v0.6.5) status palette, `--mood-*` in `tokens.css`; offline,
which v0.6.5 didn't have, takes the gray (ADR-0043).

| Mood | When | `--sev` | Orb rings | Motion |
|---|---|---|---|---|
| ok | Severity green | `--mood-ok` | 3 solid | pop + ripple on arrival |
| warn | Severity yellow (a non-critical List is `all_down`) | `--mood-warn` | 2 faded + "!" | pop + ripple |
| alarm | Severity red (a critical List is `all_down`) | `--mood-alarm` | 3 dashed | shake on arrival, logo blinks |
| offline | `cut_off` (nothing reachable at all) | `--mood-offline` (gray) | Wi-Fi off: 3 dashed arcs + dot + slash | shake on arrival; orb can't be clicked |
| busy | any service still `checking` | `--mood-busy` (yellow) | 3 solid, rippling outward | ripples until done |
| idle | no lists / no services | `--state-checking` | 3 solid | — |

`StatusHero` derives the mood in `moodOf()`; the headline copy (`severityCopy()`) is
separate and unchanged.

### Two icon styles (the orb)

The orb draws the mood one of two ways; the user picks in **Settings → Appearance → Status
icon** ([ADR-0033](adr/0033-selectable-orb-icon-style.md)), and the menu-bar icon follows the
same choice ([ADR-0044](adr/0044-one-status-icon-setting-for-orb-and-menu-bar.md)). Color, glow and
arrival motion are shared; only the icon differs. Definitions:
[`orbIcons.tsx`](../src/components/orbIcons.tsx); choice: `status_icon` in the config, applied on Save.

| Mood | Rings | Pulse (default) |
|---|---|---|
| ok | 3 solid rings, breathing | ECG line, a soft light runs along the wave |
| warn | 2 faded rings + "!"; the dashed ring turns, the "!" blinks | shallower beat, a faster light |
| alarm | 3 dashed rings, a double heartbeat | a 20 s story, entered on the dead line: the dashed line crawls with the X for ~17 s, then the beat returns, stutters and drains away |
| offline | Wi-Fi off (same icon); arcs sink, slash fades | Wi-Fi off (same icon, Pulse's 2px stroke); arcs sink, slash fades |
| busy | rings ripple outward, fast | trace with a faster light |
| idle | 3 solid rings | quiet flat line |

Every state moves in both styles ([ADR-0038](adr/0038-orb-motion-in-every-state.md)); reduced motion
stops it (Pulse Alarm then shows just the dashed line and the X).

### The menu-bar icon (tray)

Same two pictures as the orb, drawn in Rust ([`tray.rs`](../src-tauri/src/tray.rs)) and redrawn as
SVG for the picker ([`trayIcons.tsx`](../src/components/trayIcons.tsx)). The picture is the orb's
`status_icon` (**Rings**, or **Pulse**: a heartbeat in a rounded-square outline); **Settings →
Appearance → Menu bar** picks **Outline** or **Filled** (`tray_filled`: the picture cut out of a
colored rounded square). It shows what the orb shows, in the orb's `--mood-*` colors (a
Rust test checks them against `tokens.css`). Every look has five states:

| State | Color | Rings | Pulse |
|---|---|---|---|
| all clear | `--mood-ok` | 3 solid rings | heartbeat |
| heads up | `--mood-warn` | 2 rings + "!" | shallower beat |
| alarm | `--mood-alarm` | 3 dashed rings (filled looks: 2, coarser) | dashed flat line + X |
| offline | `--mood-offline` (gray) | Wi-Fi off: 3 dashed arcs + dot + slash | the same Wi-Fi off (no frame) |
| checking | `--mood-busy` | all clear's picture, breathing | all clear's picture, breathing |

Checking lasts the whole probe round: the icon breathes until the snapshot is `settled`, the same
flag that keeps the in-app orb busy, so a result landing mid-round never flashes a stale state.

The icon is 44 px (macOS shows it 18 pt tall). Stored as `status_icon` + `tray_filled` in the config, not per device.

The right-click menu lists every list first — a coloured dot and `name · 4/5` / `All unreachable`,
same wording and dot colours as above — then Show / Hide, Refresh now, Quit
([ADR-0035](adr/0035-tray-menu-shows-each-list.md)). Clicking a list row shows the window.

## The one important decision: yellow → amber

Conventionally `blocked` (TCP ok, HTTPS failed) would be **yellow**. We reassign
it to **amber-orange `#ff9a3d`** so canary **yellow `#ffd23f`** is free to be the
brand. Heat axis reads cleanly:

```
up (green) → blocked (amber-orange) → down (red)
```

Cost: a first-time user may briefly expect yellow=warning. Worth it — Qanary's
whole pitch is identity, and amber-orange still reads "interference". See ADR-0006.

## Severity is ternary (green / yellow / red)

- **green** — all clear.
- **yellow** (warn) — a non-critical List is `all_down`; the orb tints to the amber
  `--mood-warn`.
- **red** (alarm) — a **critical** List is `all_down`.

`--sev-green`/`--sev-red` alias the up/down states. On the orb and the tray icon, offline is gray,
not red, so "you have no network" and "a critical list is down" read apart; rows keep
`--state-offline`.

## Shared surfaces (one look everywhere)

Boxes of a kind share one definition, as custom properties at the top of
[`App.css`](../src/App.css) ([ADR-0037](adr/0037-one-glass-look-shared-surfaces.md)). A new box uses
them; it does not invent its own gradient.

| Variable | Used by |
|---|---|
| `--card-bg` / `--card-border` / `--card-shadow` | list cards, Settings cards, changelog cards — a faint gradient, a lit top edge, a soft lift. Almost opaque (so the orb's glow does not tint one card only) |
| `--btn-bg` / `--btn-border` / `--btn-shadow` | secondary buttons (Settings, dialog Cancel, Check now), the IP chip, the hero ☰ and its drawer, the Critical-switch row |
| `--brand-btn-bg` / `--brand-btn-shadow` | primary yellow buttons: Save, Update, Install, Done |
| `--switch-on` | every switch's "on" track: v0.6.5's flat `#ffcc00`, on the v0.6.5 36×20 switch ([ADR-0046](adr/0046-switches-are-gold-when-on.md)) |
| `--danger-btn-bg` / `--danger-btn-shadow` | the destructive confirm (the red of a down Critical list's name chip) |
| `--noise` | the fine grain on the window |

Other shared looks, in the same file: **status dots** are glowing beads (the dot on a site tile has a
ring but no glow); the **switches** (dialog, System, the alert table) are one switch; the **orb** is a
gentle bead with the *same* halo and glow in light and dark; an **open multi-host row** is one faint
panel (indigo-tinted in light — white is invisible on a white card) that only deepens on hover; the
**lists' top edge** is an eased fade mask with no blur layer (a blur always left a seam); the **logo**
has a wide soft yellow glow behind it; the **list-name chip** is a gradient chip with a ring. All of
it uses `light-dark()` so light and dark are one rule.

## Tokens

All tokens live in [`src/tokens.css`](../src/tokens.css). Two classes:

- **Constant** — `--state-*`, `--sev-*`, `--brand-*`, type/spacing/radii. Identical
  in light and dark. A green dot means one thing everywhere in the app. (The tray icon
  is drawn in Rust with the orb's `--mood-*` values — [ADR-0043](adr/0043-orb-keeps-the-pre-glass-status-colors.md).)
- **Adaptive** — chrome layers, glass surfaces, text, border, `--elevation`. Wrapped
  in CSS `light-dark()` so each is one line and resolves per theme automatically.

### Color reference

| Token | Light | Dark | Role |
|---|---|---|---|
| `--state-up` | `#2fd08a` | (same) | `up`, Severity green |
| `--state-reachable` | `#3b82f6` | (same) | TCP-only reachable (wildcard zones) |
| `--state-blocked` | `#ff9a3d` | (same) | `blocked` — interception/interference; Severity yellow |
| `--state-down` | `#ff5a52` | (same) | `down`, Severity red |
| `--state-offline` | `#b8123f` | (same) | `cut_off` — no network at all |
| `--state-checking` | `#8b93a3` | (same) | in-flight; idle orb |
| `--mood-ok` / `--mood-warn` / `--mood-alarm` | `#1a9c61` / `#f2792b` / `#e03131` | (same) | orb and tray moods (v0.6.5 palette, green darkened) |
| `--mood-busy` | `#e6b400` | (same) | orb and tray while checking (v0.6.5's brand yellow, darkened) |
| `--mood-offline` | `--state-checking` | (same) | orb when `cut_off` |
| `--brand` | `#ffd23f` | (same) | canary yellow — identity only, never a status |
| `--brand-ink` | `#3d2e00` | (same) | **required** text color on `--brand` fills |
| `--brand-press` | `#e6bb2e` | (same) | pressed/active brand fills |
| `--bg-base` | `#c9ccd6` | `#0d0d10` | window base |
| `--bg-layer` | `#f3f4f8` | `#1c1c1f` | opaque layers: menus, notices, modal fallback |
| `--bg-inset` | `rgba(30,28,60,.07)` | `rgba(255,255,255,.07)` | wells |
| `--glass` | `rgba(255,255,255,.5)` | `rgba(255,255,255,.06)` | translucent surface |
| `--glass-strong` | `rgba(255,255,255,.72)` | `rgba(255,255,255,.11)` | hover / raised glass |
| `--stroke` | `rgba(255,255,255,.9)` | `rgba(255,255,255,.12)` | glass hairlines |
| `--down-ink` | `#c4221b` | `#ff8f89` | "Down" / "Critical" text — legible on glass |
| `--text-strong` | `#15131f` | `#ffffff` | primary text |
| `--text-muted` | `rgba(21,19,31,.6)` | `rgba(255,255,255,.66)` | secondary text |
| `--border` | `rgba(30,28,60,.14)` | `rgba(255,255,255,.12)` | hairlines on plain surfaces |

### Type / spacing / radii

System font stack throughout. Scale `12/14/16/20/28/40`. Spacing 4px base
(`--sp-1..6`). Radii `8 / 14 / 20 / pill` for tokens; the glass surfaces use 9–12px
for controls, 18px for list cards and 24px for dialogs.

## Theming (follow OS + manual override)

OS-follow is free: `color-scheme: light dark` on `:root` makes every `light-dark()`
token pick the system theme with **zero JavaScript**. Manual override sets `data-theme`
on the document element via the [`useTheme`](../src/theme.ts) hook (cycles system →
light → dark, persisted in `localStorage`). The control lives in **Settings → Appearance**.

## Component inventory (shipped)

Each consumes tokens and the shared surface variables above — no hard-coded hex beyond the canary
beak (constant amber `#f2792b`) and the status-orb and button gradients.

| Component | File | Notes |
|---|---|---|
| **Canary** | [`Canary.tsx`](../src/components/Canary.tsx) | The brandmark SVG bird. The **eye is the live status light** — `currentColor` = `--sev`, so it cross-fades with the mood. |
| **StatusHero** | [`StatusHero.tsx`](../src/components/StatusHero.tsx) | Logo, then the ☰ (`HeroMenu`, `.hero-btn`), which grows a glass drawer to its left with Add list, Edit order and Settings, each named in a tip on hover; headline, subtitle, IP chip and update button on the left; the **orb** (`StatusOrb`) on the right. The orb is the refresh button: its icon (Rings or Pulse) carries the mood, hover shows a refresh arrow (`OrbRefresh`, drawn in the orb icons' frame and stroke at 0.85 opacity), busy pulses. The soft glow is a child of the orb wrapper. |
| **orbIcons** | [`orbIcons.tsx`](../src/components/orbIcons.tsx) | `ORB_ICON[style][mood]`, `OrbIcon`, `OrbRefresh` (the hover arrow) and `OrbThumb` (the live sample in Settings). |
| **ServiceList** | [`ServiceList.tsx`](../src/components/ServiceList.tsx) | The list card. Gray name chip (a green shield inside it marks a healthy Critical list). Fully down, the chip takes a soft red tint with a thin, slowly breathing ring; a Critical list's turns solid red and pulses instead · `n/m` or **All unreachable** · add · ⋯ menu · collapse chevron. Rows animate open/closed ([`useCollapsible`](../src/components/useCollapsible.ts)). Drives drag reordering of its services (inner `DndContext`). |
| **ServiceRow** | [`ServiceRow.tsx`](../src/components/ServiceRow.tsx) | Favicon tile with letter fallback and a corner status dot · name + host · latency · **Blocked**/**Down**/*TCP only* as plain text in their state color (same weight as the latency). For a service with **Check Cloudflare block (experimental)** on (Add / Edit service dialog, with a "?" that explains it), a host that answers with a Cloudflare or Akamai block page reads **Blocked** with its own tooltip ([ADR-0051](adr/0051-cdn-block-page-reads-as-blocked.md)). Multi-endpoint rows show `7 ● · 4 ●` and expand on a click anywhere on the row. ⋮ menu; a grip replaces the tile in reorder mode. |
| **Icon** | [`Icon.tsx`](../src/components/Icon.tsx) | Inline SVG icon set (`strokeWidth` prop). |
| **Settings / ListModal / ServiceModal** | resp. files | Glass dialogs. Settings groups are glass cards with small-caps headings; toggles are switches (the alert checkboxes are real checkboxes drawn as switches). The **volume slider is the original native range input**, deliberately kept. Theme, the status icon (Rings / Pulse, plus the menu bar's Outline / Filled, as two segmented rows) and Reset to defaults live here. |
| **ChangelogModal** | [`ChangelogModal.tsx`](../src/components/ChangelogModal.tsx) | Renders bundled CHANGELOG on update. |
| **Switch** | [`Switch.tsx`](../src/components/Switch.tsx) | Toggle primitive. |

Theming is the `useTheme` hook, not a `ThemeProvider` component.

### Status dots and badges

Every status color comes from one rule: an element with `data-state="up|reachable|blocked|down|checking"`
gets `--c`, which the avatar's corner dot, the Blocked/Down label and the count dots all read. While
`cut_off`, `reachable`/`blocked`/`down` all resolve to `--state-down` (ADR-0024) and the lists are muted.

- **Corner dot** — on the service tile, rings the card color so it looks cut out. `checking` pulses.
- **Label** — no boxes: `blocked` / `down` show their name and `reachable` shows "TCP only", each
  as plain text in its state color; `up` shows gray latency, `checking` shows *Pinging…*.
- **Count dots** (`7 ● · 4 ●`) and the endpoint sub-list use the same colors.

State is color + position + a text label for the two states that matter; there is no glyph layer.

### Motion

Everything respects `prefers-reduced-motion`. The vocabulary is small:

- **Orb**: pop + ripple + flash when the mood changes (shake for alarm/offline), then each state's own slow motion (table above, [ADR-0038](adr/0038-orb-motion-in-every-state.md)); fast ripples while busy. Pulse style draws one gradient line (faded at both ends) with a soft light that runs along the wave — slow along the flat stretches, fast through the beat, then out past the end and a rest off the line. Pulse Alarm is a 20 s loop (a failing heartbeat, then a crawling dead line with the X). Offline is the same Wi-Fi-off icon in both styles, and the orb is disabled: with no network on the machine a refresh can't help, and the scheduled checks carry on.
- **List names**: a name too long for its chip ends in an ellipsis and, on hover, glides to its last letter with a transform (sub-pixel, no jitter) and eases back ([ADR-0039](adr/0039-list-name-glide-uses-a-transform.md)).
- **Pulse** (`pulse-ring` / `pulse-icon`): the "look at me" motion, shared by a down Critical list's name chip and
  a ready update button.
- **Collapse**: one 300ms grid-rows tween plus a calm 200ms chevron rotation. No spring.

### Optional density add-ons (deferred)

`ListHealthBar` (segmented per-Service bar) is cheap on existing `Snapshot` data and can be
added if a denser view is wanted. Sparklines and uptime% are **not** — they need backend history.

## Layout sketch (460×720 window)

```
╭──────────────────────────────────────────────╮
│ 🐦 Qanary                            ＋  ⚙   │  ← eye = mood color
│                                    ░░░░░░    │
│ All clear                         ░( ◎ )░░   │  ← orb = refresh; glow fades by the
│ Everything's reachable.            ░░░░░░    │    middle of the first list
│ 🇩🇪 DE │ 203.0.113.42   [↓ Update]            │
╰──────────────────────────────────────────────╯
╭──────────────────────────────────────────────╮
│ ⌜🌐 Global 🛡⌝              7/7   +   ⋯   ⌄ │
│  G● Google · 2● · 1●                 ⌄    ⋮ │
│  T● Telegram  telegram.org   20 ms        ⋮ │
│  X● X  x.com   64 ms   [Blocked]          ⋮ │
╰──────────────────────────────────────────────╯
```

Add list, Edit order and Settings are in the hero's ☰ drawer; Edit order is also in each list's ⋯
menu. On macOS the app menu has them too (File › New list ⌘N, File › Edit order ⇧⌘O,
Qanary › Settings… ⌘,; a second ⇧⌘O ends ordering), plus View › Refresh now ⌘R for the orb
([ADR-0045](adr/0045-add-list-in-the-hero-and-a-native-app-menu.md),
[ADR-0047](adr/0047-hero-actions-in-a-menu-drawer-and-refresh-in-the-app-menu.md)).

Wider windows put lists side by side, masonry style: as many 360px+ columns as fit (never more
than there are lists), and each list, in order, goes under the shortest column so a short list never
leaves a hole beside a tall one. Height is estimated from the service count, so opening or
collapsing a list never moves cards between columns. The content (hero and lists) is one centered block only as wide as its columns, each at most 480px: a full-screen window
shows the cards centered, not stretched. Edit order always uses one column, and each list keeps its
collapse chevron there, so long lists can be folded to move them. The numbers live in
[`utils/listColumns.ts`](../src/utils/listColumns.ts); App.tsx hands them to the CSS as custom
properties. The header's narrow layout keys off the card's own width (a container query).

When a list is fully down its count becomes **All unreachable**, its name chip tints red with a
slow, faint ring (a Critical list's turns solid red and pulses, shield included), and the rows show **Down**.

## Scales down (widget / tray)

Personality lives in color + the single Canary mark, not in layout, so it survives shrinking:

- **Tray** — shipped ([ADR-0008](adr/0008-tray-icon-runtime-severity-light.md)). The menubar icon
  carries the severity light, rendered at runtime from the same Severity the hero uses, in the orb's
  `--mood-*` colors, with the Offline state (cut-off) too. The orb's icon, Outline or Filled, picked in **Settings →
  Appearance** ([ADR-0044](adr/0044-one-status-icon-setting-for-orb-and-menu-bar.md)); see below.
- **Widget** — still later. Plan: compact Canary + one-line SeverityCopy + a strip of state chips.
