import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock notify to prevent Tauri plugin-notification from loading
vi.mock("./notify", () => ({ notify: vi.fn().mockResolvedValue(undefined) }));

import { buildMessage, effectiveDir, fireAlert, fireBatch, fireCutOffAlert } from "./alerts";
import type { Config } from "../types";
import { notify } from "./notify";

const mockNotify = vi.mocked(notify);

const baseConfig: Config = {
  schema_version: 1,
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
  notify_volume: 100,
  hide_dock: false,
  last_changelog_version: null,
};

/**
 * jsdom has no `Audio`. Stub it with a recorder so tests can assert both *whether* a sound was
 * constructed (volume 0 must construct none) and at what `.volume` it played.
 * Returns the list of constructed instances plus the shared `play` spy.
 */
function stubAudio() {
  const instances: { src: string; volume: number }[] = [];
  const play = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal(
    "Audio",
    class {
      volume = 1;
      constructor(public src: string) {
        instances.push(this as unknown as { src: string; volume: number });
      }
      play() {
        return play();
      }
    },
  );
  return { instances, play };
}

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
    stubAudio();
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

describe("fireCutOffAlert", () => {
  beforeEach(() => {
    mockNotify.mockClear();
    stubAudio();
  });

  it("fires the fixed offline copy when down_notify=true", () => {
    fireCutOffAlert(baseConfig);
    expect(mockNotify).toHaveBeenCalledWith(
      "You're offline",
      "Can't reach anything — check your connection.",
    );
  });

  it("no notify when down_notify=false", () => {
    fireCutOffAlert({ ...baseConfig, down_notify: false });
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("null config → no notification (graceful)", () => {
    fireCutOffAlert(null);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("plays the down sound when down_sound=true, silent when false", () => {
    const { play } = stubAudio();

    fireCutOffAlert({ ...baseConfig, down_sound: false });
    expect(play).not.toHaveBeenCalled();

    fireCutOffAlert({ ...baseConfig, down_sound: true });
    expect(play).toHaveBeenCalledTimes(1);
  });
});

describe("fireAlert (blocked direction)", () => {
  beforeEach(() => {
    mockNotify.mockClear();
    stubAudio();
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
    const { play } = stubAudio();

    fireAlert("blocked", ["Iran"], false, { ...baseConfig, blocked_sound: false });
    expect(play).not.toHaveBeenCalled();

    fireAlert("blocked", ["Iran"], false, { ...baseConfig, blocked_sound: true });
    expect(play).toHaveBeenCalledTimes(1);
  });
});

// fireBatch owns the whole alert-precedence rule (cut-off > blocked > outage) for one settled
// Alert batch, so this block is the matrix that pins it (ADR-0027).
describe("fireBatch (alert precedence)", () => {
  const OFFLINE = ["You're offline", "Can't reach anything — check your connection."] as const;
  /** Audible cut-off channel: both down flags on, so notification *and* sound are countable. */
  const audible: Config = { ...baseConfig, down_notify: true, down_sound: true };
  const ctx = { cutOff: false, cutOffEdge: false, allDown: false, allUp: false };

  beforeEach(() => {
    mockNotify.mockClear();
  });

  it("cut-off edge + a down entry → only the offline alert, and exactly one sound", () => {
    const { instances, play } = stubAudio();

    const { suppressed } = fireBatch(
      [{ name: "Intranet", dir: "down" }],
      { ...ctx, cutOff: true, cutOffEdge: true, allDown: true },
      audible,
    );

    // The reported bug: this used to be two notifications and two sounds.
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith(...OFFLINE);
    expect(instances).toHaveLength(1);
    expect(play).toHaveBeenCalledTimes(1);
    expect(suppressed).toBe(true);
  });

  it("sticky cut-off (holds, no new edge) stays silent even with a fresh outage entry", () => {
    const { play } = stubAudio();

    const { suppressed } = fireBatch(
      [{ name: "Intranet", dir: "down" }],
      { ...ctx, cutOff: true, cutOffEdge: false, allDown: true },
      audible,
    );

    expect(mockNotify).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    // Suppressed, so the caller keeps it pending for when cut-off clears.
    expect(suppressed).toBe(true);
  });

  it("a cut-off edge that resolved by settle time alerts the list edges, not offline", () => {
    fireBatch(
      [{ name: "Intranet", dir: "down" }],
      { ...ctx, cutOff: false, cutOffEdge: true },
      audible,
    );

    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith("Outage", "Intranet is down.");
  });

  it("a muted cut-off channel never swallows an opted-in blocked alert", () => {
    fireBatch([{ name: "Iran", dir: "blocked" }], { ...ctx, cutOff: true, cutOffEdge: true }, {
      ...baseConfig,
      down_notify: false,
      down_sound: false,
      blocked_notify: true,
    });

    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith("Blocked", "Iran appears blocked.");
  });

  it("no cut-off → down / up / blocked fire as before, nothing suppressed", () => {
    const { suppressed } = fireBatch(
      [
        { name: "Intranet", dir: "down" },
        { name: "Internet", dir: "up" },
        { name: "Iran", dir: "blocked" },
      ],
      ctx,
      baseConfig,
    );

    expect(mockNotify).toHaveBeenCalledWith("Outage", "Intranet is down.");
    expect(mockNotify).toHaveBeenCalledWith("Recovered", "Internet is back.");
    expect(mockNotify).toHaveBeenCalledWith("Blocked", "Iran appears blocked.");
    expect(suppressed).toBe(false);
  });

  it("isAll flags reach the copy (total outage / full recovery)", () => {
    fireBatch([{ name: "Intranet", dir: "down" }], { ...ctx, allDown: true }, baseConfig);
    expect(mockNotify).toHaveBeenCalledWith("Total outage", "All critical lists are down.");
  });

  it("an empty batch under cut-off reports nothing to retain", () => {
    const { suppressed } = fireBatch([], { ...ctx, cutOff: true, cutOffEdge: true }, audible);
    expect(mockNotify).toHaveBeenCalledWith(...OFFLINE);
    expect(suppressed).toBe(false);
  });
});

describe("notify_volume (the gain path)", () => {
  beforeEach(() => {
    mockNotify.mockClear();
  });

  it("volume 0 constructs no Audio at all, even with down_sound on", () => {
    const { instances, play } = stubAudio();
    fireAlert("down", ["Internet"], false, {
      ...baseConfig,
      down_sound: true,
      notify_volume: 0,
    });
    expect(instances).toHaveLength(0);
    expect(play).not.toHaveBeenCalled();
  });

  it("volume 50 plays at half amplitude (linear)", () => {
    const { instances } = stubAudio();
    fireAlert("down", ["Internet"], false, {
      ...baseConfig,
      down_sound: true,
      notify_volume: 50,
    });
    expect(instances).toHaveLength(1);
    expect(instances[0].volume).toBe(0.5);
  });

  it("volume 100 plays at full amplitude", () => {
    const { instances } = stubAudio();
    fireAlert("up", ["Internet"], false, {
      ...baseConfig,
      up_sound: true,
      notify_volume: 100,
    });
    expect(instances[0].volume).toBe(1);
  });

  it("fireCutOffAlert obeys the same gate", () => {
    const { instances, play } = stubAudio();
    fireCutOffAlert({ ...baseConfig, down_sound: true, notify_volume: 0 });
    expect(instances).toHaveLength(0);
    expect(play).not.toHaveBeenCalled();

    fireCutOffAlert({ ...baseConfig, down_sound: true, notify_volume: 25 });
    expect(instances).toHaveLength(1);
    expect(instances[0].volume).toBe(0.25);
  });

  it("still fires the notification at volume 0 — banner without audio", () => {
    const { instances } = stubAudio();
    fireAlert("down", ["Internet"], false, {
      ...baseConfig,
      down_notify: true,
      down_sound: true,
      notify_volume: 0,
    });
    expect(mockNotify).toHaveBeenCalledWith("Outage", "Internet is down.");
    expect(instances).toHaveLength(0);
  });
});
