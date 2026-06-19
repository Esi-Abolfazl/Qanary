import { useEffect, useRef, useState } from "react";
import type { Severity, Snapshot } from "../types";
import { Icon } from "./Icon";
import { useTheme, type ThemeMode } from "../theme";

// Calm vs urgent microcopy, keyed by Severity. One place so tone stays
// consistent (and is easy to localize later).
function severityCopy(
  overall: Severity,
  failingList: string | null,
): { head: string; sub: string } {
  if (overall === "green")
    return { head: "All clear", sub: "Everything’s reachable." };
  return {
    head: "Something’s wrong",
    sub: failingList
      ? `${failingList} is fully unreachable.`
      : "Some services are unreachable.",
  };
}

const THEME_ICON: Record<ThemeMode, "sun" | "moon" | "monitor"> = {
  light: "sun",
  dark: "moon",
  system: "monitor",
};
const THEME_LABEL: Record<ThemeMode, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

/** The canary "egg": a rounded pill holding the Severity dot. Heartbeat-pulses
 *  on alarm. The one primitive that will shrink to the widget/tray later. */
function BrandMark({ severity, pulse }: { severity: Severity; pulse: boolean }) {
  return (
    <span className={`brandmark brandmark-${severity}`}>
      <span className={`brandmark-dot${pulse ? " brandmark-pulse" : ""}`} />
    </span>
  );
}

export function StatusHero({
  snapshot,
  onRefresh,
  onAddList,
  onOpenSettings,
  onResetConfig,
}: {
  snapshot: Snapshot | null;
  onRefresh: () => Promise<void>;
  onAddList: () => void;
  onOpenSettings: () => void;
  onResetConfig: () => void;
}) {
  const overall: Severity = snapshot?.overall ?? "green";
  const wan = snapshot?.wan ?? null;
  const failingList =
    snapshot?.lists.find((l) => l.all_down)?.name ?? null;
  const copy = severityCopy(overall, failingList);

  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [theme, cycleTheme] = useTheme();
  // Spin/pulse while any probe is in flight (startup or manual refresh).
  const busy =
    snapshot === null ||
    snapshot.lists.some((l) => l.services.some((s) => s.state === "checking"));
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setConfirmReset(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  function pick(action: () => void) {
    setMenuOpen(false);
    setConfirmReset(false);
    action();
  }

  function handleReset() {
    setResetBusy(true);
    pick(onResetConfig);
  }

  return (
    <header className={`hero hero-${overall}`}>
      <div className="hero-bar">
        <div className="hero-menu-wrap" ref={menuRef}>
          <button
            className="icon-btn"
            onClick={() => setMenuOpen((o) => !o)}
            title="Menu"
            aria-haspopup="true"
            aria-expanded={menuOpen}
          >
            <Icon name="menu" />
          </button>
          {menuOpen && (
            <div className="menu-dropdown">
              {confirmReset ? (
                <>
                  <div className="menu-confirm-label">Reset to defaults?</div>
                  <button
                    className="menu-item menu-danger"
                    onClick={handleReset}
                    disabled={resetBusy}
                  >
                    Yes, reset
                  </button>
                  <button
                    className="menu-item"
                    onClick={() => setConfirmReset(false)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button className="menu-item" onClick={() => pick(onAddList)}>
                    <Icon name="plus" size={14} />
                    <span>Add list</span>
                  </button>
                  <button
                    className="menu-item"
                    onClick={() => pick(onOpenSettings)}
                  >
                    <Icon name="monitor" size={14} />
                    <span>Settings</span>
                  </button>
                  <button
                    className="menu-item"
                    onClick={() => cycleTheme()}
                    title="Cycle theme"
                  >
                    <Icon name={THEME_ICON[theme]} size={14} />
                    <span>Theme: {THEME_LABEL[theme]}</span>
                  </button>
                  <div className="menu-divider" />
                  <button
                    className="menu-item menu-danger"
                    onClick={() => setConfirmReset(true)}
                  >
                    <Icon name="x" size={14} />
                    <span>Reset to defaults</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <button
          className="icon-btn"
          onClick={onRefresh}
          disabled={busy}
          title="Refresh now"
        >
          <Icon name="refresh" className={busy ? "spin" : ""} />
        </button>
      </div>

      <div className="hero-center">
        <BrandMark severity={overall} pulse={overall === "red" || busy} />
        <div className="hero-copy">
          <div className="hero-headline">{copy.head}</div>
          <div className="hero-sub">{copy.sub}</div>
        </div>
      </div>

      <div
        className="wan"
        title={wan ? `${wan.country_name} (${wan.country_code})` : "WAN unknown"}
      >
        {wan ? (
          <>
            <span className="flag">{wan.flag_emoji || "🏳️"}</span>
            <span className="wan-cc">{wan.country_code || "??"}</span>
            <span className="wan-ip">{wan.ip}</span>
          </>
        ) : (
          <span className="wan-ip">—</span>
        )}
      </div>
    </header>
  );
}
