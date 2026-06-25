import type { ServiceDelta, Snapshot } from "../types";

/**
 * Merge a per-Service Status delta into a Snapshot, returning a new Snapshot (input untouched).
 *
 * Replaces the matching service inside `d.list_id`, then sets that list's `all_down` and the
 * snapshot's `overall` from the delta — the backend already recomputed both. An unknown list or
 * service id is a no-op: returns the input snapshot unchanged (e.g. a delta racing a config reset).
 */
export function mergeDelta(snap: Snapshot, d: ServiceDelta): Snapshot {
  const listIdx = snap.lists.findIndex((l) => l.id === d.list_id);
  if (listIdx === -1) return snap;

  const list = snap.lists[listIdx];
  const svcIdx = list.services.findIndex((s) => s.id === d.service.id);
  if (svcIdx === -1) return snap;

  const services = list.services.slice();
  services[svcIdx] = d.service;
  const newList = { ...list, services, all_down: d.list_all_down };
  const lists = snap.lists.slice();
  lists[listIdx] = newList;

  return { ...snap, lists, overall: d.overall };
}
