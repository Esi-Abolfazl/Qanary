import { useEffect, useRef, useState } from "react";
import type { Severity, Snapshot } from "../types";
import { Icon } from "./Icon";

const SEVERITY_TEXT: Record<Severity, string> = {
  green: "All systems reachable",
  red: "Services unreachable",
};

export function Header({
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  // Spin whenever a probe is in flight — covers both startup probe and manual
  // refresh, since both push a snapshot with services in the `checking` state.
  // null snapshot = first probe hasn't reported yet.
  const refreshBusy =
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
    <header className="header">
      <div className="header-menu-wrap" ref={menuRef}>
        <button
          className="header-menu-btn"
          onClick={() => setMenuOpen((o) => !o)}
          title="Menu"
          aria-haspopup="true"
          aria-expanded={menuOpen}
        >
          <Icon name="menu" />
        </button>
        {menuOpen && (
          <div className="header-dropdown">
            {confirmReset ? (
              <>
                <div className="header-dropdown-confirm-label">Reset to defaults?</div>
                <button
                  className="header-dropdown-item header-dropdown-danger"
                  onClick={handleReset}
                  disabled={resetBusy}
                >
                  Yes, reset
                </button>
                <button
                  className="header-dropdown-item"
                  onClick={() => setConfirmReset(false)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button className="header-dropdown-item" onClick={() => pick(onAddList)}>
                  Add list
                </button>
                <button className="header-dropdown-item" onClick={() => pick(onOpenSettings)}>
                  Settings
                </button>
                <div className="header-dropdown-divider" />
                <button
                  className="header-dropdown-item header-dropdown-danger"
                  onClick={() => setConfirmReset(true)}
                >
                  Reset to defaults
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <div className={`light light-${overall}`} aria-label={`status: ${overall}`} />
      <div className="header-main">
        <div className="header-title">Qanary</div>
        <div className="header-sub">{SEVERITY_TEXT[overall]}</div>
      </div>
      <div className="wan" title={wan ? `${wan.country_name} (${wan.country_code})` : "WAN unknown"}>
        {wan ? (
          <>
            <span className="flag">{wan.flag_emoji || "🏳️"}</span>
            <div className="wan-text">
              <span className="wan-cc">{wan.country_code || "??"}</span>
              <span className="wan-ip">{wan.ip}</span>
            </div>
          </>
        ) : (
          <span className="wan-ip">—</span>
        )}
      </div>
      <button
        className="refresh"
        onClick={onRefresh}
        disabled={refreshBusy}
        title="Refresh now"
      >
        <Icon name="refresh" className={refreshBusy ? "spin" : ""} />
      </button>
    </header>
  );
}
