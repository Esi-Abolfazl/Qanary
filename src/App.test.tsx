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
};

const CONFIG: Config = {
  lists: [],
  critical_interval_secs: 20,
  noncritical_interval_secs: 60,
  timeout_ms: 5000,
  ip_providers: [],
  down_notify: false,
  down_sound: false,
  up_notify: false,
  up_sound: false,
  hide_dock: false,
  last_changelog_version: null,
};

beforeEach(() => {
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
});
