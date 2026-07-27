// Detect List transitions across two consecutive snapshots.
//
// criticalTransitions: critical list's `all_down` flag flips (outage / recovery).
// blockedTransitions:  critical list enters fully-blocked state (whole-list
//                      TLS interception) — a more specific signal than the plain
//                      all_down outage.
//
// These functions only *detect* edges. Which edge gets to speak is ranked in one
// place — `fireBatch` in ./alerts: cut-off > blocked > outage (ADR-0027).
//
// In both cases, lists absent from either snapshot are skipped to avoid false
// positives on first load or after a list is added/removed.

import type { ListStatus } from "../types";
import type { Dir } from "./alerts";

export interface Transition {
  /** List id */
  id: string;
  /** List display name */
  name: string;
  /** "down" = outage, "up" = recovery, "blocked" = critical list fully blocked */
  dir: Dir;
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

/**
 * True when every service in a list has at least one endpoint and every endpoint
 * is blocked — the fingerprint of whole-list TLS interception / filtering.
 * A single non-blocked endpoint (up, down, checking, reachable) disqualifies.
 */
function isFullyBlocked(l: ListStatus): boolean {
  return (
    l.services.length > 0 &&
    l.services.every(
      (s) =>
        s.endpoints.length > 0 &&
        s.endpoints.every((e) => e.state === "blocked"),
    )
  );
}

/**
 * Compare two snapshot list arrays and return one "blocked" Transition per
 * **critical** list that just entered the fully-blocked state. Lists absent
 * from either snapshot are skipped (avoids first-load false fires). Recovery
 * (fully-blocked → cleared) produces no event — the existing "up" recovery
 * alert covers it (fully-blocked implies all_down).
 */
export function blockedTransitions(
  prev: ListStatus[],
  next: ListStatus[],
): Transition[] {
  const prevMap = new Map(prev.map((l) => [l.id, l]));
  const result: Transition[] = [];
  for (const n of next) {
    if (!n.critical) continue; // non-critical lists never alert
    const p = prevMap.get(n.id);
    if (!p) continue; // no baseline — skip (avoids first-load false fire)
    if (!isFullyBlocked(p) && isFullyBlocked(n)) {
      result.push({ id: n.id, name: n.name, dir: "blocked" });
    }
  }
  return result;
}
