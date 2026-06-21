// Build + fire critical-list alerts (notification + sound), gated by per-direction
// Settings. Shared by the App's batched alert pipeline and the test modal.

import type { Config } from "../types";
import { notify } from "./notify";
import downSfx from "../assets/sounds/down.mp3";
import upSfx from "../assets/sounds/up.mp3";

export type Dir = "down" | "up";

/** "A" → "A"; "A","B" → "A and B"; "A","B","C" → "A, B and C". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Notification text for a batch of same-direction Transitions.
 * `isAll` = every critical list is now in that direction (full outage / full recovery).
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
  if (isAll) return { title: "Recovered", body: "All critical lists are back." };
  return { title: "Recovered", body: `${joinNames(names)} ${names.length > 1 ? "are" : "is"} back.` };
}

/** Fire notification and/or sound for one direction, honouring the per-direction Settings. */
export function fireAlert(
  dir: Dir,
  names: string[],
  isAll: boolean,
  config: Config | null,
): void {
  if (names.length === 0) return;
  const notifOn = dir === "down" ? config?.down_notify : config?.up_notify;
  const soundOn = dir === "down" ? config?.down_sound : config?.up_sound;
  if (notifOn) {
    const { title, body } = buildMessage(dir, names, isAll);
    void notify(title, body);
  }
  if (soundOn) {
    void new Audio(dir === "down" ? downSfx : upSfx).play().catch(() => {});
  }
}
