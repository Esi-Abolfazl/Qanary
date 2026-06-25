// Thin wrappers over the Tauri command bridge + the status event.
// Tauri maps camelCase JS arg keys to the snake_case Rust parameters automatically.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Config, ServiceDelta, ServiceDraft, Snapshot } from "./types";

export const getSnapshot = () => invoke<Snapshot | null>("get_snapshot");
export const getConfig = () => invoke<Config>("get_config");

/** Probe everything immediately and return the fresh snapshot. */
export const refreshNow = () => invoke<Snapshot>("refresh_now");

/** Add one or more services (each with endpoints) to a list. */
export const addServices = (listId: string, services: ServiceDraft[]) =>
  invoke<Config>("add_services", { listId, services });

/** Replace a service's label and endpoints (wholesale edit). */
export const updateService = (
  listId: string,
  serviceId: string,
  label: string,
  endpoints: { host: string; port?: number }[],
) => invoke<Config>("update_service", { listId, serviceId, label, endpoints });

export const removeService = (listId: string, serviceId: string) =>
  invoke<Config>("remove_service", { listId, serviceId });

export const addList = (name: string, icon: string, critical: boolean) =>
  invoke<Config>("add_list", { name, icon, critical });

export const updateList = (listId: string, name: string, icon: string, critical: boolean) =>
  invoke<Config>("update_list", { listId, name, icon, critical });

export const removeList = (listId: string) => invoke<Config>("remove_list", { listId });

export const resetConfig = () => invoke<Config>("reset_config");

export const setListCollapsed = (listId: string, collapsed: boolean) =>
  invoke<void>("set_list_collapsed", { listId, collapsed });

/** Reorder top-level lists by id. Save-only — no re-probe. */
export const reorderLists = (orderedIds: string[]) =>
  invoke<Config>("reorder_lists", { orderedIds });

/** Reorder services within a list by id. Save-only — no re-probe. */
export const reorderServices = (listId: string, orderedIds: string[]) =>
  invoke<Config>("reorder_services", { listId, orderedIds });

export const updateSettings = (
  probeIntervalSecs?: number,
  timeoutMs?: number,
  ipProviders?: string[],
  downNotify?: boolean,
  downSound?: boolean,
  upNotify?: boolean,
  upSound?: boolean,
) =>
  invoke<Config>("update_settings", {
    probeIntervalSecs: probeIntervalSecs ?? null,
    timeoutMs: timeoutMs ?? null,
    ipProviders: ipProviders ?? null,
    downNotify: downNotify ?? null,
    downSound: downSound ?? null,
    upNotify: upNotify ?? null,
    upSound: upSound ?? null,
  });

/** Toggle the macOS Dock icon. Persists + applies live; no-op on non-macOS. */
export const setHideDock = (enabled: boolean) =>
  invoke<Config>("set_hide_dock", { enabled });

/** A single version's release notes. */
export interface ChangelogEntry {
  version: string;
  body: string;
  /** True for the trailing "your previous version" anchor card (only from takeNewChangelog). */
  isPrevious?: boolean;
}

/**
 * On startup: returns all CHANGELOG entries released since the user last saw notes
 * (newest-first). Empty array when already up-to-date or on a fresh install (quiet).
 * Records running version as last-seen so it fires only once per version.
 */
export const takeNewChangelog = () =>
  invoke<ChangelogEntry[]>("take_new_changelog");

/**
 * Returns all CHANGELOG entries (newest-first) for the manual "Release notes"
 * button in Settings. Does not touch last_changelog_version.
 */
export const getChangelog = () =>
  invoke<ChangelogEntry[]>("get_changelog");

/** Subscribe to live snapshot pushes. Returns a promise of the unlisten fn. */
export const onStatusUpdate = (cb: (s: Snapshot) => void): Promise<UnlistenFn> =>
  listen<Snapshot>("status-update", (event) => cb(event.payload));

/** Subscribe to per-Service Status deltas. Returns a promise of the unlisten fn. */
export const onServiceUpdate = (cb: (d: ServiceDelta) => void): Promise<UnlistenFn> =>
  listen<ServiceDelta>("service-update", (event) => cb(event.payload));
