import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateInfo {
  version: string;
  body: string | null;
}

let pending: Update | null = null;

/** Returns update info if a newer version is available, null otherwise. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const update = await check();
    if (!update?.available) return null;
    pending = update;
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
}

/** Installs the downloaded update and relaunches the app. */
export async function installAndRelaunch(): Promise<void> {
  if (!pending) throw new Error("no downloaded update");
  await pending.install();
  await relaunch();
}
