import { useEffect, useRef, useState } from "react";
import type { EndpointStatus, ServiceState, ServiceStatus } from "../types";
import { Icon } from "./Icon";
import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";

/** Trailing note for an endpoint: latency when Up, "TCP only" for a wildcard's
 *  TLS-skipped Reachable, otherwise nothing. */
function endpointNote(ep: EndpointStatus | undefined): string {
  if (!ep) return "";
  if (ep.state === "reachable") return "TCP only";
  if (ep.state === "up" && ep.latency_ms != null) return `${ep.latency_ms} ms`;
  return "";
}

const STATE_TITLE: Record<ServiceState, string> = {
  up: "Up — server answered over HTTPS",
  reachable: "Reachable (TCP only) — wildcard zone; HTTPS not checked",
  blocked: "Blocked — TCP connected but HTTPS failed (likely interception)",
  down: "No route — TCP connect failed or timed out",
  checking: "Checking…",
};

export function ServiceRow({
  status,
  onRemove,
  onEdit,
  sortRef,
  sortStyle,
  gripListeners,
  gripAttributes,
}: {
  status: ServiceStatus;
  onRemove: () => Promise<unknown>;
  onEdit: () => void;
  sortRef?: (node: HTMLLIElement | null) => void;
  sortStyle?: React.CSSProperties;
  gripListeners?: DraggableSyntheticListeners;
  gripAttributes?: DraggableAttributes;
}) {
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuUp, setMenuUp] = useState(false);
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
  const tcpOnlyCount = status.endpoints.filter(
    (e) => e.state === "reachable",
  ).length;
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

  // Latency for a confirmed Up; for a wildcard's TCP-only Reachable, a note instead
  // (no HTTPS leg ran, so there's no full-path latency to show).
  const singleLatency = !multiEndpoint ? endpointNote(primaryEndpoint) : "";

  const faviconHost = primaryEndpoint?.host ?? "";

  const inReorderMode = Boolean(gripListeners);

  return (
    <li className="row" ref={sortRef} style={sortStyle}>
      {inReorderMode ? (
        // In reorder mode: replace the status dot with a drag grip in the same left slot.
        <button
          className="row-grip-btn"
          {...gripListeners}
          {...gripAttributes}
          title="Drag to reorder"
        >
          <Icon name="grip" size={14} />
        </button>
      ) : (
        <span
          className={`dot dot-${status.state}`}
          title={STATE_TITLE[status.state]}
        />
      )}
      <img
        className="row-favicon"
        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(faviconHost)}&sz=64`}
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
              {tcpOnlyCount > 0 ? (
                <span>
                  {" "}
                  · {tcpOnlyCount}{" "}
                  <span className="dot dot-small dot-reachable" />
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
          onClick={(e) => {
            if (menuOpen) { setMenuOpen(false); return; }
            const btn = e.currentTarget;
            const sec = btn.closest("section");
            const scroller = sec?.parentElement;
            const limit = scroller
              ? scroller.getBoundingClientRect().bottom
              : window.innerHeight;
            setMenuUp(btn.getBoundingClientRect().bottom + 88 > limit);
            setMenuOpen(true);
          }}
          title="Service options"
        >
          <Icon name="ellipsisVertical" />
        </button>
        {menuOpen && (
          <div className={`list-dropdown${menuUp ? " list-dropdown-up" : ""}`}>
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
            const epLatency = endpointNote(ep);
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
