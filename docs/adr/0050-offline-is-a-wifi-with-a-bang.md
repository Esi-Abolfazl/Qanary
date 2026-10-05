# 0050. Offline is a Wi-Fi with a "!"; alarm and heads-up rings are dotted

- **Status:** accepted
- **Date:** 2026-10-03
- **Deciders:** Sajjad (design), Esi-Abolfazl (to confirm)

## Context

The Offline icon was a Wi-Fi struck through by a slash, in a thin dashed stroke on the menu bar
and a bold one on the orb. The dashes did not fit the arcs (uneven gaps), the slash ran through
them, and the orb and menu bar did not match. Alarm used dashed rings and a dashed dead line that
also read as noisy at 18 px. The hover refresh arrow's head did not point along its arc.

## Decision

- **Offline** is a bold Wi-Fi whose first dot is the dot of a "!". Orb: the three arcs switch on one
  after another, hold, then all go dark; the "!" stays still and casts a soft (blurred) shadow out
  of the arcs. Menu bar: the same picture, scaled to sit inside Pulse's rounded-square frame, beside
  Rings' outer ring, or cut out of the filled plate; the arcs are solid with round ends and the
  "!" casts a hard-edged gap. One picture for both Rings and Pulse.
- **Alarm and heads-up rings on the menu bar are dotted**: dashes shorter than the stroke is wide,
  with round ends, with periods that divide each circumference evenly. Pulse's Alarm dead line is
  four dots, two each side of the X. (The filled Rings Alarm has the inner two dotted rings only, as holes in the plate.)
- **Pulse Alarm on the orb**: a soft shadow around the X fades the dashed line out near it.
- **The orb's hover refresh arrow** is bolder (2.2) and its arrowhead points along the arc.
- The menu-bar drawing in Rust gets round-ended dashes, dots with opacity, and round-ended solid arcs
  with a gap (`tray.rs`); the Settings picker draws the same shapes as SVG (`trayIcons.tsx`).

## Alternatives considered

- **Keep the slash** — it crossed the dashes and read as noise at 18 px; the "!" says "something is
  wrong with the connection" without a line through the picture.
- **Fix the dash lengths so they fit each arc** (tried first) — tidier, but a dashed ring still reads
  as a ragged edge at this size; dots do not.

## Consequences

**Positive:**
- The orb and the menu bar say Offline the same way; the icons stay legible at 18 px.

**Negative / accepted trade-offs:**
- "!" is also Heads up's mark (orange, in the Rings look). Colour (gray) and the Wi-Fi tell them apart.
- The tray's Rust drawing and the Settings SVG are still two hand-kept copies (see the TODO on a
  parity check).

**Follow-ups:**
- Confirm with the owner.
