import { useEffect, useRef, useState } from "react";
import type { ServiceState, ServiceStatus } from "../types";
import { Icon } from "./Icon";

const STATE_TITLE: Record<ServiceState, string> = {
  up: "Reachable",
  blocked: "Blocked — TCP connected but HTTPS failed (likely interception)",
  down: "No route — TCP connect failed or timed out",
  checking: "Checking…",
};

export function ServiceRow({
  status,
  onRemove,
  onEdit,
}: {
  status: ServiceStatus;
  onRemove: () => Promise<unknown>;
  onEdit: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  const multiEndpoint = status.endpoints.length > 1;

  const blockedCount = status.endpoints.filter(
    (e) => e.state === "blocked",
  ).length;
  const reachedCount = status.endpoints.filter((e) => e.state === "up").length;
  const downCount = status.endpoints.filter((e) => e.state === "down").length;

  const primaryEndpoint = status.endpoints[0];

  async function handleRemove() {
    setBusy(true);
    try {
      await onRemove();
    } finally {
      setBusy(false);
    }
  }

  const singleLatency =
    !multiEndpoint &&
    status.state === "up" &&
    primaryEndpoint?.latency_ms != null
      ? `${primaryEndpoint.latency_ms} ms`
      : "";

  const faviconHost = primaryEndpoint?.host ?? "";

  return (
    <li className="row">
      <span
        className={`dot dot-${status.state}`}
        title={STATE_TITLE[status.state]}
      />
      <img
        className="row-favicon"
        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(faviconHost)}&sz=32`}
        alt=""
        loading="lazy"
        onError={(e) => {
          e.currentTarget.style.visibility = "hidden";
        }}
      />
      <span className="row-label">{status.label}</span>

      {multiEndpoint ? (
        <>
          <button
            className="row-endpoint-count"
            onClick={() => setExpanded((x) => !x)}
            title={expanded ? "Collapse endpoints" : "Expand endpoints"}
          >
            <span>
              {reachedCount > 0 ? (
                <span>
                  {" "}
                  · {reachedCount} <span className="dot dot-small dot-up" />
                </span>
              ) : (
                <></>
              )}
              {blockedCount > 0 ? (
                <span>
                  {" "}
                  · {blockedCount}{" "}
                  <span className="dot dot-small dot-blocked" />
                </span>
              ) : (
                <></>
              )}
              {downCount > 0 ? (
                <span>
                  {" "}
                  · {downCount} <span className="dot dot-small dot-down" />
                </span>
              ) : (
                <></>
              )}
            </span>
            <Icon name={expanded ? "chevronUp" : "chevronDown"} size={14} />
          </button>
        </>
      ) : (
        <>
          <span className="row-host">{primaryEndpoint?.host ?? ""}</span>
          <span className="row-latency">{singleLatency}</span>
        </>
      )}

      <div className="list-menu-wrap" ref={menuRef}>
        <button
          className="list-menu-btn"
          onClick={() => setMenuOpen((o) => !o)}
          title="Service options"
        >
          <Icon name="more" />
        </button>
        {menuOpen && (
          <div className="list-dropdown">
            <button
              className="list-dropdown-item"
              onClick={() => {
                setMenuOpen(false);
                onEdit();
              }}
            >
              <Icon name="edit" size={14} />
              <span>Edit</span>
            </button>
            <button
              className="list-dropdown-item list-dropdown-delete"
              onClick={() => {
                setMenuOpen(false);
                handleRemove();
              }}
              disabled={busy}
            >
              <Icon name="x" size={14} />
              <span>Remove</span>
            </button>
          </div>
        )}
      </div>

      {multiEndpoint && expanded && (
        <ul className="endpoint-list">
          {status.endpoints.map((ep) => {
            const epLatency =
              ep.state === "up" && ep.latency_ms != null
                ? `${ep.latency_ms} ms`
                : "";
            return (
              <li key={ep.id} className="endpoint-row">
                <span
                  className={`dot dot-${ep.state}`}
                  title={STATE_TITLE[ep.state]}
                />
                <span className="row-host">{ep.host}</span>
                <span className="row-latency">{epLatency}</span>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
