// Build + fire alerts (notification + sound), gated by per-direction Settings.
// Covers three directions:
//   "down"    — critical list went all_down (outage)
//   "up"      — critical list recovered
//   "blocked" — critical list went fully blocked (whole-list TLS interception)
// plus the listless Cut-off alert, which outranks all three.
//
// `fireBatch` is the single owner of alert precedence — Cut-off > blocked > outage — for one
// settled Alert batch. App.tsx only collects edges and decides *when* the round is settled.

import type { Config } from "../types";
import { notify } from "./notify";
import downSfx from "../assets/sounds/down.mp3";
import upSfx from "../assets/sounds/up.mp3";

export type Dir = "down" | "up" | "blocked";

/**
 * Play one alert sound at the configured Notification volume. The single gain path — every
 * `new Audio()` in the app goes through here.
 *
 * `volume` is the stored percent (0..100); `undefined` (config not loaded yet) reads as full.
 * 0 (muted) constructs no Audio at all, so silence costs nothing. `HTMLAudioElement.volume`
 * is linear amplitude, so 50 → 0.5.
 */
export function playSfx(src: string, volume: number | undefined): void {
  const pct = Math.min(100, Math.max(0, volume ?? 100));
  if (pct === 0) return;
  const audio = new Audio(src);
  audio.volume = pct / 100;
  void audio.play().catch(() => {});
}

/** Play the down sound at `volume` — the Settings slider's release preview. */
export function previewSound(volume: number): void {
  playSfx(downSfx, volume);
}

/**
 * Whether a Sound channel can actually be heard: its flag is on **and** the volume is above 0.
 * The single predicate for "audible" — a `*_sound` flag alone is not one, since `notify_volume`
 * is independent of the flags (ADR-0028) and `{sound: true, volume: 0}` is a legal, silent state.
 *
 * Every precedence/fall-back decision reads this, never the raw flag: a channel that can't be
 * perceived must not count as an alert the user received.
 */
export function soundAudible(
  flag: boolean | undefined,
  config: Config | null,
): boolean {
  return !!flag && (config?.notify_volume ?? 100) > 0;
}

/**
 * Resolve the direction a pending transition should alert as. "blocked" implies
 * all_down, so it supersedes the plain outage alert — but if neither blocked channel
 * can reach the user (notify off, and sound off *or* muted), fall back to "down" so a
 * fully-blocked critical outage is never silently swallowed.
 */
export function effectiveDir(dir: Dir, config: Config | null): Dir {
  if (
    dir === "blocked" &&
    !config?.blocked_notify &&
    !soundAudible(config?.blocked_sound, config)
  ) {
    return "down";
  }
  return dir;
}

/** "A" → "A"; "A","B" → "A and B"; "A","B","C" → "A, B and C". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Notification text for a batch of same-direction Transitions.
 * `isAll` = every critical list is now in that direction (full outage / full recovery).
 * For "blocked", `isAll` is unused (blocked lists are named individually).
 */
export function buildMessage(
  dir: Dir,
  names: string[],
  isAll: boolean,
): { title: string; body: string } {
  if (dir === "down") {
    if (isAll) return { title: "Total outage", body: "All critical lists are down." };
    return { title: "Outage", body: `${joinNames(names)} ${names.length > 1 ? "are" : "is"} down.` };
  }
  if (dir === "up") {
    if (isAll) return { title: "Recovered", body: "All critical lists are back." };
    return { title: "Recovered", body: `${joinNames(names)} ${names.length > 1 ? "are" : "is"} back.` };
  }
  // "blocked" — critical list fully blocked (TLS interception / filtering).
  return {
    title: "Blocked",
    body: `${joinNames(names)} ${names.length > 1 ? "appear" : "appears"} blocked.`,
  };
}

/** Fire notification and/or sound for one direction, honouring the per-direction Settings. */
export function fireAlert(
  dir: Dir,
  names: string[],
  isAll: boolean,
  config: Config | null,
): void {
  if (names.length === 0) return;
  let notifOn: boolean | undefined;
  let soundOn: boolean | undefined;
  if (dir === "down") {
    notifOn = config?.down_notify;
    soundOn = config?.down_sound;
  } else if (dir === "up") {
    notifOn = config?.up_notify;
    soundOn = config?.up_sound;
  } else {
    // "blocked" — gated by its own notify + sound flags; reuses the down sound asset.
    notifOn = config?.blocked_notify;
    soundOn = config?.blocked_sound;
  }
  if (notifOn) {
    const { title, body } = buildMessage(dir, names, isAll);
    void notify(title, body);
  }
  if (soundOn) {
    playSfx(dir === "up" ? upSfx : downSfx, config?.notify_volume);
  }
}

/**
 * Fire the cut-off ("you're offline") alert. Reuses the down notify/sound gate and the down
 * sound asset — there's no separate setting for it (see ADR-0024). Unlike `fireAlert`, this
 * isn't keyed by list names: cut-off is a listless, app-wide event with its own fixed copy, so
 * it bypasses `buildMessage`. Called only by `fireBatch`, which decides *whether* cut-off is the
 * rank that speaks for this batch (ADR-0027) — never fired inline off a snapshot edge.
 */
export function fireCutOffAlert(config: Config | null): void {
  if (config?.down_notify) {
    void notify("You're offline", "Can't reach anything — check your connection.");
  }
  if (config?.down_sound) {
    playSfx(downSfx, config?.notify_volume);
  }
}

/** One batch entry: a pending List Transition / fully-blocked crossing. */
export interface BatchEntry {
  name: string;
  dir: Dir;
}

/** Settled-round state the precedence rule needs beyond the entries themselves. */
export interface BatchContext {
  /** Cut off holds in the settled snapshot. */
  cutOff: boolean;
  /** Cut off crossed false→true somewhere inside this batch. */
  cutOffEdge: boolean;
  /** Every critical list is `all_down` in the settled snapshot (total outage copy). */
  allDown: boolean;
  /** No critical list is `all_down` in the settled snapshot (full recovery copy). */
  allUp: boolean;
}

/**
 * Fire the one alert a settled Alert batch is owed, at the highest severity that holds:
 * **Cut-off > blocked > outage**. The single place that ranking lives.
 *
 * While Cut off holds, only the Cut-off alert speaks — every List is off *because* of it, so
 * naming Lists is redundant noise. It speaks only on the `false→true` edge (`cutOffEdge`): once
 * announced, a sticky Cut off stays silent, and an edge that has already resolved by settle time
 * (`cutOff` false) never announces an outage the user did not have.
 *
 * The channel check mirrors `effectiveDir`'s fall-through, for the same reason: a rank the user
 * muted cannot outrank anything. With the down banner off and the down sound off *or* muted by
 * `notify_volume: 0`, the Cut-off alert is imperceptible, so it must not swallow a `blocked`
 * alert the user *did* opt into — hence `soundAudible`, not the raw flag.
 *
 * Returns `suppressed` — true when entries lost to Cut off. The caller keeps those entries
 * pending instead of dropping them, so an outage that outlives the Cut off is still announced
 * once Cut off clears (there would be no fresh Transition edge to rediscover it).
 */
export function fireBatch(
  entries: BatchEntry[],
  ctx: BatchContext,
  config: Config | null,
): { suppressed: boolean } {
  const downNames: string[] = [];
  const upNames: string[] = [];
  const blockedNames: string[] = [];
  for (const { name, dir } of entries) {
    const eff = effectiveDir(dir, config);
    if (eff === "down") downNames.push(name);
    else if (eff === "up") upNames.push(name);
    else blockedNames.push(name); // "blocked"
  }

  if (ctx.cutOff && (config?.down_notify || soundAudible(config?.down_sound, config))) {
    if (ctx.cutOffEdge) fireCutOffAlert(config);
    return { suppressed: entries.length > 0 };
  }

  fireAlert("down", downNames, ctx.allDown, config);
  fireAlert("up", upNames, ctx.allUp, config);
  fireAlert("blocked", blockedNames, false, config);
  return { suppressed: false };
}
