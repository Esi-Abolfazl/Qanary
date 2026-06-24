/**
 * Playwright fixtures for Qanary e2e tests.
 *
 * Injects a minimal Tauri IPC mock before page load so api.ts commands resolve
 * without a native Tauri runtime. Runs against `pnpm dev` (port 1420).
 *
 * ponytail: inline __TAURI_INTERNALS__ mock instead of loading @tauri-apps/api/mocks.js
 * as a content-script; avoids ESM export stripping edge-cases and addInitScript scoping.
 * Achieves the same result: window.__TAURI_INTERNALS__.invoke is wired before React mounts.
 */
import { test as base, type Page } from "@playwright/test";
import type { Snapshot, Config } from "../src/types";

// --- Canned test data ---

export const SNAPSHOT: Snapshot = {
  lists: [
    {
      id: "internet",
      name: "Internet",
      icon: "🌐",
      services: [
        {
          id: "s1",
          label: "Google",
          state: "up",
          endpoints: [{ id: "e1", host: "google.com", state: "up", latency_ms: 20 }],
        },
      ],
      all_down: false,
      collapsed: false,
      critical: false,
    },
  ],
  overall: "green",
  wan: {
    ip: "1.2.3.4",
    country_code: "US",
    country_name: "United States",
    flag_emoji: "🇺🇸",
  },
};

export const CONFIG: Config = {
  lists: [],
  probe_interval_secs: 30,
  timeout_ms: 5000,
  ip_providers: [],
  down_notify: false,
  down_sound: false,
  up_notify: false,
  up_sound: false,
  hide_dock: false,
  last_changelog_version: null,
};

// --- Fixture types ---

type QanaryFixtures = {
  mockedPage: Page;
  getInvokedCmds: () => Promise<string[]>;
};

// --- Fixture implementation ---

export const test = base.extend<QanaryFixtures>({
  mockedPage: async ({ page }, use) => {
    const snap = SNAPSHOT;
    const cfg = CONFIG;

    // Wire window.__TAURI_INTERNALS__ before any page script runs.
    // This implements the same contract as @tauri-apps/api/mocks mockIPC but
    // inline, avoiding ESM export stripping issues with addInitScript({ content }).
    await page.addInitScript(
      ({ snap, cfg }) => {
        // ponytail: minimal Tauri IPC shim — covers invoke + transformCallback
        const callbacks = new Map<number, (data: unknown) => void>();

        function registerCallback(
          callback: (data: unknown) => void,
          once = false,
        ): number {
          const id = (window.crypto.getRandomValues(new Uint32Array(1))[0] as number);
          callbacks.set(id, (data: unknown) => {
            if (once) callbacks.delete(id);
            callback(data);
          });
          return id;
        }

        (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
          transformCallback: registerCallback,
          unregisterCallback: (id: number) => callbacks.delete(id),
          runCallback: (id: number, data: unknown) => callbacks.get(id)?.(data),
          callbacks,
          invoke: async (cmd: string) => {
            (window as unknown as { __INVOKED_CMDS__: string[] }).__INVOKED_CMDS__.push(cmd);
            switch (cmd) {
              case "get_snapshot": return snap;
              case "get_config": return cfg;
              case "refresh_now": return snap;
              case "take_new_changelog": return null;
              case "set_list_collapsed":
              case "reorder_lists":
              case "reorder_services": return null;
              case "add_services":
              case "update_service":
              case "remove_service":
              case "add_list":
              case "update_list":
              case "remove_list":
              case "reset_config":
              case "update_settings":
              case "set_hide_dock": return cfg;
              default: return null;
            }
          },
        };
        (window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__: unknown }).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
          unregisterListener: () => {},
        };
        (window as unknown as { __INVOKED_CMDS__: string[] }).__INVOKED_CMDS__ = [];
      },
      { snap, cfg },
    );

    await page.goto("/");
    // Wait until snapshot is loaded: busy = false means snapshot arrived
    await page.waitForSelector('[aria-label="Refresh"]:not([disabled])', {
      timeout: 10_000,
    });

    await use(page);
  },

  getInvokedCmds: async ({ mockedPage }, use) => {
    await use(() =>
      mockedPage.evaluate<string[]>(
        () =>
          (window as unknown as { __INVOKED_CMDS__: string[] }).__INVOKED_CMDS__ ?? [],
      ),
    );
  },
});

export { expect } from "@playwright/test";
