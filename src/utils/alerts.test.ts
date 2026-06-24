import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock notify to prevent Tauri plugin-notification from loading
vi.mock("./notify", () => ({ notify: vi.fn().mockResolvedValue(undefined) }));

import { buildMessage, fireAlert } from "./alerts";
import type { Config } from "../types";
import { notify } from "./notify";

const mockNotify = vi.mocked(notify);

describe("buildMessage", () => {
  describe("down direction", () => {
    it("single list down", () => {
      expect(buildMessage("down", ["Internet"], false)).toEqual({
        title: "Outage",
        body: "Internet is down.",
      });
    });

    it("two lists down", () => {
      expect(buildMessage("down", ["A", "B"], false)).toEqual({
        title: "Outage",
        body: "A and B are down.",
      });
    });

    it("three lists down joined with comma", () => {
      expect(buildMessage("down", ["A", "B", "C"], false)).toEqual({
        title: "Outage",
        body: "A, B and C are down.",
      });
    });

    it("isAll=true → total outage message", () => {
      expect(buildMessage("down", ["A"], true)).toEqual({
        title: "Total outage",
        body: "All critical lists are down.",
      });
    });
  });

  describe("up direction", () => {
    it("single list recovered", () => {
      expect(buildMessage("up", ["Internet"], false)).toEqual({
        title: "Recovered",
        body: "Internet is back.",
      });
    });

    it("two lists recovered", () => {
      expect(buildMessage("up", ["A", "B"], false)).toEqual({
        title: "Recovered",
        body: "A and B are back.",
      });
    });

    it("isAll=true → all critical recovered", () => {
      expect(buildMessage("up", ["A"], true)).toEqual({
        title: "Recovered",
        body: "All critical lists are back.",
      });
    });
  });
});

describe("fireAlert", () => {
  const baseConfig: Config = {
    lists: [],
    probe_interval_secs: 30,
    timeout_ms: 5000,
    ip_providers: [],
    down_notify: true,
    down_sound: false,
    up_notify: true,
    up_sound: false,
    hide_dock: false,
    last_changelog_version: null,
  };

  beforeEach(() => {
    mockNotify.mockClear();
    // jsdom doesn't have Audio; stub it so fireAlert(sound=true) doesn't throw
    vi.stubGlobal("Audio", class { play() { return Promise.resolve(); } });
  });

  it("empty names → no notification", () => {
    fireAlert("down", [], false, baseConfig);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("fires notify when down_notify=true", () => {
    fireAlert("down", ["Internet"], false, baseConfig);
    expect(mockNotify).toHaveBeenCalledWith("Outage", "Internet is down.");
  });

  it("no notify when down_notify=false", () => {
    fireAlert("down", ["Internet"], false, { ...baseConfig, down_notify: false });
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("null config → no notification (graceful)", () => {
    fireAlert("down", ["Internet"], false, null);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});
