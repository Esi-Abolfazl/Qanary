# 0049. The menu-bar icon can differ from the orb

- **Status:** accepted (refines ADR-0044: the menu bar no longer always follows the orb)
- **Date:** 2026-10-03
- **Deciders:** Esi-Abolfazl (to confirm)

## Context

ADR-0044 made one setting, `status_icon` (Rings | Pulse), draw both the in-app orb and the menu-bar
icon, and added `tray_filled` for the menu bar's Outline or Filled look. That kept Settings small,
but you could not have Pulse in the app and Rings in the menu bar (or the reverse). The old
four-tile picker allowed it and was too busy. Users also had no way to see what the icons look like
without choosing them and watching.

## Decision

- A new setting, `tray_shape` (`"same" | "rings" | "pulse"`), picks the menu bar's picture. `same`
  (the default, and what older configs load as) follows `status_icon`, so nothing changes for
  anyone who does not touch it. `rings` / `pulse` keep the menu bar's own picture.
  `Config::tray_look()` resolves picture and fill in one place, and every call that draws the tray
  uses it.
- **Settings → Appearance → Menu bar** is a dropdown of three pictures plus a **Filled menubar icons** switch under it. The
  closed dropdown shows the five states of the current look. Opened, it lists one line each: **Same
  as app** (follows the orb's picture), **Pulse**, **Rings**, each drawn the way the switch
  currently says. The switch (`tray_filled`) is a row like the alert switches below; picking a picture never
  changes it, and it never changes the picture. (An earlier cut had five options, with the filled
  looks listed as their own rows; two controls are simpler than five rows.)
- A **"?"** beside the "Status icon" label opens a popover with the orb's five states (All clear, Heads
  up, Alarm, Offline, Checking) for the chosen status icon, so a user can see the icons without
  choosing. Nothing is shown until asked, so the card stays small.

## Alternatives considered

- **Bring back the four-tile grid** — too busy; the owner rejected it (ADR-0044).
- **A second segmented row (Rings | Pulse) for the menu bar** — adds a row to every user's Settings
  for something few change; the dropdown keeps one row and the "Same as app" default.
- **Make `tray_filled` part of one enum with `tray_shape`** — cleaner on paper, but it needs a
  migration of existing configs. Two additive fields need none.

## Consequences

**Positive:**
- Pulse in the app with Rings in the menu bar (or the reverse) is possible, with the same compact card.
- Existing configs behave as before (`tray_shape` loads as `same`).
- Users can preview the states before choosing.

**Negative / accepted trade-offs:**
- The dropdown is custom (no native `<select>`), because each option shows five icons.
- The switch is its own row, so the Appearance card is one row taller than with a button beside the
  dropdown; it keeps the layout from shifting when toggled.

**Follow-ups:**
- Confirm with the owner that decoupling the menu bar is wanted.
- The tray icon's offline Wi-Fi (Rust) is still the thin one; the orb's is bold since the
  offline-icon change. Draw the bold one in `tray.rs` if the owner wants them to match.
