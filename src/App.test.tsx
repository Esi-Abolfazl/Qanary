import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock the entire api module — every fn returns sensible defaults below
vi.mock("./api", () => ({
  getSnapshot: vi.fn(),
  getConfig: vi.fn(),
  refreshNow: vi.fn(),
  onStatusUpdate: vi.fn(),
  onServiceUpdate: vi.fn(),
  takeNewChangelog: vi.fn(),
  getChangelog: vi.fn(),
  addServices: vi.fn(),
  updateService: vi.fn(),
  removeService: vi.fn(),
  addList: vi.fn(),
  updateList: vi.fn(),
  removeList: vi.fn(),
  resetConfig: vi.fn(),
  setListCollapsed: vi.fn(),
  reorderLists: vi.fn(),
  reorderServices: vi.fn(),
  updateSettings: vi.fn(),
  setHideDock: vi.fn(),
  exportConfig: vi.fn(),
  importConfig: vi.fn(),
}));

vi.mock("./update", () => ({
  checkForUpdate: vi.fn().mockResolvedValue(null),
  downloadUpdate: vi.fn(),
  installAndRelaunch: vi.fn(),
}));

import App from "./App";
import * as api from "./api";
import type { Config, Snapshot } from "./types";

// Minimal canned fixtures
const SNAPSHOT: Snapshot = {
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
  wan: { ip: "1.2.3.4", country_code: "US", country_name: "United States", flag_emoji: "🇺🇸" },
  cut_off: false,
};

const CONFIG: Config = {
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
  hide_dock: false,
  last_changelog_version: null,
};

beforeEach(() => {
  vi.clearAllMocks(); // reset call history between tests (so not.toHaveBeenCalled is reliable)
  vi.mocked(api.getSnapshot).mockResolvedValue(SNAPSHOT);
  vi.mocked(api.getConfig).mockResolvedValue(CONFIG);
  vi.mocked(api.takeNewChangelog).mockResolvedValue([]);
  vi.mocked(api.getChangelog).mockResolvedValue([]);
  vi.mocked(api.onStatusUpdate).mockResolvedValue(() => {});
  vi.mocked(api.onServiceUpdate).mockResolvedValue(() => {});
  vi.mocked(api.refreshNow).mockResolvedValue(SNAPSHOT);
});

describe("App", () => {
  it('shows "All clear" headline for green overall severity', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("All clear")).toBeInTheDocument());
  });

  it("renders list name from snapshot", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("Internet")).toBeInTheDocument());
  });

  it("refresh button calls api.refreshNow", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => screen.getByText("All clear"));

    const refreshBtn = screen.getByRole("button", { name: /refresh/i });
    await user.click(refreshBtn);

    expect(api.refreshNow).toHaveBeenCalled();
  });

  it("settings menu item opens settings panel", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => screen.getByText("All clear"));

    // Open the menu dropdown
    const menuBtn = screen.getByRole("button", { name: /menu/i });
    await user.click(menuBtn);

    // Click the Settings item in the dropdown
    const settingsItem = screen.getByRole("button", { name: /^settings$/i });
    await user.click(settingsItem);

    // Settings panel should be visible
    expect(screen.getByRole("heading", { name: /^settings$/i })).toBeInTheDocument();
  });

  it("settings panel shows Config card with Export and Import buttons", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => screen.getByText("All clear"));

    // Open menu → Settings
    await user.click(screen.getByRole("button", { name: /menu/i }));
    await user.click(screen.getByRole("button", { name: /^settings$/i }));

    // Config card legend and both buttons must be rendered
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /import/i })).toBeInTheDocument();
  });

  it("Export button calls saveDialog (file picker) — cancel leaves config untouched", async () => {
    const { save: saveMock } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(saveMock).mockResolvedValue(null); // user cancels picker

    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => screen.getByText("All clear"));

    await user.click(screen.getByRole("button", { name: /menu/i }));
    await user.click(screen.getByRole("button", { name: /^settings$/i }));
    await user.click(screen.getByRole("button", { name: /export/i }));

    // Dialog was shown; cancel means exportConfig is NOT invoked
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(api.exportConfig).not.toHaveBeenCalled();
  });

  it("Import asks for overwrite confirmation before calling importConfig", async () => {
    const { open: openMock } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(openMock).mockResolvedValue("/tmp/picked-config.json");
    vi.mocked(api.importConfig).mockResolvedValue(CONFIG);

    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => screen.getByText("All clear"));

    await user.click(screen.getByRole("button", { name: /menu/i }));
    await user.click(screen.getByRole("button", { name: /^settings$/i }));
    await user.click(screen.getByRole("button", { name: /import/i }));

    // Confirmation modal appears; importConfig must NOT have run yet.
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /import config\?/i })).toBeInTheDocument(),
    );
    expect(screen.getByText(/overwrite and clear/i)).toBeInTheDocument();
    expect(api.importConfig).not.toHaveBeenCalled();

    // Confirm → importConfig fires with the picked path.
    await user.click(screen.getByRole("button", { name: /overwrite/i }));
    expect(api.importConfig).toHaveBeenCalledWith("/tmp/picked-config.json");
  });

  it('wildcard endpoint renders blue "reachable" dot and "TCP only" note', async () => {
    const wildcardSnap: Snapshot = {
      ...SNAPSHOT,
      lists: [
        {
          ...SNAPSHOT.lists[0],
          services: [
            {
              id: "cursor",
              label: "Cursor",
              state: "reachable",
              endpoints: [
                { id: "w1", host: "*.cursor.sh", state: "reachable", latency_ms: null },
              ],
            },
          ],
        },
      ],
    };
    vi.mocked(api.getSnapshot).mockResolvedValue(wildcardSnap);

    render(<App />);
    await waitFor(() => expect(screen.getByText("*.cursor.sh")).toBeInTheDocument());
    // TCP-only note shown in place of latency, and the dot carries the reachable title.
    expect(screen.getByText("TCP only")).toBeInTheDocument();
    expect(screen.getByTitle(/reachable \(tcp only\)/i)).toBeInTheDocument();
  });

  it("cut-off shows the offline headline and marks the shared ancestor for all-red dots", async () => {
    render(<App />);
    await waitFor(() => screen.getByText("All clear"));
    const handleSnapshot = vi.mocked(api.onStatusUpdate).mock.calls[0][0];

    handleSnapshot({ ...SNAPSHOT, cut_off: true });

    expect(await screen.findByText("You're offline")).toBeInTheDocument();
    expect(screen.getByText("Can't reach anything — check your connection.")).toBeInTheDocument();
    // The class lives on the shared ancestor (main.app), not the header, so the
    // .cut-off CSS override reaches ServiceRow's dots too (see App.css).
    expect(document.querySelector("main.app.cut-off")).not.toBeNull();
  });

  it("cut-off fires exactly one down notification on entry, silent on recovery/first-load", async () => {
    const { sendNotification } = await import("@tauri-apps/plugin-notification");
    vi.mocked(api.getConfig).mockResolvedValue({ ...CONFIG, down_notify: true });

    render(<App />);
    await waitFor(() => screen.getByText("All clear"));
    // "All clear" only proves the snapshot fetch settled — api.getConfig() resolves
    // independently, and fireCutOffAlert reads config off a ref updated by its own
    // effect. Flush a macrotask tick so that ref is populated before driving cut-off.
    await new Promise((r) => setTimeout(r, 0));

    // The initial getSnapshot() load already ran handleSnapshot once (prev === null →
    // silent). Grab that same handler off the onStatusUpdate subscription to drive
    // further snapshots, mirroring how a real status-update event would land.
    const handleSnapshot = vi.mocked(api.onStatusUpdate).mock.calls[0][0];

    // false → true: fires once.
    handleSnapshot({ ...SNAPSHOT, cut_off: true });
    await waitFor(() =>
      expect(sendNotification).toHaveBeenCalledWith({
        title: "You're offline",
        body: "Can't reach anything — check your connection.",
      }),
    );
    expect(sendNotification).toHaveBeenCalledTimes(1);

    // true → true: no change, stays silent.
    handleSnapshot({ ...SNAPSHOT, cut_off: true });
    expect(sendNotification).toHaveBeenCalledTimes(1);

    // true → false: recovery, stays silent.
    handleSnapshot({ ...SNAPSHOT, cut_off: false });
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("Import confirmation Cancel aborts without calling importConfig", async () => {
    const { open: openMock } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(openMock).mockResolvedValue("/tmp/picked-config.json");

    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => screen.getByText("All clear"));

    await user.click(screen.getByRole("button", { name: /menu/i }));
    await user.click(screen.getByRole("button", { name: /^settings$/i }));
    await user.click(screen.getByRole("button", { name: /import/i }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /import config\?/i })).toBeInTheDocument(),
    );
    // Cancel the confirm (the one inside the confirm modal).
    const cancelBtns = screen.getAllByRole("button", { name: /^cancel$/i });
    await user.click(cancelBtns[cancelBtns.length - 1]);

    expect(api.importConfig).not.toHaveBeenCalled();
  });
});
