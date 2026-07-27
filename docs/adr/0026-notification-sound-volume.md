# 0026. One global `notify_volume` (0–100, step 25), with the zero rule enforced in Rust

- **Status:** accepted
- **Date:** 2026-07-27
- **Deciders:** Esi

## Context

Every alert sound Qanary plays came out at full amplitude, with no way to turn it down. There are
only two playback sites in the whole app — both in `src/utils/alerts.ts`, one in `fireAlert` and
one in `fireCutOffAlert` — so a single output level covers all present and future alert audio
(`down.mp3` and `up.mp3`; the blocked and cut-off alerts reuse the down asset).

The complication is that three per-direction **Sound** toggles already exist (`down_sound`,
`up_sound`, `blocked_sound` — ADR-0007 and ADR-0023). "Volume 0" and "all three Sound toggles off"
describe the same audible outcome, so the two controls overlap and need one defined relationship
rather than two independent mute mechanisms.

That relationship is not cosmetic. `effectiveDir` falls back from `"blocked"` to `"down"` only when
*both* blocked toggles are off — the guarantee ADR-0023 relies on so a fully-blocked critical
outage is never silently swallowed. A config in the state `{notify_volume: 0, blocked_sound: true}`
— reachable by hand-editing `config.json` or importing a file — would defeat that: `effectiveDir`
sees `blocked_sound` set and keeps the `"blocked"` direction, while the volume gate suppresses the
sound and the notification never happens. The alert disappears with no user-visible cause.

Attenuating the native OS banner is not in play: `sendNotification` passes no `sound`, so the
banners carry no app-controlled audio.

## Decision

Add `notify_volume: u8` to the persisted `Config` — a percent in `0..=100` snapped to steps of 25,
default 100, `0` meaning off. It is an additive `#[serde(default)]` field, so `CURRENT_SCHEMA` is
unchanged and there is no `migrate` arm.

One backend helper, `store::normalize_alerts`, is the **only** implementation of the rule. It snaps
the volume to a legal step (which also clamps a hand-edited `101..=255`) and, when the volume is 0,
clears all three `*_sound` flags. It runs on load, on import, and as the last statement of every
`update_settings` write — last, so a single payload carrying `{notify_volume: 0, down_sound: true}`
cannot slip through between the field assignments and the check. The contradictory pair is
therefore unrepresentable in live state, which is what keeps `effectiveDir`'s inputs honest.

The coupling is deliberately one-way: volume 0 clears the Sound flags, but a Sound flag never
raises a stored volume. All flags off with a stored 100 is a legal, harmless state — the flags
already mute it — and it preserves the level the user chose.

At playback, volume is a pure output gate: a single `playSfx(src, volume)` helper is the app's only
`new Audio()` call site. It returns early at 0 (constructing no audio element at all) and otherwise
sets `HTMLAudioElement.volume` to `pct / 100`. `effectiveDir` is untouched.

Settings mirrors the rule for immediate feedback — a range slider inside the "Critical-list alerts"
card, inert while every Sound box is off, dropping to 0 when the last box is unchecked, returning
to an audible level when the first is checked, and unchecking all three when dragged to 0. A single
`commitSound` function is the only writer of those four pieces of state, and it takes the *next*
values as arguments rather than reading them back, so the slider and the checkboxes cannot desync.
The mirror carries a parity test (`src/App.test.tsx`) asserting it agrees with the backend rule,
including that the saved payload pairs `notifyVolume: 0` with all three sound flags false.

The `*_notify` toggles are untouched, so "banners, no audio" stays reachable at volume 0.

## Alternatives considered

- **Keep the rule in the UI only** — rejected. It leaves the exact silent-swallow state reachable
  through a hand-edited or imported config, which is the failure ADR-0023 exists to prevent.
- **Fold `notify_volume === 0` into `effectiveDir`'s condition** — rejected. It puts the same rule
  in a second place instead of keeping the underlying data consistent; the two copies would then
  need to be kept in agreement forever.
- **Replace the three Sound toggles with the volume alone** — rejected. It loses per-direction
  control (silent recoveries, audible outages) and forces a config migration.
- **Snap in the UI, clamp only in Rust** — rejected. An imported off-step value would persist and
  play at a level the UI can't represent.
- **Per-direction volumes** — rejected as scope: the requirement is one level for all alert sounds.

## Consequences

## **Positive:**

- One gain path covers every current and future alert sound; `0` means off with no extra flag.
- No schema migration. Old configs load with volume 100, and an older binary reads a config
  containing `notify_volume` fine (serde tolerates the unknown field).
- The silent-swallow state is unrepresentable in live state on all three entry paths (load, import,
  write), not merely discouraged by the UI.
- The six alert checkboxes gained `aria-label`s, which they previously lacked.

## **Negative / accepted trade-offs:**

- Setting the slider to 0 clears three independently-configured toggles with no undo. It is visible
  (the boxes uncheck in place) and hinted in the UI, but the previous values are gone — and
  reverting this change does not restore flags a normalized config already cleared.
- The UI duplicates the rule for responsiveness, so it carries a parity test as the price of the
  duplication.
- `updateSettings` reaches 11 positional arguments (10 on the `Settings` `onSave` prop). Appending
  is safe today because the Rust command takes named arguments — a mismatch surfaces as a null, not
  a silent swap — but a future mid-list insertion would shift arguments quietly.
- A hand-edited `notify_volume: 300` fails the `u8` parse and resets the whole config to defaults.
  Pre-existing repo-wide behaviour shared by `timeout_ms` and every other numeric field, not
  introduced here.

## **Follow-ups:**

- Retire the positional-argument debt by moving `updateSettings` / `onSave` to an options object.
- If numeric out-of-range values in a hand-edited config prove to be a real support issue, make
  `load` tolerate a per-field parse failure instead of falling back to the whole default config.
