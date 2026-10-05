/**
 * Playwright fixtures for Qanary e2e tests.
 *
 * Opens `pnpm dev` (port 1420) at /?mock, where the app installs its own dev Tauri IPC mock
 * (src/dev/mockTauri.ts) before React mounts; the canned data below reaches it as window.__MOCK__.
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
    {
      id: "intranet",
      name: "Intranet",
      icon: "🏠",
      services: [
        {
          id: "s2",
          label: "Digikala",
          state: "up",
          endpoints: [{ id: "e2", host: "digikala.com", state: "up", latency_ms: 30 }],
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
  cut_off: false,
  settled: true,
};

export const CONFIG: Config = {
  schema_version: 1,
  lists: [],
  critical_interval_secs: 20,
  noncritical_interval_secs: 60,
  timeout_ms: 5000,
  ip_providers: [],
  down_notify: false,
  down_sound: false,
  up_notify: false,
  up_sound: false,
  blocked_notify: false,
  blocked_sound: false,
  // Independent of the *_sound flags (ADR-0028) — a stored level survives every flag being off.
  notify_volume: 70,
  hide_dock: false,
  status_icon: "rings",
  tray_filled: false,
  tray_shape: "same",
  last_changelog_version: null,
};

// --- Fixture types ---

type QanaryFixtures = {
  mockedPage: Page;
  getInvokedCmds: () => Promise<string[]>;
  /** Deliver a backend event (e.g. `service-update`) to the page's listener, as Tauri would. */
  emitEvent: (event: string, payload: unknown) => Promise<void>;
};

// --- Fixture implementation ---

export const test = base.extend<QanaryFixtures>({
  mockedPage: async ({ page }, use) => {
    const snap = SNAPSHOT;
    const cfg = CONFIG;

    // The app's own dev mock (src/dev/mockTauri.ts) is the IPC shim; this only hands it the data.
    await page.addInitScript(
      ({ snap, cfg }) => {
        (window as unknown as { __MOCK__: unknown }).__MOCK__ = { snap, cfg };
      },
      { snap, cfg },
    );

    await page.goto("/?mock");
    // Wait until snapshot is loaded: busy = false means snapshot arrived
    await page.waitForSelector('[aria-label="Refresh"]:not([disabled])', {
      timeout: 10_000,
    });

    await use(page);
  },

  emitEvent: async ({ mockedPage }, use) => {
    await use((event, payload) =>
      mockedPage.evaluate(
        ({ event, payload }) => {
          const w = window as unknown as {
            __LISTENERS__: Record<string, number>;
            __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void };
          };
          w.__TAURI_INTERNALS__.runCallback(w.__LISTENERS__[event], { event, id: 0, payload });
        },
        { event, payload },
      ),
    );
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
