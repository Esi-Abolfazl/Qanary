# 0044. One status-icon setting for the orb and the menu bar

- **Status:** accepted (supersedes ADR-0033's per-device `localStorage` choice and ADR-0034's four-look setting; amended: the menu bar may keep its own picture)
- **Date:** 2026-10-03
- **Deciders:** Esi-Abolfazl

## Context

The Glass PR added two pickers for the same picture. **Settings → Appearance → Status icon**
(Rings | Pulse, ADR-0033) set the in-app orb, saved per device in `localStorage`. **Settings →
System → Menu bar icon** (four looks, ADR-0034) set the tray, saved in the config. You could
pick Rings in the app and Pulse in the menu bar. The two big tile grids also took a lot of space
for two small choices. The owner asked for one compact picker: the icon in one row, and the
menu bar's outline or filled look in another.

## Decision

- One choice, `status_icon` (`"rings" | "pulse"`), sets both the orb and the menu-bar icon. A
  second choice, `tray_filled` (bool), applies to the menu bar only: the icon drawn bare
  (Outline) or cut out of a filled rounded square (Filled). Default: Pulse, Filled (also for
  configs saved before these settings existed).
- *Amended:* a third choice, `tray_shape` (`"same" | "rings" | "pulse"`), lets the menu bar keep
  its own picture. `same` (the default, and what older configs load as) follows `status_icon`, so
  nothing changes for anyone who does not touch it. `Config::tray_look()` resolves picture and
  fill in one place, and every call that draws the tray uses it. Two additive fields, so no
  migration (one `tray_shape` × `tray_filled` enum would have needed one).
- Both settings live in the config (`models.rs`), because the backend draws the tray. The old
  `tray_style` key and the `qanary-orb-style` `localStorage` key are gone. Both shipped only in
  this unreleased PR, so nothing is migrated.
- The picker lives in **Settings → Appearance**: *Status icon* (Rings | Pulse, each with a small
  live orb, and a **"?"** popover showing the five states of the chosen icon), *Menu bar* (a custom
  dropdown: **Same as app**, **Pulse**, **Rings**, each drawn with its five states) and a **Filled
  menubar icons** switch. Picking a picture never changes the switch, and the reverse. The System
  card no longer has an icon picker.
- The icon applies on **Save**, like the rest of the form, and Cancel discards it. Theme, in the
  same card, still applies at once: it is per device and has no backend.
- The tray keeps its four drawings. `tray::TrayStyle::of(icon, filled)` maps the two settings onto
  them, so `tray.rs` draws exactly what it drew before.

## Alternatives considered

- **Keep two independent pickers, just smaller.** Still allows an orb and a menu bar that
  disagree, which the owner did not want at first. The amendment allows it, but only on request:
  the default still follows the orb.
- **A second segmented row (Rings | Pulse) for the menu bar.** Adds a row to every user's
  Settings for something few change; the dropdown keeps one row and the "Same as app" default.
- **Keep the orb choice in `localStorage` and copy it to the config.** Two stores for one
  setting, and they can drift.
- **Apply the icon immediately, as Theme does.** Saving at once re-seeds the Settings form from
  the new config and would wipe other edits still pending in it.

## Consequences

## **Positive:**

- One setting for one picture by default: the orb and the menu bar match unless the user asks otherwise.
- The Appearance card gets two short rows instead of two tile grids.

## **Negative / accepted trade-offs:**

- The orb no longer switches the moment you click. You see it after Save.
- The orb's style is now one per config, no longer one per device. Export/import carries it.
- The menu-bar dropdown is custom (no native `<select>`), because each option shows five icons.

## **Follow-ups:**

- None new. The tray geometry parity check from ADR-0043 still stands (TODO.md).
