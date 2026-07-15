import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock notify to prevent Tauri plugin-notification from loading
vi.mock("./notify", () => ({ notify: vi.fn().mockResolvedValue(undefined) }));

import { buildMessage, effectiveDir, fireAlert } from "./alerts";
import type { Config } from "../types";
import { notify } from "./notify";

const mockNotify = vi.mocked(notify);

const baseConfig: Config = {
  lists: [],
  critical_interval_secs: 20,
  noncritical_interval_secs: 60,
  timeout_ms: 5000,
  ip_providers: [],
  down_notify: true,
  down_sound: false,
  up_notify: true,
  up_sound: false,
  blocked_notify: true,
  blocked_sound: false,
  hide_dock: false,
  last_changelog_version: null,
};

describe("effectiveDir", () => {
  it("keeps blocked when blocked_notify is on", () => {
    expect(effectiveDir("blocked", baseConfig)).toBe("blocked");
  });

  it("keeps blocked when only blocked_sound is on", () => {
    expect(
      effectiveDir("blocked", { ...baseConfig, blocked_notify: false, blocked_sound: true }),
    ).toBe("blocked");
  });

  it("falls back to down when both blocked toggles are off", () => {
    expect(
      effectiveDir("blocked", { ...baseConfig, blocked_notify: false, blocked_sound: false }),
    ).toBe("down");
  });

  it("passes down/up through unchanged", () => {
    expect(effectiveDir("down", baseConfig)).toBe("down");
    expect(effectiveDir("up", baseConfig)).toBe("up");
  });
});

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

describe("buildMessage (blocked direction)", () => {
  it("single list blocked", () => {
    expect(buildMessage("blocked", ["Iran"], false)).toEqual({
      title: "Blocked",
      body: "Iran appears blocked.",
    });
  });

  it("multiple lists blocked uses plural form", () => {
    expect(buildMessage("blocked", ["A", "B"], false)).toEqual({
      title: "Blocked",
      body: "A and B appear blocked.",
    });
  });
});

describe("fireAlert (blocked direction)", () => {
  beforeEach(() => {
    mockNotify.mockClear();
    vi.stubGlobal("Audio", class { play() { return Promise.resolve(); } });
  });

  it("fires notify when blocked_notify=true", () => {
    fireAlert("blocked", ["Iran"], false, baseConfig);
    expect(mockNotify).toHaveBeenCalledWith("Blocked", "Iran appears blocked.");
  });

  it("no notify when blocked_notify=false", () => {
    fireAlert("blocked", ["Iran"], false, { ...baseConfig, blocked_notify: false });
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("empty names → no notification", () => {
    fireAlert("blocked", [], false, baseConfig);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("plays sound when blocked_sound=true, silent when false", () => {
    const play = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("Audio", class { play() { return play(); } });

    fireAlert("blocked", ["Iran"], false, { ...baseConfig, blocked_sound: false });
    expect(play).not.toHaveBeenCalled();

    fireAlert("blocked", ["Iran"], false, { ...baseConfig, blocked_sound: true });
    expect(play).toHaveBeenCalledTimes(1);
  });
});
