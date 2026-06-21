// Thin wrapper over tauri-plugin-notification.
// Requests permission once on first call, then fires sendNotification.
// If permission is denied, the call silently does nothing (sound still plays).

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

let permissionCache: boolean | null = null;

async function ensurePermission(): Promise<boolean> {
  if (permissionCache !== null) return permissionCache;
  let granted = await isPermissionGranted();
  if (!granted) {
    const result = await requestPermission();
    granted = result === "granted";
  }
  permissionCache = granted;
  return granted;
}

/** Fire a native notification if permission is granted. */
export async function notify(title: string, body: string): Promise<void> {
  const ok = await ensurePermission();
  if (!ok) return;
  sendNotification({ title, body });
}
