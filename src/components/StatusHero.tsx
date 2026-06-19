import React, { useEffect, useRef, useState } from "react";
import type { Severity, Snapshot } from "../types";
import type { UpdatePhase } from "../App";
import { Canary } from "./Canary";
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
  if (overall === "yellow")
    return {
      head: "Heads up",
      sub: failingList
        ? `${failingList} is fully unreachable.`
        : "A list is fully unreachable.",
    };
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

/** The canary "egg" — status badge + refresh button in one.
 *  During busy: double ping rings + core breathes; hover shows refresh icon.
 *  On alarm (not busy): core heartbeats. */
function StatusButton({
  severity,
  busy,
  onClick,
}: {
  severity: Severity;
  busy: boolean;
  onClick: () => void;
}) {
  const coreClass = `status-btn-dot${busy ? " qbreathe" : severity === "red" ? " qhb" : ""}`;
  return (
    <button
      className={`status-btn status-btn-${severity}`}
      onClick={onClick}
      disabled={busy}
      title="Refresh now"
      aria-label="Refresh"
    >
      <span className="status-btn-inner">
        {busy && (
          <>
            <span className="status-btn-ping" />
            <span className="status-btn-ping" />
          </>
        )}
        <span className={coreClass} />
      </span>
      <span className="status-btn-hover-icon" aria-hidden="true">
        <Icon name="refresh" size={16} />
      </span>
    </button>
  );
}

export function StatusHero({
  snapshot,
  onRefresh,
  onAddList,
  onOpenSettings,
  onResetConfig,
  updatePhase,
  downloadProgress,
  onDownload,
  onInstall,
}: {
  snapshot: Snapshot | null;
  onRefresh: () => Promise<void>;
  onAddList: () => void;
  onOpenSettings: () => void;
  onResetConfig: () => void;
  updatePhase: UpdatePhase | null;
  downloadProgress: number;
  onDownload: () => void;
  onInstall: () => void;
}) {
  const overall: Severity = snapshot?.overall ?? "green";
  const wan = snapshot?.wan ?? null;
  const failingList = snapshot?.lists.find((l) => l.all_down)?.name ?? null;
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

        <StatusButton severity={overall} busy={busy} onClick={onRefresh} />
      </div>

      <div className="hero-center">
        <span className="logo-mark">
          <Canary size={50} />
        </span>
        <div className="hero-copy">
          <div className="hero-headline">{copy.head}</div>
          <div className="hero-sub">{copy.sub}</div>
        </div>
      </div>

      <div className="hero-footer">
        <div
          className="wan"
          title={
            wan ? `${wan.country_name} (${wan.country_code})` : "WAN unknown"
          }
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

        {updatePhase === "available" && (
          <button className="update-btn" onClick={onDownload}>
            Update
          </button>
        )}
        {updatePhase === "downloading" && (
          <button
            className="update-btn update-btn-progress"
            disabled
            style={{ "--pct": `${downloadProgress}%` } as React.CSSProperties}
          >
            Downloading…
          </button>
        )}
        {updatePhase === "ready" && (
          <button className="update-btn update-btn-ready" onClick={onInstall}>
            Restart
          </button>
        )}
      </div>
    </header>
  );
}
