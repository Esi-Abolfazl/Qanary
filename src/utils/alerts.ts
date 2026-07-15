// Build + fire alerts (notification + sound), gated by per-direction Settings.
// Covers three directions:
//   "down"    — critical list went all_down (outage)
//   "up"      — critical list recovered
//   "blocked" — critical list went fully blocked (whole-list TLS interception)
// Shared by the App's batched alert pipeline and the test modal.

import type { Config } from "../types";
import { notify } from "./notify";
import downSfx from "../assets/sounds/down.mp3";
import upSfx from "../assets/sounds/up.mp3";

export type Dir = "down" | "up" | "blocked";

/**
 * Resolve the direction a pending transition should alert as. "blocked" implies
 * all_down, so it supersedes the plain outage alert — but if the user disabled
 * both blocked toggles, fall back to "down" so a fully-blocked critical outage
 * is never silently swallowed.
 */
export function effectiveDir(dir: Dir, config: Config | null): Dir {
  if (dir === "blocked" && !config?.blocked_notify && !config?.blocked_sound) {
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
    void new Audio(dir === "up" ? upSfx : downSfx).play().catch(() => {});
  }
}

/**
 * Fire the cut-off ("you're offline") alert. Reuses the down notify/sound gate and the down
 * sound asset — there's no separate setting for it (see plan §3). Unlike `fireAlert`, this
 * isn't keyed by list names: cut-off is a listless, app-wide event with its own fixed copy, so
 * it bypasses `buildMessage` and the batched `pendingRef` pipeline entirely (App.tsx fires this
 * directly on the false→true edge).
 */
export function fireCutOffAlert(config: Config | null): void {
  if (config?.down_notify) {
    void notify("You're offline", "Can't reach anything — check your connection.");
  }
  if (config?.down_sound) {
    void new Audio(downSfx).play().catch(() => {});
  }
}
