import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateInfo {
  version: string;
  body: string | null;
}

/** Returns update info if a newer version is available, null otherwise. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const update = await check();
    if (!update?.available) return null;
    return { version: update.version, body: update.body ?? null };
  } catch (e) {
    // Tauri v2 updater throws "app is up to date" instead of returning null
    if (String(e).toLowerCase().includes("your app is up to date")) return null;
    throw e;
  }
}

/** Downloads and installs the update, then relaunches the app. */
export async function downloadAndInstall(): Promise<void> {
  const update = await check();
  if (!update?.available) return;
  await update.downloadAndInstall();
  await relaunch();
}
