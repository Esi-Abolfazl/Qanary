// Dev-only stand-in for the Tauri backend, so the frontend runs in a plain browser: `pnpm dev`, then
// open http://localhost:1420/?mock (Work and "Empty" down), /?mock=ok (only the healthy lists: all
// clear), /?mock=down (Iran, a normal list, down too), /?mock=critical (Global, a Critical list, down
// too) or /?mock=offline (cut off: all down).
// main.tsx loads it only under `import.meta.env.DEV`, so it never reaches a release bundle.
// The e2e suite uses this same shim: it sets `window.__MOCK__` with its own data, then opens /?mock.
// Every invoke is recorded in `window.__INVOKED_CMDS__`; `window.__LISTENERS__` maps an event name
// to its callback id, so a test can push an event the way the backend would.
import type { Config, EndpointStatus, ListStatus, ServiceState, ServiceStatus, Snapshot } from "../types";

const ep = (host: string, state: ServiceState, latency_ms: number | null = null): EndpointStatus => ({
  id: host,
  host,
  state,
  latency_ms,
});
const svc = (label: string, endpoints: EndpointStatus[]): ServiceStatus => {
  const rank: ServiceState[] = ["down", "blocked", "checking", "reachable", "up"];
  const state = rank.find((r) => endpoints.some((e) => e.state === r)) ?? "up";
  return { id: label.toLowerCase(), label, state, endpoints };
};
const list = (name: string, icon: string, critical: boolean, services: ServiceStatus[]): ListStatus => ({
  id: name.toLowerCase(),
  name,
  icon,
  services,
  all_down: services.length > 0 && services.every((s) => s.state === "down"),
  collapsed: false,
  critical,
});

function scenario(kind: string): Snapshot {
  const offline = kind === "offline"; // nothing reachable at all: cut off
  const globalDown = kind === "critical" || offline;
  const iranDown = kind === "down" || offline;
  // `ms` when the host answers, Down when its list is the one taken out.
  const at = (host: string, ms: number, out: boolean, state: ServiceState = "up") =>
    out ? ep(host, "down") : ep(host, state, state === "up" ? ms : null);
  const lists = [
    // Global and Work are Critical lists, Iran is a normal one.
    list("Global", "🌍", true, [
      svc("Google", [at("google.ir", 0, globalDown, "blocked")]),
      svc("Telegram", [at("telegram.org", 1540, globalDown)]),
      svc("X", [at("x.com", 1484, globalDown)]),
      svc("Claude", [at("claude.ai", 1180, globalDown), at("api.anthropic.com", 1290, globalDown), at("anthropic.com", 1235, globalDown)]),
      svc("ChatGPT", [at("chatgpt.com", 1308, globalDown)]),
      svc("Cursor", [
        at("cursor.com", 1353, globalDown),
        at("api2.cursor.sh", 1659, globalDown),
        at("*.api5.cursor.sh", 0, globalDown, "reachable"),
        at("downloads.cursor.com", 1614, globalDown),
      ]),
    ]),
    // Always fully down (a Critical list), so every scenario but ok shows the red pulsing chip.
    list("Work", "💼", true, [svc("GitHub", [ep("github.com", "down")])]),
    list("Iran", "🇮🇷", false, [
      svc("Torob", [at("torob.ir", 1301, iranDown)]),
      svc("Divar", [at("divar.ir", 1606, iranDown)]),
      svc("Digikala", [at("digikala.com", 1295, iranDown)]),
      svc("Snapp", [at("snapp.ir", 1233, iranDown)]),
    ]),
    // Always fully down (a normal list), so every scenario but ok shows the plain All unreachable state.
    list("Empty", "", false, [
      svc("Router", [ep("192.168.1.1", "down")]),
      svc("NAS", [ep("nas.local", "down")]),
      svc("Printer", [ep("printer.local", "down")]),
    ]),
  ];
  if (kind === "ok") lists.splice(0, lists.length, ...lists.filter((l) => !l.all_down));
  return {
    lists,
    // A Critical list fully down is red; any other list fully down is yellow (warn).
    overall: lists.some((l) => l.all_down && l.critical) ? "red" : lists.some((l) => l.all_down) ? "yellow" : "green",
    wan: { ip: "185.203.116.15", country_code: "BG", country_name: "Bulgaria", flag_emoji: "🇧🇬" },
    cut_off: offline,
    settled: true,
  };
}

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
  notify_volume: 70,
  hide_dock: false,
  status_icon: "pulse",
  tray_filled: true,
  tray_shape: "same",
  last_changelog_version: null,
};

type MockWindow = Window & {
  __MOCK__?: { snap: Snapshot; cfg: Config };
  __INVOKED_CMDS__: string[];
  __LISTENERS__: Record<string, number>;
  __TAURI_INTERNALS__: unknown;
  __TAURI_EVENT_PLUGIN_INTERNALS__: unknown;
};

const w = window as unknown as MockWindow;
const { snap, cfg } = w.__MOCK__ ?? {
  snap: scenario(new URLSearchParams(location.search).get("mock") ?? ""),
  cfg: CONFIG,
};
const callbacks = new Map<number, (data: unknown) => void>();
let nextId = 1;

w.__INVOKED_CMDS__ = [];
w.__LISTENERS__ = {};
w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
w.__TAURI_INTERNALS__ = {
  transformCallback: (cb: (data: unknown) => void, once = false) => {
    const id = nextId++;
    callbacks.set(id, (data) => {
      if (once) callbacks.delete(id);
      cb(data);
    });
    return id;
  },
  unregisterCallback: (id: number) => callbacks.delete(id),
  runCallback: (id: number, data: unknown) => callbacks.get(id)?.(data),
  callbacks,
  invoke: async (cmd: string, args?: { event?: string; handler?: number }) => {
    w.__INVOKED_CMDS__.push(cmd);
    switch (cmd) {
      case "plugin:event|listen":
        w.__LISTENERS__[args!.event!] = args!.handler!;
        return args!.handler;
      case "get_snapshot":
        return snap;
      case "get_config":
      case "set_list_collapsed":
      case "reorder_lists":
      case "reorder_services":
      case "add_services":
      case "update_service":
      case "remove_service":
      case "add_list":
      case "update_list":
      case "remove_list":
      case "reset_config":
      case "update_settings":
      case "import_config":
        return cfg;
      default:
        return null;
    }
  },
};
