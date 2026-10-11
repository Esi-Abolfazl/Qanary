# 0043. The orb keeps the pre-Glass status colors; offline is a gray Wi-Fi off

- **Status:** accepted (amends the orb colors of ADR-0032, the offline icon of ADR-0033 / ADR-0038, where ADR-0038's Pulse Alarm loop starts, and ADR-0034's tray palette and Offline picture; amended: Offline is a Wi-Fi with a "!", menu-bar rings are dotted)
- **Date:** 2026-10-02
- **Deciders:** Esi-Abolfazl

## Context

The Glass redesign brightened the state palette and gave the orb five moods: v0.6.5's four
(ok, warn, alarm, checking) plus offline, in a new crimson, with checking in gray. The owner
wants the orb's colors to stay what users already know.

## Decision

- The orb's `--sev` reads `--mood-*` tokens (`tokens.css`) with the v0.6.5 values: warn `#f2792b`,
  alarm `#e03131`. Green and busy yellow are a little darker than v0.6.5's (`#1fb872`, `#ffcc00`):
  ok `#1a9c61`, busy (checking) `#e6b400`, so they stand out more, above all on a light menu bar,
  and busy no longer equals the brand yellow.
- Offline, new since v0.6.5, takes the gray the redesign gave checking (`--state-checking`).
- Every other mood keeps its rings/pulse icon and motion. Idle stays gray.
- Offline draws one icon in every style (`WIFI_OFF` in `orbIcons.tsx`). *Amended:* a bold Wi-Fi
  whose first dot is the dot of a "!" (a slash crossed the dashes and read as noise at 18 px). On
  the orb the three arcs switch on one after another, hold, then go dark; the "!" stays still and
  casts a soft shadow out of the arcs. On the menu bar the same picture sits inside Pulse's frame,
  beside Rings' outer ring, or cut out of the filled plate, with solid round-ended arcs and a
  hard-edged gap around the "!". "!" is also Heads up's mark; the gray and the Wi-Fi tell them apart.
- *Amended:* menu-bar Alarm and heads-up rings are **dotted**, not dashed (a dashed ring reads as a
  ragged edge at 18 px): round-ended dashes shorter than the stroke is wide, with periods that
  divide each circumference evenly. Pulse's Alarm dead line is four dots, two each side of the X;
  the filled Rings Alarm keeps only the inner two rings, as holes in the plate. On the orb, a soft
  shadow around Pulse Alarm's X fades the dashed line out near it.
- Offline disables the orb: no network on this machine is not something a refresh can fix, and
  the scheduled checks pick the connection up on their own. Its tooltip says so.
- Pulse Alarm's 20 s loop is entered 2.5 s in, on the dead line: arriving in Alarm (often right
  after a refresh) showed ~2 s of a calm-looking red heartbeat first, which read as "fine". The
  heartbeat and its drain still replay near the end of every loop.
- The menu-bar icon shows what the orb shows: the same `--mood-*` colors (Rust constants in
  `tray.rs`, checked against `tokens.css` by a test), the same Wi-Fi off for Offline in all four
  looks (bare and filled), and its tray-menu list dots follow, as they always matched the icon.
- The `--state-*` palette for rows and service dots is untouched.

## Alternatives considered

- **Revert the `--state-*` tokens** — would also recolor rows and the tray, which was not asked.
- **Keep offline crimson** — two reds side by side; gray reads "nothing is reachable".
- **A stock Wi-Fi-off glyph** — reads fine alone but not as one of the orb's states.
- **Keep refresh clickable offline** — it would start a round that can only fail.
- **Drop the heartbeat from Pulse Alarm** — fixes the arrival too, but loses the PR's drain story.

## Consequences

**Positive:** the main status light looks as it did before the redesign.

**Negative / accepted trade-offs:** the orb and the rows use slightly different greens, oranges
and reds; busy yellow is still near the brand yellow, though no longer equal to it.
The Pulse look loses its frame when offline, as the orb's Pulse loses its line: Offline is one
picture everywhere. The Settings picker (`trayIcons.tsx`) still redraws the Rust shapes by hand;
only the colors have a parity test, the geometry does not.

**Follow-ups:** a geometry parity check between `tray.rs` and `trayIcons.tsx` (TODO.md).
