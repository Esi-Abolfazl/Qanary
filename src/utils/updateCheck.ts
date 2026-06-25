import type { UpdatePhase } from "../App";

export interface UpdateState {
  phase: UpdatePhase | null;
  version: string | null;
}

export interface UpdateInfo {
  version: string;
}

/**
 * Pure supersede rule: given the current update UI state and fresh info from the updater,
 * return the next state.
 *
 * - null info → no change (up-to-date, keep whatever phase/version we have)
 * - newer version → reset to "available" (force re-download even if we were ready)
 * - same version → no change (preserves downloading/ready)
 */
export function nextUpdatePhase(
  current: UpdateState,
  info: UpdateInfo | null,
): UpdateState {
  if (!info) return current;
  if (info.version !== current.version) {
    // Newer (or first) version seen: reset so the user re-downloads before installing.
    return { phase: "available", version: info.version };
  }
  // Same version — keep current phase (may be downloading or ready).
  return current;
}
