import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
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
  settled: true,
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
  // Independent of the *_sound flags (ADR-0028) — a stored level survives every flag being off.
  notify_volume: 70,
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

  // The volume and the three Sound flags are independent (ADR-0028): the slider is a level,
  // not a fourth mute switch. Only "no direction makes a sound" makes the level inapplicable.
  describe("notification volume slider (independent of the Sound flags)", () => {
    /** Open menu → Settings and return the slider + the three Sound checkboxes. */
    async function openAlertSettings(user: ReturnType<typeof userEvent.setup>) {
      render(<App />);
      await waitFor(() => screen.getByText("All clear"));
      await user.click(screen.getByRole("button", { name: /menu/i }));
      await user.click(screen.getByRole("button", { name: /^settings$/i }));
      return {
        slider: screen.getByLabelText(/sound volume/i) as HTMLInputElement,
        downSound: screen.getByRole("checkbox", { name: /sound on outage/i }),
        upSound: screen.getByRole("checkbox", { name: /sound on recovery/i }),
        blockedSound: screen.getByRole("checkbox", {
          name: /sound on blocked list/i,
        }),
      };
    }

    it("is inert while every Sound alert is off, keeping the stored level", async () => {
      const { slider } = await openAlertSettings(userEvent.setup());
      expect(slider).toBeDisabled();
      expect(slider.value).toBe("70"); // the stored level, not 0
      expect(screen.getByText(/enable a sound alert/i)).toBeInTheDocument();
    });

    it("checking a Sound box enables the slider without changing the level", async () => {
      const user = userEvent.setup();
      const { slider, downSound } = await openAlertSettings(user);

      await user.click(downSound);

      expect(downSound).toBeChecked();
      expect(slider).toBeEnabled();
      expect(slider.value).toBe("70");

      // ...and unchecking the last one only makes it inert again — the level is untouched.
      await user.click(downSound);
      expect(downSound).not.toBeChecked();
      expect(slider).toBeDisabled();
      expect(slider.value).toBe("70");
    });

    it("setting the slider to 0 mutes without unchecking any Sound box", async () => {
      const user = userEvent.setup();
      vi.mocked(api.updateSettings).mockResolvedValue(CONFIG);
      const { slider, downSound, upSound, blockedSound } =
        await openAlertSettings(user);

      await user.click(downSound);
      await user.click(upSound);
      await user.click(blockedSound);

      // Drag to 0 — fireEvent, since userEvent can't set a range slider's value directly.
      fireEvent.change(slider, { target: { value: "0" } });

      // 0 is a mute: the three directions stay configured and the slider stays live, so the
      // user can turn the level back up without redoing the checkboxes.
      expect(downSound).toBeChecked();
      expect(upSound).toBeChecked();
      expect(blockedSound).toBeChecked();
      expect(slider).toBeEnabled();
      expect(screen.getByText("Muted")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /^save$/i }));

      // `{volume: 0, sound: true}` is a legal persisted state now (args 5, 7, 9 are the
      // down/up/blocked sound flags) — `alerts.ts::soundAudible` is what keeps it honest.
      const calls = vi.mocked(api.updateSettings).mock.calls;
      const args = calls[calls.length - 1];
      expect(args[10]).toBe(0); // notifyVolume
      expect(args[5]).toBe(true); // downSound
      expect(args[7]).toBe(true); // upSound
      expect(args[9]).toBe(true); // blockedSound
    });
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

  // Alert-batch tests (ADR-0027). The batch is idle-debounced, so every alert here needs the
  // timer advanced past the quiet window (timeout_ms + 1s) before it speaks. Fake timers are
  // scoped to this block and torn down explicitly — the userEvent-driven tests elsewhere in
  // this file hang under them, and src/test/setup.ts only runs `cleanup` in afterEach.
  describe("alert batch (idle-debounced)", () => {
    const OFFLINE = {
      title: "You're offline",
      body: "Can't reach anything — check your connection.",
    };
    /** SNAPSHOT's only list is non-critical, so it can never transition. Make it critical. */
    const CRIT: Snapshot = {
      ...SNAPSHOT,
      lists: [{ ...SNAPSHOT.lists[0], critical: true }],
    };
    const CRIT_DOWN: Snapshot = {
      ...CRIT,
      lists: [{ ...CRIT.lists[0], all_down: true }],
    };
    /**
     * What `emit_checking` publishes before a probe round: every endpoint Checking, with
     * `all_down` / `cut_off` as placeholders rather than measurements.
     */
    const CHECKING: Snapshot = {
      ...CRIT,
      lists: [
        {
          ...CRIT.lists[0],
          all_down: false,
          services: [
            {
              ...CRIT.lists[0].services[0],
              state: "checking",
              endpoints: [
                { id: "e1", host: "google.com", state: "checking", latency_ms: null },
              ],
            },
          ],
        },
      ],
      cut_off: false,
      settled: false,
    };
    // CONFIG.timeout_ms is 5000, so quiet = 6000. 7000 clears it with margin but stays
    // under the 12s hard cap.
    const QUIET_MS = 7000;

    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    /**
     * Render with `config`, wait out the mounting promises, and return the status-update
     * handler. The initial getSnapshot() load already ran it once (prev === null → silent).
     *
     * Under fake timers the old macrotask flush (`setTimeout(r, 0)`) never resolves on its
     * own, so the promise chains are drained with advanceTimersByTimeAsync — which both
     * settles microtasks and runs the queued timers. That is what populates configRef
     * before any snapshot is driven.
     */
    async function mount(config: Partial<Config> = {}) {
      vi.mocked(api.getConfig).mockResolvedValue({ ...CONFIG, ...config });
      render(<App />);
      // `act` is load-bearing here, not decoration: configRef is assigned in a passive effect,
      // and React schedules those off the scheduler (MessageChannel), which fake timers don't
      // drive. Without act the first armFlush can read a null config and fall back to the
      // DEFAULT_TIMEOUT_MS window instead of this config's.
      await act(async () => {
        await settle(0);
      });
      expect(screen.getByText("All clear")).toBeInTheDocument();
      return vi.mocked(api.onStatusUpdate).mock.calls[0][0];
    }

    /**
     * Advance `ms` of batch time, then drain one more tick: `notify()` awaits the permission
     * check before calling sendNotification, so the flush's own timer firing is not enough.
     */
    async function settle(ms: number) {
      await vi.advanceTimersByTimeAsync(ms);
      await vi.advanceTimersByTimeAsync(0);
    }

    it("cut-off fires exactly one down notification on entry, silent on recovery/first-load", async () => {
      const { sendNotification } = await import("@tauri-apps/plugin-notification");
      const handleSnapshot = await mount({ down_notify: true });

      // false → true: fires once, but only after the batch settles.
      handleSnapshot({ ...SNAPSHOT, cut_off: true });
      expect(sendNotification).not.toHaveBeenCalled();
      await settle(QUIET_MS);
      expect(sendNotification).toHaveBeenCalledWith(OFFLINE);
      expect(sendNotification).toHaveBeenCalledTimes(1);

      // true → true: no change, no edge, no new batch.
      handleSnapshot({ ...SNAPSHOT, cut_off: true });
      await settle(QUIET_MS);
      expect(sendNotification).toHaveBeenCalledTimes(1);

      // true → false: recovery is a cut-off change (so it opens a batch), but with nothing
      // pending the flush has nothing to say.
      handleSnapshot({ ...SNAPSHOT, cut_off: false });
      await settle(QUIET_MS);
      expect(sendNotification).toHaveBeenCalledTimes(1);
    });

    // The reported bug: disconnecting alerted twice — the inline cut-off alert plus the
    // batched critical-list outage. Cut-off subsumes the outage, so it must speak alone.
    it("disconnect in one step → exactly one notification, the offline one", async () => {
      const { sendNotification } = await import("@tauri-apps/plugin-notification");
      const handleSnapshot = await mount({ down_notify: true });
      handleSnapshot(CRIT);

      handleSnapshot({ ...CRIT_DOWN, cut_off: true });
      await settle(QUIET_MS);

      expect(sendNotification).toHaveBeenCalledTimes(1);
      expect(sendNotification).toHaveBeenCalledWith(OFFLINE);
    });

    it("disconnect split across probe waves → still exactly one notification", async () => {
      const { sendNotification } = await import("@tauri-apps/plugin-notification");
      const handleSnapshot = await mount({ down_notify: true });
      handleSnapshot(CRIT);

      // Wave 1: the critical list drops. Under the old fixed 2500ms window this batch would
      // have flushed on its own and alerted "Total outage".
      handleSnapshot(CRIT_DOWN);
      await settle(3000);
      expect(sendNotification).not.toHaveBeenCalled();

      // Wave 2, ~3s later: the last endpoint fails and cut-off trips. Re-arms the same batch.
      handleSnapshot({ ...CRIT_DOWN, cut_off: true });
      await settle(QUIET_MS);

      expect(sendNotification).toHaveBeenCalledTimes(1);
      expect(sendNotification).toHaveBeenCalledWith(OFFLINE);
    });

    it("the quiet window tracks timeout_ms", async () => {
      const { sendNotification } = await import("@tauri-apps/plugin-notification");
      // timeout_ms 9000 → quiet 10_000, still under the 12s cap.
      const handleSnapshot = await mount({ down_notify: true, timeout_ms: 9000 });

      handleSnapshot({ ...SNAPSHOT, cut_off: true });
      await settle(QUIET_MS);
      expect(sendNotification).not.toHaveBeenCalled();

      await settle(4000);
      expect(sendNotification).toHaveBeenCalledTimes(1);
    });

    it("an outage suppressed by cut-off is announced once cut-off clears", async () => {
      const { sendNotification } = await import("@tauri-apps/plugin-notification");
      const handleSnapshot = await mount({ down_notify: true });
      handleSnapshot(CRIT);

      // Outage + cut-off together: only "You're offline" speaks, the outage stays pending.
      handleSnapshot({ ...CRIT_DOWN, cut_off: true });
      await settle(QUIET_MS);
      expect(sendNotification).toHaveBeenCalledTimes(1);
      expect(sendNotification).toHaveBeenCalledWith(OFFLINE);

      // Partial recovery: something is reachable again so cut-off clears, but the critical
      // list is still all_down. There is no new Transition edge — the retained entry is the
      // only reason the user hears about the surviving outage.
      handleSnapshot({ ...CRIT_DOWN, cut_off: false });
      await settle(QUIET_MS);
      expect(sendNotification).toHaveBeenCalledTimes(2);
      expect(sendNotification).toHaveBeenLastCalledWith({
        title: "Total outage",
        body: "All critical lists are down.",
      });
    });

    it("escalation: an outage alert, then a later cut-off edge, alerts twice", async () => {
      const { sendNotification } = await import("@tauri-apps/plugin-notification");
      const handleSnapshot = await mount({ down_notify: true });
      handleSnapshot(CRIT);

      // Round 1 settles with no cut-off → the outage speaks.
      handleSnapshot(CRIT_DOWN);
      await settle(QUIET_MS);
      expect(sendNotification).toHaveBeenCalledTimes(1);
      expect(sendNotification).toHaveBeenCalledWith({
        title: "Total outage",
        body: "All critical lists are down.",
      });

      // A later round reaches cut-off — new, worse information, so it speaks too.
      handleSnapshot({ ...CRIT_DOWN, cut_off: true });
      await settle(QUIET_MS);
      expect(sendNotification).toHaveBeenCalledTimes(2);
      expect(sendNotification).toHaveBeenLastCalledWith(OFFLINE);
    });

    // The reported burst: every Refresh / network-change round is preceded by a checking
    // snapshot whose all_down:false read as a full recovery, so each round cost one fake
    // "Recovered" plus one real "Total outage". On a macOS wake there are several such rounds.
    it("a checking snapshot is never diffed — a refresh mid-outage stays silent", async () => {
      const { sendNotification } = await import("@tauri-apps/plugin-notification");
      const handleSnapshot = await mount({ down_notify: true, up_notify: true });
      handleSnapshot(CRIT);

      handleSnapshot(CRIT_DOWN);
      await settle(QUIET_MS);
      expect(sendNotification).toHaveBeenCalledTimes(1);
      expect(sendNotification).toHaveBeenLastCalledWith({
        title: "Total outage",
        body: "All critical lists are down.",
      });

      // The placeholder round: repaint only.
      handleSnapshot(CHECKING);
      await settle(QUIET_MS);
      expect(sendNotification).toHaveBeenCalledTimes(1);

      // Probes land, still down — same settled state as the baseline, so still no news.
      handleSnapshot(CRIT_DOWN);
      await settle(QUIET_MS);
      expect(sendNotification).toHaveBeenCalledTimes(1);
    });

    // A suspension freezes the webview's timers while the wall clock keeps running. The batch's
    // age then exceeds ALERT_MAX_MS, the remaining cap goes negative, and the debounce collapses
    // to a 0ms flush — so the first edge after it alerted immediately. 16s is the midpoint of the
    // only band that exercises armFlush's guard: at or under ALERT_MAX_MS (12s) the cap never goes
    // negative and there is nothing to fix, and over WAKE_GAP_MS (20s) the heartbeat calls this a
    // system sleep and `handleWake` owns the case instead. In between, the guard is the only
    // protection (App Nap, a paused debugger, severe CPU starvation).
    it("a batch that outlived a suspension gets a fresh quiet window, not a 0ms flush", async () => {
      const { sendNotification } = await import("@tauri-apps/plugin-notification");
      const handleSnapshot = await mount({ down_notify: true });
      handleSnapshot(CRIT);

      // An edge opens a batch; then the process is suspended for 16s.
      handleSnapshot(CRIT_DOWN);
      const base = Date.now();
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(base + 16_000);

      // Resumed: the first edge must still be held for the full quiet window.
      handleSnapshot({ ...CRIT_DOWN, cut_off: true });
      await settle(1);
      expect(sendNotification).not.toHaveBeenCalled();

      await settle(QUIET_MS);
      expect(sendNotification).toHaveBeenCalledTimes(1);
      nowSpy.mockRestore();
    });

    describe("system wake", () => {
      // The app's own constants — kept in sync by hand; the specs below fail loudly if they drift.
      const WAKE_TICK_MS = 5_000;
      const WAKE_GRACE_MAX_MS = 20_000;

      /**
       * Simulate a suspension: jump the wall clock by `ms` (fake timers stay frozen, exactly as
       * they do while the CPU is halted), then let one heartbeat tick observe the gap.
       *
       * The spy is installed on top of the fake clock and left in place: every later `Date.now()`
       * in the test reads `fake + offset`, so timer-driven code still sees time advance.
       */
      async function sleepAndWake(ms: number) {
        const offset = ms;
        const fakeNow = Date.now;
        vi.spyOn(Date, "now").mockImplementation(() => fakeNow.call(Date) + offset);
        await settle(WAKE_TICK_MS);
      }

      it("a wake with connectivity already back alerts nothing", async () => {
        const { sendNotification } = await import("@tauri-apps/plugin-notification");
        const handleSnapshot = await mount({ down_notify: true, up_notify: true });
        handleSnapshot(CRIT); // baseline: everything up

        await sleepAndWake(3_600_000);

        // Post-wake, the network stack is not up yet: probes fail fast and settle to cut-off.
        handleSnapshot({ ...CRIT_DOWN, cut_off: true });
        await settle(QUIET_MS);
        expect(sendNotification).not.toHaveBeenCalled();

        // Wifi/DHCP/DNS finish; the network proves itself and closes the window early.
        handleSnapshot(CRIT);
        await settle(QUIET_MS);
        expect(sendNotification).not.toHaveBeenCalled();

        // The grace cap passing changes nothing — the window is already closed.
        await settle(WAKE_GRACE_MAX_MS);
        expect(sendNotification).not.toHaveBeenCalled();
      });

      it("an outage that began during the sleep is announced once, after the window", async () => {
        const { sendNotification } = await import("@tauri-apps/plugin-notification");
        const handleSnapshot = await mount({ down_notify: true });
        handleSnapshot(CRIT); // baseline: everything up

        await sleepAndWake(3_600_000);

        // Still nothing reachable, round after round — held while the window is open.
        handleSnapshot({ ...CRIT_DOWN, cut_off: true });
        await settle(QUIET_MS);
        expect(sendNotification).not.toHaveBeenCalled();

        // The window expires. One diff against the pre-sleep baseline, one alert.
        await settle(WAKE_GRACE_MAX_MS);
        await settle(QUIET_MS);
        expect(sendNotification).toHaveBeenCalledTimes(1);
        expect(sendNotification).toHaveBeenCalledWith(OFFLINE);
      });

      it("an edge the sleep interrupted is still announced, once", async () => {
        const { sendNotification } = await import("@tauri-apps/plugin-notification");
        const handleSnapshot = await mount({ down_notify: true });
        handleSnapshot(CRIT);

        // The outage lands, opening a batch — then the machine sleeps before it can flush.
        handleSnapshot(CRIT_DOWN);
        await sleepAndWake(3_600_000);
        expect(sendNotification).not.toHaveBeenCalled();

        // Nothing new arrives; the window expires and pays out what the batch still owed.
        await settle(WAKE_GRACE_MAX_MS);
        await settle(QUIET_MS);
        expect(sendNotification).toHaveBeenCalledTimes(1);
        expect(sendNotification).toHaveBeenCalledWith({
          title: "Total outage",
          body: "All critical lists are down.",
        });
      });
    });
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
