import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock the entire api module — every fn returns sensible defaults below
vi.mock("./api", () => ({
  getSnapshot: vi.fn(),
  getConfig: vi.fn(),
  refreshNow: vi.fn(),
  checkNow: vi.fn(),
  checkList: vi.fn(),
  onStatusUpdate: vi.fn(),
  onServiceUpdate: vi.fn(),
  onMenuAction: vi.fn(),
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
  exportConfig: vi.fn(),
  importConfig: vi.fn(),
  takeLoadWarning: vi.fn(),
}));

vi.mock("./update", () => ({
  checkForUpdate: vi.fn().mockResolvedValue(null),
  downloadUpdate: vi.fn(),
  installAndRelaunch: vi.fn(),
}));

import App from "./App";
import * as api from "./api";
import * as update from "./update";
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
  status_icon: "rings",
  tray_filled: false,
  tray_shape: "same",
  last_changelog_version: null,
};

beforeEach(() => {
  vi.clearAllMocks(); // reset call history between tests (so not.toHaveBeenCalled is reliable)
  vi.mocked(api.getSnapshot).mockResolvedValue(SNAPSHOT);
  vi.mocked(api.getConfig).mockResolvedValue(CONFIG);
  vi.mocked(api.takeNewChangelog).mockResolvedValue([]);
  vi.mocked(api.takeLoadWarning).mockResolvedValue(null);
  vi.mocked(api.getChangelog).mockResolvedValue([]);
  vi.mocked(api.onStatusUpdate).mockResolvedValue(() => {});
  vi.mocked(api.onServiceUpdate).mockResolvedValue(() => {});
  vi.mocked(api.onMenuAction).mockResolvedValue(() => {});
  vi.mocked(api.refreshNow).mockResolvedValue();
  vi.mocked(api.checkNow).mockResolvedValue();
  vi.mocked(api.checkList).mockResolvedValue();
  vi.mocked(update.checkForUpdate).mockResolvedValue(null);
  vi.mocked(update.downloadUpdate).mockResolvedValue();
  vi.mocked(update.installAndRelaunch).mockResolvedValue();
});

/** Add list, Edit order and Settings sit in the hero's ☰ drawer. */
async function heroAction(user: ReturnType<typeof userEvent.setup>, name: RegExp | string) {
  await user.click(screen.getByRole("button", { name: "Menu" }));
  await user.click(within(screen.getByRole("group", { name: "App actions" })).getByRole("button", { name }));
}

describe("App", () => {
  it('shows "All clear" headline for green overall severity', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("All clear")).toBeInTheDocument());
  });

  // B07: an unmeasured or empty app claimed "All clear", and an empty config waited forever.
  it("says Checking, not All clear, before anything is measured", async () => {
    vi.mocked(api.getSnapshot).mockResolvedValue(null);
    render(<App />);
    expect(screen.getByText("Checking…")).toBeInTheDocument();
    expect(screen.queryByText("All clear")).not.toBeInTheDocument();
  });

  it("with no lists, offers Add list instead of waiting for a probe", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getSnapshot).mockResolvedValue({ ...SNAPSHOT, lists: [] });
    render(<App />);
    expect(await screen.findByText("Nothing to watch")).toBeInTheDocument();
    const empty = (await screen.findByText(/No lists yet/)).closest(".loading") as HTMLElement;
    await user.click(within(empty).getByRole("button", { name: "Add list" }));
    expect(screen.getByRole("heading", { name: /list/i })).toBeInTheDocument();
  });

  it("with no lists, the app menu's Edit order does nothing", async () => {
    let menu: (a: api.MenuAction) => void = () => {};
    vi.mocked(api.onMenuAction).mockImplementation(async (cb) => {
      menu = cb;
      return () => {};
    });
    vi.mocked(api.getSnapshot).mockResolvedValue({ ...SNAPSHOT, lists: [] });
    render(<App />);
    await screen.findByText(/No lists yet/);
    act(() => menu("edit-order"));
    expect(screen.queryByRole("button", { name: /^done$/i })).not.toBeInTheDocument();
  });

  it("renders list name from snapshot", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("Internet")).toBeInTheDocument());
  });

  it("shows the startup config-recovery warning once and lets the user dismiss it", async () => {
    const user = userEvent.setup();
    vi.mocked(api.takeLoadWarning).mockResolvedValue("Your settings file isn't valid.");
    render(<App />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your settings file isn't valid.");
    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a rejected settings save keeps Settings open with the error and the edits", async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateSettings).mockRejectedValue("Couldn't save your settings: disk full");
    render(<App />);
    await waitFor(() => screen.getByText("All clear"));

    await heroAction(user, /^settings$/i);
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
    expect(screen.getByRole("heading", { name: /^settings$/i })).toBeInTheDocument();
  });

  it("Dock and the other settings are saved in one write", async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateSettings).mockResolvedValue(CONFIG);
    render(<App />);
    await waitFor(() => screen.getByText("All clear"));

    await heroAction(user, /^settings$/i);
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
    expect(api.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ hide_dock: false }));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: /^settings$/i })).not.toBeInTheDocument(),
    );
  });

  // A01: a service added as a bare host ("google.com") used to round-trip through
  // "google.com: google.com" and be saved as that literal host — permanently Down.
  it("editing a bare-host service and saving unchanged keeps its host", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getConfig).mockResolvedValue({
      ...CONFIG,
      lists: [{
        id: "internet", name: "Internet", icon: "🌐", collapsed: false, critical: false,
        services: [{
          id: "s1", label: "google.com", enabled: true,
          endpoints: [{ id: "e1", host: "google.com", port: 443 }],
        }],
      }],
    });
    vi.mocked(api.updateService).mockResolvedValue(CONFIG);
    render(<App />);
    await waitFor(() => screen.getByText("All clear"));

    await user.click(screen.getByTitle("Service options"));
    await user.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.getByLabelText("Label")).toHaveValue("google.com");
    expect(screen.getByLabelText("Endpoints")).toHaveValue("google.com");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(api.updateService).toHaveBeenCalledWith("internet", "s1", "google.com", [
      { host: "google.com" },
    ]);
  });

  // A05: collapse lived in ServiceList local state, so remounting it (reorder mode) reverted it.
  it("a collapsed list stays collapsed across entering and leaving reorder mode", async () => {
    const user = userEvent.setup();
    vi.mocked(api.setListCollapsed).mockResolvedValue(CONFIG);
    render(<App />);
    await waitFor(() => screen.getByText("Google"));

    await user.click(screen.getByTitle("Collapse"));
    expect(api.setListCollapsed).toHaveBeenCalledWith("internet", true);
    // The rows leave the DOM once the collapse animation has played.
    await waitFor(() => expect(screen.queryByText("Google")).not.toBeInTheDocument());

    await user.click(screen.getAllByTitle("List options")[0]);
    await user.click(screen.getByRole("button", { name: /edit order/i }));
    await user.click(screen.getByRole("button", { name: /^done$/i }));
    expect(screen.queryByText("Google")).not.toBeInTheDocument();
    expect(screen.getByTitle("Expand")).toBeInTheDocument();
  });

  it("the list options menu opens reorder mode", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => screen.getByText("Google"));

    await user.click(screen.getByTitle("List options"));
    const items = screen.getAllByRole("button").filter((b) => b.className.includes("list-dropdown-item"));
    expect(items.map((b) => b.textContent)).toEqual(["Edit", "Edit order", "Delete"]);
    await user.click(items[1]);
    expect(screen.getByRole("button", { name: /^done$/i })).toBeInTheDocument();
    expect(screen.getAllByTitle("Drag to reorder").length).toBeGreaterThan(0);
  });

  it("in reorder mode a list can still be collapsed, so long lists are easier to move", async () => {
    const user = userEvent.setup();
    vi.mocked(api.setListCollapsed).mockResolvedValue(CONFIG);
    render(<App />);
    await waitFor(() => screen.getByText("Google"));

    await user.click(screen.getAllByTitle("List options")[0]);
    await user.click(screen.getByRole("button", { name: /edit order/i }));
    await user.click(screen.getAllByTitle("Collapse")[0]);
    expect(api.setListCollapsed).toHaveBeenCalledWith("internet", true);
    await waitFor(() => expect(screen.queryByText("Google")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^done$/i })).toBeInTheDocument();
  });

  // R3: a layout edit painted with a bare setSnapshot left the delta merge base behind, so the
  // next per-service update merged onto the old layout and reverted the edit on screen.
  it("a collapse survives the next per-service update", async () => {
    const user = userEvent.setup();
    vi.mocked(api.setListCollapsed).mockResolvedValue(CONFIG);
    render(<App />);
    await waitFor(() => screen.getByText("Google"));

    await user.click(screen.getByTitle("Collapse"));
    const onDelta = vi.mocked(api.onServiceUpdate).mock.calls[0][0];
    act(() =>
      onDelta({
        list_id: "internet",
        service: { ...SNAPSHOT.lists[0].services[0], state: "down" },
        list_all_down: true,
        overall: "green",
        cut_off: false,
        settled: true,
      }),
    );
    await waitFor(() => expect(screen.queryByText("Google")).not.toBeInTheDocument());
    expect(screen.getByTitle("Expand")).toBeInTheDocument();
  });

  it("a refused collapse is reported and the list repaints from the backend", async () => {
    const user = userEvent.setup();
    vi.mocked(api.setListCollapsed).mockRejectedValue("Couldn't save your settings: disk full");
    render(<App />);
    await waitFor(() => screen.getByText("Google"));

    await user.click(screen.getByTitle("Collapse"));
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
    await waitFor(() => expect(screen.getByText("Google")).toBeInTheDocument());
  });

  // B03: Settings showed only 4 provider slots, so saving dropped a 5th imported provider.
  it("saving Settings keeps a 5th IP provider", async () => {
    const user = userEvent.setup();
    const providers = ["a.com", "b.com", "c.com", "d.com", "e.com"];
    vi.mocked(api.getConfig).mockResolvedValue({ ...CONFIG, ip_providers: providers });
    vi.mocked(api.updateSettings).mockResolvedValue(CONFIG);
    render(<App />);
    await waitFor(() => screen.getByText("All clear"));

    await heroAction(user, /^settings$/i);
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ ip_providers: providers }),
      ),
    );
  });

  // A12: Settings kept its own update state and handle. Downloading from the hero and then
  // checking from Settings (or the reverse) could re-download or install a different release.
  describe("updates have one owner", () => {
    async function openSettings(user: ReturnType<typeof userEvent.setup>) {
      await heroAction(user, /^settings$/i);
    }

    it("a newer release found after a download installs the downloaded one, once", async () => {
      const user = userEvent.setup();
      vi.mocked(update.checkForUpdate).mockResolvedValue({ version: "1.0.1", body: null });
      render(<App />);
      await user.click(await screen.findByRole("button", { name: /^update$/i }));
      await screen.findByRole("button", { name: /^restart$/i });

      // The 6h re-check (here via the visibility path) finds 1.0.2 while 1.0.1 is on disk.
      vi.mocked(update.checkForUpdate).mockResolvedValue({ version: "1.0.2", body: null });
      const later = Date.now() + 6 * 60 * 60 * 1000 + 1;
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(later);
      document.dispatchEvent(new Event("visibilitychange"));
      await waitFor(() => expect(update.checkForUpdate).toHaveBeenCalledTimes(2));
      nowSpy.mockRestore();

      await openSettings(user);
      expect(screen.getByText("v1.0.1 ready")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /install & restart/i }));
      expect(update.installAndRelaunch).toHaveBeenCalledTimes(1);
      expect(update.downloadUpdate).toHaveBeenCalledTimes(1);
    });

    it("Settings shows a hero-started download instead of offering a second one", async () => {
      const user = userEvent.setup();
      vi.mocked(update.checkForUpdate).mockResolvedValue({ version: "1.0.1", body: null });
      vi.mocked(update.downloadUpdate).mockReturnValue(new Promise(() => {}));
      render(<App />);
      await user.click(await screen.findByRole("button", { name: /^update$/i }));

      await openSettings(user);
      expect(screen.getByText(/downloading…/i, { selector: ".update-msg" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /install & restart/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /check for updates/i })).not.toBeInTheDocument();
      expect(update.downloadUpdate).toHaveBeenCalledTimes(1);
    });

    it("Settings' check reports up to date", async () => {
      const user = userEvent.setup();
      render(<App />);
      await waitFor(() => screen.getByText("All clear"));
      await openSettings(user);
      await user.click(screen.getByRole("button", { name: /check for updates/i }));
      expect(await screen.findByText("Up to date")).toBeInTheDocument();
    });
  });

  it("the hero mood follows the snapshot: calm when all is well, offline when cut off", async () => {
    const { container, unmount } = render(<App />);
    await waitFor(() => screen.getByText("All clear"));
    expect(container.querySelector(".hero")).toHaveClass("hero-ok");
    unmount();

    vi.mocked(api.getSnapshot).mockResolvedValue({ ...SNAPSHOT, overall: "red", cut_off: true });
    const second = render(<App />);
    expect(await screen.findByText("You're offline")).toBeInTheDocument();
    expect(second.container.querySelector(".hero")).toHaveClass("hero-offline");
    // No network on this machine: a refresh can't help, so the orb doesn't offer one.
    expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();
    // The Wi-Fi-off icon: three bold solid arcs that switch on in turn, a still "!" whose dot is the
    // Wi-Fi's dot, and a soft shadow (a blurred strip) cut out of the arcs around the "!".
    const wifi = second.container.querySelector(".status-orb .orb-icon");
    expect(wifi).toHaveClass("off-wifi");
    expect(wifi?.querySelectorAll(".sq1, .sq2, .sq3")).toHaveLength(3);
    expect(wifi?.querySelector("mask")).not.toBeNull();
    expect(wifi?.querySelector("filter feGaussianBlur")).not.toBeNull();
    wifi?.querySelectorAll(".sq1, .sq2, .sq3").forEach((arc) => {
      expect(arc.getAttribute("stroke-dasharray")).toBeNull();
    });
    expect(wifi?.querySelector(".orb-slash"), "no slash: the \"!\" is the mark now").toBeNull();
  });

  it("the ☰ opens Add list, Edit order and Settings, nearest first, and closes after a pick", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await waitFor(() => screen.getByText("All clear"));

    const menu = screen.getByRole("button", { name: "Menu" });
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "App actions" })).not.toBeInTheDocument();
    await user.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    const drawer = screen.getByRole("group", { name: "App actions" });
    expect(within(drawer).getAllByRole("button").map((b) => b.getAttribute("aria-label")))
      .toEqual(["Add list", "Edit order", "Settings"]);

    await user.click(within(drawer).getByRole("button", { name: "Add list" }));
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("heading", { name: /list/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(container.querySelector(".list-actions")).toBeNull();
  });

  it("Escape or a click outside closes the ☰ drawer; Escape hands focus back to the ☰", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => screen.getByText("All clear"));

    const menu = screen.getByRole("button", { name: "Menu" });
    await user.click(menu);
    await user.tab();
    expect(screen.getByRole("button", { name: "Add list" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(menu).toHaveFocus();

    await user.click(menu);
    await user.click(screen.getByText("All clear"));
    expect(menu).toHaveAttribute("aria-expanded", "false");
  });

  it("the ☰ Edit order starts ordering, shows pressed, and ends it again", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => screen.getByText("All clear"));

    await heroAction(user, "Edit order");
    expect(screen.getByRole("button", { name: /^done$/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Menu" }));
    await user.click(screen.getByRole("button", { name: "Edit order", pressed: true }));
    expect(screen.queryByRole("button", { name: /^done$/i })).not.toBeInTheDocument();
  });

  it("with no lists, the ☰ Edit order is off", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getSnapshot).mockResolvedValue({ ...SNAPSHOT, lists: [] });
    render(<App />);
    expect(await screen.findByText("Nothing to watch")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByRole("button", { name: "Edit order" })).toBeDisabled();
  });

  it("the native app menu opens Settings, Add list and Edit order, but never over an open dialog", async () => {
    let menu: (a: api.MenuAction) => void = () => {};
    vi.mocked(api.onMenuAction).mockImplementation(async (cb) => {
      menu = cb;
      return () => {};
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => screen.getByText("All clear"));

    act(() => menu("settings"));
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    act(() => menu("add-list")); // would drop pending Settings edits
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    act(() => menu("add-list"));
    expect(screen.getByRole("heading", { name: /list/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    act(() => menu("edit-order"));
    expect(screen.getByRole("button", { name: /^done$/i })).toBeInTheDocument();
    act(() => menu("edit-order")); // a second ⇧⌘O ends ordering, like the ☰ drawer's button
    expect(screen.queryByRole("button", { name: /^done$/i })).not.toBeInTheDocument();
  });

  it("each Settings card is a named group with its heading first", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => screen.getByText("All clear"));
    await heroAction(user, /^settings$/i);

    for (const name of ["Appearance", "Config", /^IP providers/, /^Probe interval/, /^Critical-list alerts/, "System"]) {
      const group = screen.getByRole("group", { name });
      expect(group.firstElementChild).toHaveClass("settings-card-title");
    }
  });

  describe("status icon (Rings / Pulse)", () => {
    // The icon is a config setting (the backend draws it in the menu bar too).
    async function renderPulse() {
      vi.mocked(api.getConfig).mockResolvedValue({ ...CONFIG, status_icon: "pulse" });
      const r = render(<App />);
      await waitFor(() => expect(r.container.querySelector(".status-orb .orb-icon-pulse")).not.toBeNull());
      return r;
    }

    it("defaults to Rings; Pulse swaps the hero orb's icon once saved", async () => {
      const user = userEvent.setup();
      const { container } = render(<App />);
      await waitFor(() => screen.getByText("All clear"));
      expect(container.querySelector(".status-orb .orb-icon")).toHaveClass("orb-icon-rings");

      await heroAction(user, /^settings$/i);
      const group = within(screen.getByRole("radiogroup", { name: "Status icon" }));
      expect(group.getByRole("radio", { name: /rings/i })).toHaveAttribute("aria-checked", "true");
      await user.click(group.getByRole("radio", { name: /pulse/i }));
      expect(group.getByRole("radio", { name: /pulse/i })).toHaveAttribute("aria-checked", "true");
      expect(container.querySelector(".status-orb .orb-icon")).toHaveClass("orb-icon-rings");

      vi.mocked(api.updateSettings).mockResolvedValue({ ...CONFIG, status_icon: "pulse" });
      await user.click(screen.getByRole("button", { name: /^save$/i }));
      await waitFor(() =>
        expect(api.updateSettings).toHaveBeenCalledWith(
          expect.objectContaining({ status_icon: "pulse", tray_filled: false }),
        ),
      );
      const orb = container.querySelector(".status-orb .orb-icon");
      expect(orb).toHaveClass("orb-icon-pulse");
      // Calm = a trace with a sweep running along it.
      expect(orb?.querySelector(".pulse-base")).not.toBeNull();
      expect(orb?.querySelector(".pulse-sweep")).not.toBeNull();
    });

    it("is one smooth gradient line with a light that runs along the wave and drags a fading tail", async () => {
      const { container } = await renderPulse();
      const icon = container.querySelector(".status-orb .orb-icon")!;
      expect(icon.querySelectorAll(".pulse-base")).toHaveLength(1); // one line, not pieces
      const base = icon.querySelector(".pulse-base")!;
      expect(base.getAttribute("stroke")).toMatch(/^url\(#.+-fade\)$/);

      // The light: a few soft dots on one group, shown only where the line is.
      const sweep = icon.querySelector(".pulse-sweep")!;
      expect(sweep.getAttribute("mask")).toMatch(/^url\(#.+-line\)$/);
      const dots = Array.from(sweep.querySelectorAll("circle"));
      expect(dots.length).toBeGreaterThanOrEqual(5);
      dots.forEach((c) => expect(c.getAttribute("fill")).toMatch(/^url\(#.+-glow\)$/));

      // Every dot rides the heartbeat's own path (so it follows the wave, not straight across) —
      // with a runway of empty air at each end, so it slides in from beyond the left end and out
      // past the right one instead of stopping on the line.
      const motions = dots.map((c) => c.querySelector("animateMotion")!);
      const line = base.getAttribute("d")!;
      motions.forEach((m) => {
        expect(m.getAttribute("path")).toContain(line.slice(1)); // the whole line, in order…
        expect(m.getAttribute("path")!.startsWith("M")).toBe(true);
        expect(m.getAttribute("path")).not.toBe(line); // …plus the runway either side
        expect(m.getAttribute("repeatCount")).toBe("indefinite");
      });
      const xs = (d: string) => Array.from(d.matchAll(/[ML](-?[\d.]+) /g)).map((x) => Number(x[1]));
      const lineX = xs(line);
      const runX = xs(motions[0].getAttribute("path")!);
      expect(runX[0]).toBeLessThan(lineX[0]); // starts left of the line
      expect(runX[runX.length - 1]).toBeGreaterThan(lineX[lineX.length - 1]); // ends right of it
      // …the tail: the dots are drawn tail-first, so each later one is the head-ward one — it is
      // brighter, bigger and starts sooner than the one before it.
      const opacity = dots.map((c) => Number(c.getAttribute("opacity")));
      const radius = dots.map((c) => Number(c.getAttribute("r")));
      const begin = motions.map((m) => parseFloat(m.getAttribute("begin")!));
      for (let i = 1; i < dots.length; i++) {
        expect(opacity[i]).toBeGreaterThan(opacity[i - 1]);
        expect(radius[i]).toBeGreaterThan(radius[i - 1]);
        expect(begin[i]).toBeLessThan(begin[i - 1]);
      }
      expect(opacity[dots.length - 1]).toBe(1);
      expect(begin[dots.length - 1]).toBe(0); // the head starts at once

      // Natural pacing: steady along the flat stretches, faster through the beat, and then it is
      // gone — it ends beyond the line and rests there, out of sight, for the rest of the cycle.
      const kp = motions[0].getAttribute("keyPoints")!.split(";").map(Number);
      const kt = motions[0].getAttribute("keyTimes")!.split(";").map(Number);
      expect(kp).toHaveLength(kt.length);
      expect(kp[0]).toBe(0);
      expect(kp[kp.length - 1]).toBe(1);
      expect(kp[kp.length - 2]).toBe(1); // it has left the line…
      expect(kt[kt.length - 2]).toBeLessThan(1); // …and then waits (the rest)
      expect(kt[kt.length - 1]).toBe(1);
      const speed = (i: number) => (kp[i + 1] - kp[i]) / (kt[i + 1] - kt[i]);
      expect(speed(1)).toBeGreaterThan(speed(0) * 1.2); // the beat is faster than the lead-in…
      expect(speed(1)).toBeGreaterThan(speed(2) * 1.2); // …and than the lead-out
      expect(speed(2)).toBeGreaterThan(speed(0) * 0.8); // which does not crawl: no slow-down at the end
      expect(speed(2)).toBeLessThan(speed(0) * 1.25);

      // The line fades at its ends (clear → solid → clear).
      const fade = Array.from(icon.querySelectorAll("linearGradient")).find((g) => g.id.endsWith("-fade"))!;
      const stops = Array.from(fade.querySelectorAll("stop")).map((st) => st.getAttribute("stop-opacity"));
      expect(stops[0]).toBe("0");
      expect(stops[stops.length - 1]).toBe("0");
      expect(stops).toContain("1");
    });

    it("gives every Pulse icon its own gradient ids (hero orb and Settings sample)", async () => {
      const user = userEvent.setup();
      const { baseElement } = await renderPulse();
      await heroAction(user, /^settings$/i);
      const ids = Array.from(baseElement.querySelectorAll("linearGradient, radialGradient, mask")).map((e) => e.id);
      expect(ids.length).toBeGreaterThan(3);
      expect(new Set(ids).size).toBe(ids.length); // no id appears twice in the document
    });

    it("with reduced motion the line stays and the glide is not rendered", async () => {
      vi.stubGlobal("matchMedia", (q: string) => ({
        matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {},
        addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null,
      }));
      const { container } = await renderPulse();
      const icon = container.querySelector(".status-orb .orb-icon")!;
      expect(icon.querySelector(".pulse-base")).not.toBeNull();
      expect(icon.querySelector(".pulse-sweep")).toBeNull();
      expect(icon.querySelector("animateMotion")).toBeNull();
      vi.unstubAllGlobals();
    });

    it("draws the alarm as a flat line with an X, and offline as the shared Wi-Fi-off icon", async () => {
      vi.mocked(api.getSnapshot).mockResolvedValue({
        ...SNAPSHOT,
        overall: "red",
        lists: [{ ...SNAPSHOT.lists[0], critical: true, all_down: true,
          services: [{ ...SNAPSHOT.lists[0].services[0], state: "down",
            endpoints: [{ id: "e1", host: "google.com", state: "down", latency_ms: null }] }] }],
      });
      const alarm = await renderPulse();
      await screen.findByText("Something’s wrong");
      const icon = alarm.container.querySelector(".status-orb .orb-icon");
      expect(icon?.querySelector(".pulse-flat")).not.toBeNull();
      expect(icon?.querySelector(".pulse-x")).not.toBeNull();
      // A soft shadow around the X fades the dashed line out near it.
      const mask = icon?.querySelector(".pulse-flat")?.getAttribute("mask") ?? "";
      expect(icon?.querySelector(mask.replace("url(", "").replace(")", ""))).not.toBeNull();
      expect(icon?.querySelectorAll("mask ellipse")).toHaveLength(2);
      alarm.unmount();

      vi.mocked(api.getSnapshot).mockResolvedValue({ ...SNAPSHOT, overall: "red", cut_off: true });
      const offline = await renderPulse();
      await screen.findByText("You're offline");
      const off = offline.container.querySelector(".status-orb .orb-icon");
      expect(off).toHaveClass("off-wifi");
      expect(off?.querySelectorAll(".sq1, .sq2, .sq3")).toHaveLength(3);
      expect(off?.querySelector(".pulse-flat")).toBeNull();
      expect(off?.querySelector(".pulse-x")).toBeNull();
    });
  });

  describe("the hero while probes are in flight", () => {
    it("re-checking one site (one row Checking, snapshot still settled) leaves the hero as it was", async () => {
      vi.mocked(api.getSnapshot).mockResolvedValue({
        ...SNAPSHOT,
        settled: true,
        lists: [
          {
            ...SNAPSHOT.lists[0],
            services: [
              SNAPSHOT.lists[0].services[0],
              { id: "s2", label: "Telegram", state: "checking", endpoints: [{ id: "e2", host: "t.me", state: "checking", latency_ms: null }] },
            ],
          },
        ],
      });
      const { container } = render(<App />);
      await screen.findByText("Telegram");
      expect(screen.getByText("All clear")).toBeInTheDocument(); // not "Checking…"
      expect(container.querySelector(".hero")).toHaveClass("hero-ok");
      expect(container.querySelector(".hero")).not.toHaveClass("hero-busy");
      expect(container.querySelector(".status-orb")).not.toHaveClass("status-orb-busy");
      expect(screen.getByText(/pinging/i)).toBeInTheDocument(); // only the row says so
    });

    it("an unsettled snapshot (a full round in flight) is busy: yellow, pulsing", async () => {
      vi.mocked(api.getSnapshot).mockResolvedValue({
        ...SNAPSHOT,
        settled: false,
        lists: [
          {
            ...SNAPSHOT.lists[0],
            services: [
              SNAPSHOT.lists[0].services[0],
              { id: "s2", label: "Telegram", state: "checking", endpoints: [{ id: "e2", host: "t.me", state: "checking", latency_ms: null }] },
            ],
          },
        ],
      });
      const { container } = render(<App />);
      await screen.findByText("Telegram");
      expect(container.querySelector(".hero")).toHaveClass("hero-busy");
      expect(container.querySelector(".status-orb")).toHaveClass("status-orb-busy");
    });
  });

  describe("menu bar icon: its own picture, or the app's, and a Filled switch", () => {
    async function openSettings() {
      const user = userEvent.setup();
      render(<App />);
      await waitFor(() => screen.getByText("All clear"));
      await heroAction(user, /^settings$/i);
      const trigger = screen.getByRole("button", { name: "Menu bar" });
      const filledBtn = screen.getByRole("checkbox", { name: "Filled menubar icons" });
      const openMenu = async () => {
        await user.click(trigger);
        return within(screen.getByRole("listbox", { name: "Menu bar" }));
      };
      return { user, trigger, filledBtn, openMenu };
    }
    const looksOf = (el: HTMLElement) =>
      new Set(
        [...el.querySelectorAll("svg.tray-icon")].map(
          (svg) => `${svg.getAttribute("data-icon")}/${svg.getAttribute("data-filled")}`,
        ),
      );

    it("is a dropdown of three pictures plus a Filled switch, the saved look shown", async () => {
      const { trigger, filledBtn, openMenu } = await openSettings();
      // Closed: the five states of the effective look (the app's Rings, not filled).
      expect(screen.queryByRole("listbox")).toBeNull();
      expect(looksOf(trigger)).toEqual(new Set(["rings/false"]));
      expect(trigger.querySelectorAll("svg.tray-icon")).toHaveLength(5);
      expect(filledBtn).not.toBeChecked();

      const menu = await openMenu();
      expect(menu.getAllByRole("option").map((o) => o.querySelector("b")?.textContent)).toEqual([
        "Same as app",
        "Pulse",
        "Rings",
      ]);
      expect(menu.getByRole("option", { name: /^Same as app/ })).toHaveAttribute("aria-selected", "true");
    });

    it("Escape closes the menu without choosing", async () => {
      const { user, openMenu } = await openSettings();
      await openMenu();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("'Same as app' follows the status icon; Pulse and Rings keep their own picture", async () => {
      const { user, openMenu } = await openSettings();
      const icons = within(screen.getByRole("radiogroup", { name: "Status icon" }));
      await user.click(icons.getByRole("radio", { name: /pulse/i }));

      const menu = await openMenu();
      expect(looksOf(menu.getByRole("option", { name: /^Same as app/ }))).toEqual(new Set(["pulse/false"]));
      expect(looksOf(menu.getByRole("option", { name: /^Pulse/ }))).toEqual(new Set(["pulse/false"]));
      expect(looksOf(menu.getByRole("option", { name: /^Rings/ }))).toEqual(new Set(["rings/false"]));
    });

    it("the Filled switch flips every look, in the box and in the menu", async () => {
      const { user, trigger, filledBtn, openMenu } = await openSettings();
      await user.click(filledBtn);
      expect(filledBtn).toBeChecked();
      expect(looksOf(trigger)).toEqual(new Set(["rings/true"]));
      const menu = await openMenu();
      expect(looksOf(menu.getByRole("option", { name: /^Pulse/ }))).toEqual(new Set(["pulse/true"]));
      await user.keyboard("{Escape}");

      await user.click(filledBtn);
      expect(filledBtn).not.toBeChecked();
      expect(looksOf(trigger)).toEqual(new Set(["rings/false"]));
    });

    it("lets the menu bar differ from the orb, and saves both with the rest of the form", async () => {
      vi.mocked(api.updateSettings).mockResolvedValue({ ...CONFIG, tray_shape: "pulse", tray_filled: true });
      const { user, filledBtn, openMenu } = await openSettings();
      const menu = await openMenu();
      await user.click(menu.getByRole("option", { name: /^Pulse/ }));
      expect(screen.queryByRole("listbox")).toBeNull();
      await user.click(filledBtn);
      expect(api.updateSettings).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: /^save$/i }));
      await waitFor(() =>
        expect(api.updateSettings).toHaveBeenCalledWith(
          // The orb stays Rings; only the menu bar is Pulse, filled.
          expect.objectContaining({ status_icon: "rings", tray_shape: "pulse", tray_filled: true }),
        ),
      );
    });

    it("choosing a picture keeps the Filled choice, and 'Same as app' goes back to following the orb", async () => {
      vi.mocked(api.getConfig).mockResolvedValue({ ...CONFIG, tray_shape: "pulse", tray_filled: true });
      vi.mocked(api.updateSettings).mockResolvedValue(CONFIG);
      const { user, filledBtn, openMenu } = await openSettings();
      expect(filledBtn).toBeChecked();
      const menu = await openMenu();
      expect(menu.getByRole("option", { name: /^Pulse/ })).toHaveAttribute("aria-selected", "true");
      await user.click(menu.getByRole("option", { name: /^Same as app/ }));
      expect(filledBtn).toBeChecked();
      await user.click(screen.getByRole("button", { name: /^save$/i }));
      await waitFor(() =>
        expect(api.updateSettings).toHaveBeenCalledWith(
          expect.objectContaining({ tray_shape: "same", tray_filled: true }),
        ),
      );
    });

    it("Cancel discards a pending choice", async () => {
      const { user, filledBtn, openMenu } = await openSettings();
      const menu = await openMenu();
      await user.click(menu.getByRole("option", { name: /^Pulse/ }));
      await user.click(filledBtn);
      await user.click(screen.getByRole("button", { name: /^cancel$/i }));
      expect(api.updateSettings).not.toHaveBeenCalled();

      await heroAction(user, /^settings$/i);
      expect(screen.getByRole("checkbox", { name: "Filled menubar icons" })).not.toBeChecked();
      await user.click(screen.getByRole("button", { name: "Menu bar" }));
      const again = within(screen.getByRole("listbox", { name: "Menu bar" }));
      expect(again.getByRole("option", { name: /^Same as app/ })).toHaveAttribute("aria-selected", "true");
    });
  });

  describe("the '?' next to the status icon", () => {
    it("shows what each state looks like for the chosen icon, and closes on Escape", async () => {
      const user = userEvent.setup();
      render(<App />);
      await waitFor(() => screen.getByText("All clear"));
      await heroAction(user, /^settings$/i);

      expect(screen.queryByRole("dialog", { name: /what each state looks like/i })).toBeNull();
      await user.click(screen.getByRole("button", { name: /what do the icons mean/i }));
      const pop = screen.getByRole("dialog", { name: /what each state looks like/i });
      expect(within(pop).getAllByText(/^(All clear|Heads up|Alarm|Offline|Checking)$/)).toHaveLength(5);
      expect(pop.querySelectorAll(".orb-icon-rings")).toHaveLength(5);

      // It follows the picker: choose Pulse and the same five states are drawn as heartbeats.
      const icons = within(screen.getByRole("radiogroup", { name: "Status icon" }));
      await user.click(icons.getByRole("radio", { name: /pulse/i }));
      expect(pop.querySelectorAll(".orb-icon-pulse")).toHaveLength(5);

      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog", { name: /what each state looks like/i })).toBeNull();
    });
  });

  // Theme + "Reset to defaults" moved from the old hero menu into Settings; same behavior.
  describe("Settings keeps the Theme and Reset to defaults controls", () => {
    it("Theme cycles System → Light → Dark", async () => {
      const user = userEvent.setup();
      render(<App />);
      await waitFor(() => screen.getByText("All clear"));
      await heroAction(user, /^settings$/i);

      await user.click(screen.getByRole("button", { name: /theme: system/i }));
      expect(screen.getByRole("button", { name: /theme: light/i })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /theme: light/i }));
      expect(screen.getByRole("button", { name: /theme: dark/i })).toBeInTheDocument();
    });

    it("Reset asks first; Cancel backs out without resetting", async () => {
      const user = userEvent.setup();
      render(<App />);
      await waitFor(() => screen.getByText("All clear"));
      await heroAction(user, /^settings$/i);

      await user.click(screen.getByRole("button", { name: /reset to defaults/i }));
      expect(screen.getByText("Reset to defaults?")).toBeInTheDocument();
      await user.click(screen.getAllByRole("button", { name: /^cancel$/i })[0]);
      expect(api.resetConfig).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: /reset to defaults/i })).toBeInTheDocument();
    });

    it("confirming the reset calls api.resetConfig", async () => {
      const user = userEvent.setup();
      vi.mocked(api.resetConfig).mockReturnValue(new Promise(() => {}));
      render(<App />);
      await waitFor(() => screen.getByText("All clear"));
      await heroAction(user, /^settings$/i);

      await user.click(screen.getByRole("button", { name: /reset to defaults/i }));
      await user.click(screen.getByRole("button", { name: /yes, reset/i }));
      expect(api.resetConfig).toHaveBeenCalledTimes(1);
    });
  });

  it("refresh button calls api.refreshNow", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => screen.getByText("All clear"));

    const refreshBtn = screen.getByRole("button", { name: /refresh/i });
    await user.click(refreshBtn);

    expect(api.refreshNow).toHaveBeenCalled();
  });

  it("settings button opens settings panel", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => screen.getByText("All clear"));

    await heroAction(user, /^settings$/i);

    expect(screen.getByRole("heading", { name: /^settings$/i })).toBeInTheDocument();
  });

  it("settings panel shows Config card with Export and Import buttons", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => screen.getByText("All clear"));

    await heroAction(user, /^settings$/i);

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

    await heroAction(user, /^settings$/i);
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

    await heroAction(user, /^settings$/i);
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
    /** Open Settings and return the slider + the three Sound checkboxes. */
    async function openAlertSettings(user: ReturnType<typeof userEvent.setup>) {
      render(<App />);
      await waitFor(() => screen.getByText("All clear"));
      await heroAction(user, /^settings$/i);
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

      // `{volume: 0, sound: true}` is a legal persisted state now — `alerts.ts::soundAudible`
      // is what keeps it honest.
      expect(api.updateSettings).toHaveBeenLastCalledWith(
        expect.objectContaining({
          notify_volume: 0,
          down_sound: true,
          up_sound: true,
          blocked_sound: true,
        }),
      );
    });
  });

  describe("list modal", () => {
    it("the Critical switch toggles and is saved with the list", async () => {
      const user = userEvent.setup();
      vi.mocked(api.addList).mockResolvedValue(CONFIG);
      render(<App />);
      await waitFor(() => screen.getByText("All clear"));

      await heroAction(user, /^add list$/i);
      const critical = screen.getByRole("switch", { name: /critical/i });
      expect(critical).toHaveAttribute("aria-checked", "false");
      await user.type(screen.getByLabelText("Name"), "Work");
      await user.click(critical);
      expect(critical).toHaveAttribute("aria-checked", "true");
      await user.click(screen.getByRole("button", { name: /^save$/i }));

      expect(api.addList).toHaveBeenCalledWith("Work", "", true);
    });

    it("Cancel closes without saving", async () => {
      const user = userEvent.setup();
      render(<App />);
      await waitFor(() => screen.getByText("All clear"));
      await heroAction(user, /^add list$/i);
      await user.click(screen.getByRole("button", { name: /^cancel$/i }));
      expect(api.addList).not.toHaveBeenCalled();
      expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    });
  });

  describe("list and row design", () => {
    const ep = (id: string, host: string, state: Snapshot["lists"][0]["services"][0]["state"]) => ({
      id,
      host,
      state,
      latency_ms: state === "up" ? 42 : null,
    });
    const snapWith = (list: Partial<Snapshot["lists"][0]>): Snapshot => ({
      ...SNAPSHOT,
      lists: [{ ...SNAPSHOT.lists[0], ...list }],
    });

    it("shows how many services are up, and the first letter as the tile", async () => {
      render(<App />);
      await waitFor(() => screen.getByText("Google"));
      expect(screen.getByText("1/1")).toBeInTheDocument();
      expect(screen.getByText("G")).toBeInTheDocument();
    });

    it("fully down, a Critical list's chip turns solid red and pulses; a normal list's only tints", async () => {
      vi.mocked(api.getSnapshot).mockResolvedValue(snapWith({ critical: true }));
      const first = render(<App />);
      await waitFor(() => screen.getByRole("img", { name: "Critical list" }));
      expect(first.container.querySelector(".list-name")).not.toHaveClass("list-name-down");
      expect(first.container.querySelector(".list-name")).not.toHaveClass("list-name-alarm");
      first.unmount();

      const down = snapWith({
        critical: true,
        all_down: true,
        services: [{ ...SNAPSHOT.lists[0].services[0], state: "down", endpoints: [ep("e1", "google.com", "down")] }],
      });
      vi.mocked(api.getSnapshot).mockResolvedValue(down);
      const second = render(<App />);
      await waitFor(() => screen.getByRole("img", { name: "Critical list is down" }));
      expect(second.container.querySelector(".list-name")).toHaveClass("list-name-down", "list-name-alarm");
      second.unmount();

      // A normal list fully down gets the soft tint only.
      vi.mocked(api.getSnapshot).mockResolvedValue({ ...down, lists: [{ ...down.lists[0], critical: false }] });
      const third = render(<App />);
      await waitFor(() => screen.getByText("All unreachable"));
      expect(third.container.querySelector(".list-name")).toHaveClass("list-name-down");
      expect(third.container.querySelector(".list-name")).not.toHaveClass("list-name-alarm");
    });

    it("a fully-down list says All unreachable in place of the count", async () => {
      vi.mocked(api.getSnapshot).mockResolvedValue(
        snapWith({
          all_down: true,
          services: [{ ...SNAPSHOT.lists[0].services[0], state: "down", endpoints: [ep("e1", "google.com", "down")] }],
        }),
      );
      render(<App />);
      expect(await screen.findByText("All unreachable")).toBeInTheDocument();
      expect(screen.queryByText("0/1")).not.toBeInTheDocument();
      // The state is also boxed on the row itself.
      expect(screen.getByText("Down")).toBeInTheDocument();
    });

    it("boxes Blocked on the row", async () => {
      vi.mocked(api.getSnapshot).mockResolvedValue(
        snapWith({
          services: [{ ...SNAPSHOT.lists[0].services[0], state: "blocked", endpoints: [ep("e1", "x.com", "blocked")] }],
        }),
      );
      render(<App />);
      expect(await screen.findByText("Blocked")).toBeInTheDocument();
    });

    it("a multi-endpoint row summarizes its endpoints and expands on click", async () => {
      const user = userEvent.setup();
      vi.mocked(api.getSnapshot).mockResolvedValue(
        snapWith({
          services: [
            {
              id: "g",
              label: "Google",
              state: "up",
              endpoints: [ep("a", "google.com", "up"), ep("b", "www.gstatic.com", "up"), ep("c", "bad.example", "down")],
            },
          ],
        }),
      );
      render(<App />);
      await waitFor(() => screen.getByText("Google"));
      expect(screen.getByTitle("2 up")).toBeInTheDocument();
      expect(screen.getByTitle("1 down")).toBeInTheDocument();
      expect(screen.queryByText("www.gstatic.com")).not.toBeInTheDocument();

      // The row (here its endpoint summary) expands the group; the name re-checks it instead.
      await user.click(screen.getByTitle("2 up"));
      expect(screen.getByText("www.gstatic.com")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /collapse endpoints/i })).toHaveAttribute("aria-expanded", "true");

      await user.click(screen.getByRole("button", { name: /collapse endpoints/i }));
      await waitFor(() => expect(screen.queryByText("www.gstatic.com")).not.toBeInTheDocument());
    });

    describe("clicking a name re-checks just that", () => {
      const group = () =>
        snapWith({
          services: [
            {
              id: "g",
              label: "Claude",
              state: "up",
              endpoints: [ep("a", "claude.ai", "up"), ep("b", "api.anthropic.com", "up"), ep("c", "console.anthropic.com", "up")],
            },
          ],
        });

      it("a single site: its name re-checks only that service", async () => {
        const user = userEvent.setup();
        render(<App />);
        await waitFor(() => screen.getByText("Google"));
        await user.click(screen.getByRole("button", { name: "Google" }));
        expect(api.checkNow).toHaveBeenCalledTimes(1);
        expect(api.checkNow).toHaveBeenCalledWith("internet", "s1", undefined);
        expect(api.refreshNow).not.toHaveBeenCalled(); // not a full refresh
      });

      it("a group: its name re-checks the whole group and does not expand it", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSnapshot).mockResolvedValue(group());
        render(<App />);
        await waitFor(() => screen.getByText("Claude"));
        const name = screen.getByRole("button", { name: "Claude" });
        expect(name).toHaveAttribute("title", "Check all 3 hosts now");

        await user.click(name);
        expect(api.checkNow).toHaveBeenCalledWith("internet", "g", undefined); // no endpoint = all
        expect(screen.queryByText("api.anthropic.com")).not.toBeInTheDocument(); // stayed collapsed
      });

      it("an opened group: a host re-checks only that host", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSnapshot).mockResolvedValue(group());
        render(<App />);
        await waitFor(() => screen.getByText("Claude"));
        await user.click(screen.getByRole("button", { name: /expand endpoints/i }));

        await user.click(screen.getByRole("button", { name: "api.anthropic.com" }));
        expect(api.checkNow).toHaveBeenCalledTimes(1);
        expect(api.checkNow).toHaveBeenCalledWith("internet", "g", "b");
        // …and the group stays open.
        expect(screen.getByText("console.anthropic.com")).toBeInTheDocument();
      });

      it("does nothing while that service is already being checked", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSnapshot).mockResolvedValue(
          snapWith({
            services: [{ ...SNAPSHOT.lists[0].services[0], state: "checking", endpoints: [ep("e1", "google.com", "checking")] }],
          }),
        );
        render(<App />);
        await waitFor(() => screen.getByText("Google"));
        await user.click(screen.getByRole("button", { name: "Google" }));
        expect(api.checkNow).not.toHaveBeenCalled();
      });

      it("a closed group shows ~average latency of the hosts that answered; open, it hides it", async () => {
        const user = userEvent.setup();
        const e = (id: string, host: string, state: "up" | "down", ms: number | null) => ({
          id, host, state, latency_ms: ms,
        });
        vi.mocked(api.getSnapshot).mockResolvedValue(
          snapWith({
            services: [
              {
                id: "g",
                label: "Claude",
                state: "down",
                endpoints: [e("a", "claude.ai", "up", 30), e("b", "api.anthropic.com", "up", 32), e("c", "console.anthropic.com", "up", 200), e("d", "old.example", "down", null)],
              },
            ],
          }),
        );
        render(<App />);
        await waitFor(() => screen.getByText("Claude"));
        const avg = screen.getByText("~87 ms"); // (30 + 32 + 200) / 3; the down host is not counted
        expect(avg).toHaveAttribute(
          "title",
          "Average of 3 of 4 hosts that answered · fastest 30 ms · slowest 200 ms",
        );

        await user.click(screen.getByRole("button", { name: /expand endpoints/i }));
        expect(screen.queryByText("~87 ms")).not.toBeInTheDocument();
        expect(screen.getByText("200 ms")).toBeInTheDocument(); // each host shows its own instead
      });

      it("a closed group with no answering host shows no average; a checking one shows Pinging…", async () => {
        const down = (id: string, host: string) => ({ id, host, state: "down" as const, latency_ms: null });
        vi.mocked(api.getSnapshot).mockResolvedValue(
          snapWith({
            services: [{ id: "g", label: "Claude", state: "down", endpoints: [down("a", "a.com"), down("b", "b.com")] }],
          }),
        );
        const first = render(<App />);
        await waitFor(() => screen.getByText("Claude"));
        expect(screen.queryByText(/~\d+ ms/)).not.toBeInTheDocument();
        first.unmount();

        vi.mocked(api.getSnapshot).mockResolvedValue(
          snapWith({
            services: [
              {
                id: "g",
                label: "Claude",
                state: "checking",
                endpoints: [{ id: "a", host: "a.com", state: "up", latency_ms: 40 }, { id: "b", host: "b.com", state: "checking", latency_ms: null }],
              },
            ],
          }),
        );
        render(<App />);
        await waitFor(() => screen.getByText(/pinging/i));
        expect(screen.queryByText(/~\d+ ms/)).not.toBeInTheDocument(); // not a stale average mid-check
      });

      it("shows Pinging… with three dots while a service is being checked", async () => {
        const { container, unmount } = render(<App />);
        await waitFor(() => screen.getByText("Google"));
        expect(screen.queryByText(/pinging/i)).not.toBeInTheDocument();
        expect(screen.getByText("20 ms")).toBeInTheDocument();
        unmount();

        vi.mocked(api.getSnapshot).mockResolvedValue(
          snapWith({
            services: [{ ...SNAPSHOT.lists[0].services[0], state: "checking", endpoints: [ep("e1", "google.com", "checking")] }],
          }),
        );
        const checking = render(<App />);
        await waitFor(() => screen.getByText(/pinging/i));
        expect(checking.container.querySelectorAll(".row .ping-dots i")).toHaveLength(3);
        expect(screen.queryByText(/ms$/)).not.toBeInTheDocument(); // the latency steps aside
        expect(container).toBeDefined();
      });

      it("in a group, Pinging… marks the group and only the host being checked", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSnapshot).mockResolvedValue(
          snapWith({
            services: [
              {
                id: "g",
                label: "Claude",
                state: "checking", // worst-wins: one host in flight makes the group "checking"
                endpoints: [ep("a", "claude.ai", "up"), ep("b", "api.anthropic.com", "checking"), ep("c", "console.anthropic.com", "up")],
              },
            ],
          }),
        );
        const { container } = render(<App />);
        await waitFor(() => screen.getByText("Claude"));
        expect(container.querySelectorAll(".row-pinging")).toHaveLength(1); // the group row

        await user.click(screen.getByRole("button", { name: /expand endpoints/i }));
        // Group row + the one host in flight; the other two hosts keep their normal look.
        expect(container.querySelectorAll(".row-pinging")).toHaveLength(2);
        const rows = Array.from(container.querySelectorAll(".endpoint-row"));
        expect(rows.map((r) => r.querySelector(".row-pinging") !== null)).toEqual([false, true, false]);
      });

      it("a group's other host can still be checked while one host is being checked", async () => {
        const user = userEvent.setup();
        const e = (id: string, host: string, state: "up" | "checking") => ({
          id, host, state, latency_ms: state === "up" ? 30 : null,
        });
        vi.mocked(api.getSnapshot).mockResolvedValue(
          snapWith({
            services: [{ id: "g", label: "Claude", state: "checking", endpoints: [e("a", "claude.ai", "up"), e("b", "api.anthropic.com", "checking")] }],
          }),
        );
        render(<App />);
        await waitFor(() => screen.getByText("Claude"));
        await user.click(screen.getByRole("button", { name: /expand endpoints/i }));

        await user.click(screen.getByRole("button", { name: "api.anthropic.com" })); // in flight: ignored
        expect(api.checkNow).not.toHaveBeenCalled();
        await user.click(screen.getByRole("button", { name: "claude.ai" })); // not in flight: allowed
        expect(api.checkNow).toHaveBeenCalledWith("internet", "g", "a");
        // The group name still works too, until every host is in flight.
        await user.click(screen.getByRole("button", { name: "Claude" }));
        expect(api.checkNow).toHaveBeenLastCalledWith("internet", "g", undefined);
      });

      it("clicking a list name while every service of it is being checked does nothing", async () => {
        const user = userEvent.setup();
        vi.mocked(api.getSnapshot).mockResolvedValue(
          snapWith({
            services: [{ ...SNAPSHOT.lists[0].services[0], state: "checking", endpoints: [ep("e1", "google.com", "checking")] }],
          }),
        );
        const { container } = render(<App />);
        await waitFor(() => screen.getByText("Google"));
        await user.click(container.querySelector(".list-name")!);
        expect(api.checkList).not.toHaveBeenCalled();
      });

      it("a failed check is reported", async () => {
        const user = userEvent.setup();
        vi.mocked(api.checkNow).mockRejectedValue("That service isn't being checked");
        render(<App />);
        await waitFor(() => screen.getByText("Google"));
        await user.click(screen.getByRole("button", { name: "Google" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("isn't being checked");
      });

      it("a list name re-checks every service of that list, and nothing else", async () => {
        const user = userEvent.setup();
        const { container } = render(<App />);
        await waitFor(() => screen.getByText("Google"));
        const chip = container.querySelector(".list-name")!;
        expect(chip.querySelector("h2")).toHaveAttribute("title", expect.stringContaining("check the whole list"));

        await user.click(chip); // anywhere on the chip, not only on the text
        expect(api.checkList).toHaveBeenCalledTimes(1);
        expect(api.checkList).toHaveBeenCalledWith("internet");
        expect(api.checkNow).not.toHaveBeenCalled();
        expect(api.refreshNow).not.toHaveBeenCalled();
      });

      it("the list name is also reachable from the keyboard", async () => {
        const user = userEvent.setup();
        render(<App />);
        await waitFor(() => screen.getByText("Google"));
        screen.getByRole("button", { name: "Internet" }).focus();
        await user.keyboard("{Enter}");
        expect(api.checkList).toHaveBeenCalledTimes(1);
      });

      it("a failed list check is reported", async () => {
        const user = userEvent.setup();
        vi.mocked(api.checkList).mockRejectedValue("That list isn't there");
        render(<App />);
        await waitFor(() => screen.getByText("Google"));
        await user.click(screen.getByRole("button", { name: "Internet" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("isn't there");
      });

      it("in reorder mode names are plain text, not buttons", async () => {
        const user = userEvent.setup();
        render(<App />);
        await waitFor(() => screen.getByText("Google"));
        expect(screen.getByRole("button", { name: "Google" })).toBeInTheDocument();
        await user.click(screen.getAllByTitle("List options")[0]);
        await user.click(screen.getByRole("button", { name: /edit order/i }));
        expect(screen.queryByRole("button", { name: "Google" })).not.toBeInTheDocument();
        expect(screen.getByText("Google")).toBeInTheDocument();
        // The list name is plain text then, too (the grip drags it).
        expect(screen.queryByRole("button", { name: "Internet" })).not.toBeInTheDocument();
        expect(screen.getByText("Internet")).toBeInTheDocument();
      });
    });

    it("opening the ⋮ menu of a multi-endpoint row does not expand it", async () => {
      const user = userEvent.setup();
      vi.mocked(api.getSnapshot).mockResolvedValue(
        snapWith({
          services: [
            {
              id: "g",
              label: "Google",
              state: "up",
              endpoints: [ep("a", "google.com", "up"), ep("b", "www.gstatic.com", "up")],
            },
          ],
        }),
      );
      render(<App />);
      await waitFor(() => screen.getByText("Google"));
      await user.click(screen.getByTitle("Service options"));
      expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
      expect(screen.queryByText("www.gstatic.com")).not.toBeInTheDocument();
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
      // The config mirrors CRIT's list: pending edges are reconciled against it (A11).
      const lists = [{
        id: "internet", name: "Internet", icon: "🌐", collapsed: false, critical: true,
        services: [],
      }];
      vi.mocked(api.getConfig).mockResolvedValue({ ...CONFIG, lists, ...config });
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

    // Re-checking one service by hand marks it Checking in a snapshot the backend still calls
    // settled (the rollups are left alone on purpose). A critical list that is fully blocked was
    // already alerted; the Checking row must not make its re-check look like a *new* block.
    it("re-checking a service of an already-blocked critical list does not alert again", async () => {
      const { sendNotification } = await import("@tauri-apps/plugin-notification");
      const handleSnapshot = await mount({ down_notify: true, blocked_notify: true });
      const onDelta = vi.mocked(api.onServiceUpdate).mock.calls[0][0];
      const blockedService = {
        ...CRIT.lists[0].services[0],
        state: "blocked" as const,
        endpoints: [{ id: "e1", host: "google.com", state: "blocked" as const, latency_ms: 40 }],
      };
      const BLOCKED: Snapshot = {
        ...CRIT,
        lists: [{ ...CRIT.lists[0], all_down: true, services: [blockedService] }],
        overall: "red",
      };
      const delta = (service: typeof blockedService | (typeof CHECKING)["lists"][0]["services"][0]) => ({
        list_id: "internet",
        service,
        list_all_down: true,
        overall: "red" as const,
        cut_off: false,
        settled: true, // the backend leaves settled alone for a one-off check
      });

      handleSnapshot(CRIT);
      handleSnapshot(BLOCKED); // the list becomes fully blocked: one alert, once the batch settles
      await settle(QUIET_MS);
      expect(sendNotification).toHaveBeenCalledTimes(1);

      onDelta(delta(CHECKING.lists[0].services[0])); // the user clicks the service: it shows Checking …
      await settle(QUIET_MS);
      onDelta(delta(blockedService)); // … and is still blocked
      await settle(QUIET_MS);
      expect(sendNotification).toHaveBeenCalledTimes(1); // no second alert
    });

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

    // A11: the held outage belongs to a list the user deleted while offline.
    it("an outage held behind a cut-off is dropped when its list is deleted meanwhile", async () => {
      const { sendNotification } = await import("@tauri-apps/plugin-notification");
      const handleSnapshot = await mount({ down_notify: true });
      handleSnapshot(CRIT);
      handleSnapshot({ ...CRIT_DOWN, cut_off: true });
      await settle(QUIET_MS);
      expect(sendNotification).toHaveBeenCalledTimes(1); // "You're offline"; outage held

      vi.spyOn(window, "confirm").mockReturnValue(true);
      // Same flags as mount(): only the list is gone, so reconcile is what keeps it quiet.
      vi.mocked(api.removeList).mockResolvedValue({ ...CONFIG, down_notify: true, lists: [] });
      fireEvent.click(screen.getByTitle("List options"));
      fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
      await act(async () => {
        await settle(0);
      });
      expect(api.removeList).toHaveBeenCalledWith("internet");

      // The next settled round still carries the list (the backend's lags the delete): no alert.
      handleSnapshot({ ...CRIT_DOWN, cut_off: false });
      await settle(QUIET_MS);
      expect(sendNotification).toHaveBeenCalledTimes(1);
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

      /** A wake nobody has observed yet: the wall clock jumps, no heartbeat tick runs. */
      function jumpClock(ms: number) {
        const fakeNow = Date.now;
        vi.spyOn(Date, "now").mockImplementation(() => fakeNow.call(Date) + ms);
      }

      // A09: the frozen flush timer can be the first callback after resume. It must not
      // describe the sleep; the grace window pays out what the batch owed, once.
      it("a flush that fires before the heartbeat after a wake waits out the grace window", async () => {
        const { sendNotification } = await import("@tauri-apps/plugin-notification");
        const handleSnapshot = await mount({ down_notify: true });
        handleSnapshot(CRIT);
        // Edge at mount time: flush due at +6000 (quiet window), heartbeat ticks at +5000, +10000.
        handleSnapshot(CRIT_DOWN);
        await settle(5_500); // the +5000 tick ran and saw no gap

        jumpClock(3_600_000);
        await settle(1_000); // the flush (+6000) runs before the next tick (+10000)
        expect(sendNotification).not.toHaveBeenCalled();

        await settle(WAKE_GRACE_MAX_MS);
        await settle(QUIET_MS);
        expect(sendNotification).toHaveBeenCalledTimes(1);
      });

      it("a snapshot that arrives first after a wake opens the grace window", async () => {
        const { sendNotification } = await import("@tauri-apps/plugin-notification");
        // up_notify: diffing the post-wake cut-off would make the recovery below an "up" edge.
        const handleSnapshot = await mount({ down_notify: true, up_notify: true });
        handleSnapshot(CRIT);

        jumpClock(3_600_000);
        handleSnapshot({ ...CRIT_DOWN, cut_off: true }); // network not up yet
        await settle(QUIET_MS);
        expect(sendNotification).not.toHaveBeenCalled();

        handleSnapshot(CRIT); // back before the window closed
        await settle(WAKE_GRACE_MAX_MS + QUIET_MS);
        expect(sendNotification).not.toHaveBeenCalled();
      });

      // A10: a cut-off with no list transition has nothing in pendingRef to re-arm on.
      it("a cut-off edge the sleep interrupted is still announced, once", async () => {
        const { sendNotification } = await import("@tauri-apps/plugin-notification");
        const handleSnapshot = await mount({ down_notify: true });
        handleSnapshot(SNAPSHOT); // non-critical only: cut-off is the sole edge

        handleSnapshot({ ...SNAPSHOT, cut_off: true });
        await sleepAndWake(3_600_000);
        expect(sendNotification).not.toHaveBeenCalled();

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

  it("a refused import closes Settings and says why", async () => {
    const { open: openMock } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(openMock).mockResolvedValue("/tmp/picked-config.json");
    vi.mocked(api.importConfig).mockRejectedValue('Invalid config file: "x" isn\'t a valid host name.');
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => screen.getByText("All clear"));

    await heroAction(user, /^settings$/i);
    await user.click(screen.getByRole("button", { name: /import/i }));
    await user.click(await screen.findByRole("button", { name: /overwrite/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid config file");
    expect(screen.queryByRole("heading", { name: /^settings$/i })).not.toBeInTheDocument();
  });

  it("Import confirmation Cancel aborts without calling importConfig", async () => {
    const { open: openMock } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(openMock).mockResolvedValue("/tmp/picked-config.json");

    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => screen.getByText("All clear"));

    await heroAction(user, /^settings$/i);
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
