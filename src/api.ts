// Thin wrappers over the Tauri command bridge + the status event.
// Tauri maps camelCase JS arg keys to the snake_case Rust parameters automatically.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Config, ListKind, Snapshot, WanInfo } from "./types";

export const getSnapshot = () => invoke<Snapshot | null>("get_snapshot");
export const getConfig = () => invoke<Config>("get_config");
export const getWanInfo = () => invoke<WanInfo | null>("get_wan_info");

/** Probe everything immediately and return the fresh snapshot. */
export const refreshNow = () => invoke<Snapshot>("refresh_now");

export const addService = (listId: string, label: string, host: string, port?: number) =>
  invoke<Config>("add_service", { listId, label, host, port: port ?? null });

export const removeService = (listId: string, serviceId: string) =>
  invoke<Config>("remove_service", { listId, serviceId });

export const addList = (name: string, kind: ListKind) =>
  invoke<Config>("add_list", { name, kind });

export const removeList = (listId: string) => invoke<Config>("remove_list", { listId });

export const updateSettings = (probeIntervalSecs?: number, timeoutMs?: number) =>
  invoke<Config>("update_settings", {
    probeIntervalSecs: probeIntervalSecs ?? null,
    timeoutMs: timeoutMs ?? null,
  });

/** Subscribe to live snapshot pushes. Returns a promise of the unlisten fn. */
export const onStatusUpdate = (cb: (s: Snapshot) => void): Promise<UnlistenFn> =>
  listen<Snapshot>("status-update", (event) => cb(event.payload));
