# 0028. `notify_volume` is a level, not a mute switch — audibility moves into `soundAudible`

- **Status:** accepted
- **Date:** 2026-07-29
- **Deciders:** Esi

## Context

ADR-0026 coupled `notify_volume` to the three `*_sound` flags: dragging the volume to 0 cleared
`down_sound` / `up_sound` / `blocked_sound`, and with every Sound box off the slider read 0 and went
inert. The coupling existed to protect one specific guarantee from ADR-0023 — `effectiveDir` keeps
the `"blocked"` direction whenever either blocked channel is opted in, so the pair
`{notify_volume: 0, blocked_notify: false, blocked_sound: true}` would keep that direction while
producing neither a banner nor a sound: a fully-blocked critical outage silently swallowed. Making
that pair unrepresentable in stored state prevented it.

The cost landed on the user. Volume 0 destroyed configuration — three independently-chosen toggles
cleared with no undo, and turning the level back up did not bring them back. The slider also could
not express "these directions alert, just silently right now", because 0 and "no sound directions at
all" were forced to be the same state. The user asked for the plain meaning: 0 mutes the audio, the
checkboxes stay as set, and only unchecking every Sound box makes the level inapplicable.

The guarantee itself is not negotiable, so the question is *where* it belongs. The coupling put it in
the data (make the state illegal); the alternative is to put it in the predicate that reads the data
(never mistake a muted channel for an audible one). The real defect in the old design is that
`effectiveDir` and `fireBatch` read a raw `*_sound` flag as if it meant "the user will perceive
this", which was only true because normalization guaranteed it elsewhere.

## Decision

`notify_volume` and the three `*_sound` flags are **independent**. The flags choose which directions
make a sound; the volume chooses how loud, with `0` meaning muted. `{notify_volume: 0,
blocked_sound: true}` is a legal, persisted state.

Audibility becomes one named predicate in `src/utils/alerts.ts`:

```ts
soundAudible(flag, config) === !!flag && (config?.notify_volume ?? 100) > 0
```

It is the only definition of "this Sound channel can reach the user", and it is what the two
precedence decisions consult instead of the raw flag:

- `effectiveDir` falls back from `"blocked"` to `"down"` when the blocked banner is off **and** the
  blocked sound is off *or* muted.
- `fireBatch`'s cut-off gate counts the cut-off rank as speakable only when the down banner is on or
  the down sound is audible, so a muted cut-off cannot outrank an opted-in blocked alert.

`store::normalize_alerts` keeps only the clamp to `0..=100` (`models::clamp_volume`, renamed from
`snap_volume` now that step 1 leaves nothing to snap) and no longer touches the flags. Settings drops
`commitSound` entirely: the checkboxes and the slider are plain independent state, the slider is
disabled only while no direction makes a sound, and the readout shows "Muted" at 0. With the mirror
gone, so is the mirror-parity problem ADR-0026 introduced.

## Alternatives considered

- **Keep the ADR-0026 coupling** — rejected. It buys the guarantee by deleting user configuration
  and by making one legitimate state ("configured but currently silent") unexpressible.
- **Decouple in the UI only, keep the backend clearing flags at volume 0** — rejected. The frontend
  would show state the next load silently rewrites.
- **Decouple and leave `effectiveDir` reading the raw flag** — rejected outright: this is exactly the
  ADR-0023 silent swallow, reintroduced.
- **Inline `notify_volume > 0` at both call sites instead of a named predicate** — rejected. Two
  copies of one rule, and the next reader of a `*_sound` flag would not know to add a third.
- **Keep the slider enabled always (drop the `anySound` gate too)** — rejected. With no direction
  making a sound there is nothing for a level to apply to; the inert slider plus its note is honest
  about that, and it costs no configuration.

## Consequences

## **Positive:**

- Volume 0 is a mute, not a reset: the user's three direction choices survive it, and raising the
  level restores exactly what they had.
- One predicate owns audibility, so any future reader of a Sound flag has a correct thing to call.
- The ADR-0023 guarantee now holds by construction on every path — including a hand-edited or
  imported `{volume: 0, sound: true}` config, which no longer needs rewriting to be safe.
- Settings loses `commitSound` and the `|| 100` seeding repair; the UI no longer duplicates a
  backend rule, so ADR-0026's parity-test obligation disappears.

## **Negative / accepted trade-offs:**

- Configs written by 0.6.x may have had their `*_sound` flags cleared by the old rule. Reverting the
  clearing does not restore them — those users re-check the boxes once.
- "Sound on outage checked, volume 0" is a genuinely silent configuration the user can sit in. It is
  visible (the readout says "Muted") but it is now reachable, where before it was impossible.
- Two call sites must remember to use `soundAudible` rather than the raw flag. It is a predicate, not
  an enforced invariant — a future third reader could forget. The specs in `alerts.test.ts` pin both
  current sites.

## **Follow-ups:**

- If a third audibility reader appears, consider passing an already-resolved "audible channels"
  object into `fireBatch` so the raw flags are not in scope at the decision sites at all.
