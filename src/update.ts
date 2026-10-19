import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateInfo {
  version: string;
  body: string | null;
}

let pending: Update | null = null;
// Set once a download starts. From then on `pending` is the handle being (or already) written to
// disk, and `installAndRelaunch` must install exactly that one — a newer release found by a later
// check waits for the next launch (audit A12).
let committed = false;

/** Returns update info if a newer version is available, null otherwise. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const update = await check();
    if (!update?.available) return null;
    if (!committed && pending?.version !== update.version) pending = update;
    return { version: update.version, body: update.body ?? null };
  } catch (e) {
    if (String(e).toLowerCase().includes("your app is up to date")) return null;
    throw e;
  }
}

/** Downloads the update. Calls onProgress with 0-100. */
export async function downloadUpdate(
  onProgress: (pct: number) => void,
): Promise<void> {
  if (!pending) throw new Error("no pending update");
  let total = 0;
  let received = 0;
  committed = true;
  try {
    await pending.download((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? 0;
        onProgress(0);
      } else if (event.event === "Progress") {
        received += event.data.chunkLength;
        onProgress(total > 0 ? Math.min(99, Math.round((received / total) * 100)) : 0);
      } else if (event.event === "Finished") {
        onProgress(100);
      }
    });
  } catch (e) {
    committed = false; // nothing usable on disk — a newer release may replace it again
    throw e;
  }
}

// The handle already installed on disk (auto-update): relaunching it is all that's left.
let installed: Update | null = null;

/**
 * Installs the downloaded update without relaunching: it runs from the next launch. On macOS the
 * plugin swaps the app bundle in place and the running process carries on.
 * shortcut: on Windows the plugin's install runs the installer and exits the app, so this would
 * quit it mid-session; install on quit there instead when Windows ships.
 */
export async function installUpdate(): Promise<void> {
  if (!pending) throw new Error("no downloaded update");
  await pending.install();
  installed = pending;
}

/** Installs the downloaded update (unless already installed) and relaunches the app. */
export async function installAndRelaunch(): Promise<void> {
  // Changelog is shown on next boot via take_new_changelog (version-change detection),
  // so nothing to persist here.
  if (installed !== pending) await installUpdate();
  await relaunch();
}
