// Detect critical-List Transitions across two consecutive snapshots.
// A Transition is fired when a critical list's `all_down` flag flips:
//   false → true  = outage ("down")
//   true  → false = recovery ("up")
// Non-critical lists and unchanged lists produce no events.

import type { ListStatus } from "../types";

export interface Transition {
  /** List id */
  id: string;
  /** List display name */
  name: string;
  /** "down" = outage, "up" = recovery */
  dir: "down" | "up";
}

/**
 * Compare two snapshot list arrays and return one Transition per critical list
 * whose `all_down` state changed. Lists absent from either snapshot are skipped
 * (avoids false positives on first load or after a list is added/removed).
 */
export function criticalTransitions(
  prev: ListStatus[],
  next: ListStatus[],
): Transition[] {
  const prevMap = new Map(prev.map((l) => [l.id, l]));
  const result: Transition[] = [];
  for (const n of next) {
    if (!n.critical) continue;
    const p = prevMap.get(n.id);
    if (!p) continue; // no baseline — skip
    if (p.all_down === n.all_down) continue; // no change
    result.push({ id: n.id, name: n.name, dir: n.all_down ? "down" : "up" });
  }
  return result;
}
