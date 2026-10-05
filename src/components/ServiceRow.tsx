import { useEffect, useRef, useState } from "react";
import type { BlockCause, EndpointStatus, ServiceState, ServiceStatus } from "../types";
import { Icon } from "./Icon";
import { useCollapsible } from "./useCollapsible";
import { averageLatency, averageLatencyTitle } from "../utils/averageLatency";
import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";

/** Trailing note for an endpoint: latency when Up, "TCP only" for a wildcard's
 *  TLS-skipped Reachable, otherwise nothing. */
function endpointNote(ep: EndpointStatus | undefined): string {
  if (!ep) return "";
  if (ep.state === "reachable") return "TCP only";
  if (ep.state === "up" && ep.latency_ms != null) return `${ep.latency_ms} ms`;
  return "";
}

/** The tooltip for a dot. A CDN's block page says more than the generic "Blocked". */
const CDN_NAME: Record<BlockCause, string> = { cloudflare: "Cloudflare", akamai: "Akamai" };
const stateTitle = (state: ServiceState, cause?: BlockCause) =>
  state === "blocked" && cause
    ? `Blocked by ${CDN_NAME[cause]} — the site answered but refused your IP (a VPN or proxy often causes this)`
    : STATE_TITLE[state];

const STATE_TITLE: Record<ServiceState, string> = {
  up: "Up — server answered over HTTPS",
  reachable: "Reachable (TCP only) — wildcard zone; HTTPS not checked",
  blocked: "Blocked — TCP connected but HTTPS failed (likely interception)",
  down: "No route — TCP connect failed or timed out",
  checking: "Checking…",
};

/** Colored label for the two failure states. Up/Reachable/Checking show latency or a note instead. */
const BADGE_LABEL: Partial<Record<ServiceState, string>> = {
  blocked: "Blocked",
  down: "Down",
};

/** "Pinging…" with three dots that take turns lighting up — shown in place of the latency while a
 *  service or one of its hosts is being (re-)checked, so it is obvious something is happening. */
function Pinging() {
  return (
    <span className="row-pinging">
      Pinging
      <span className="ping-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}

/** The service's tile: its favicon, or the first letter until (or unless) the icon loads —
 *  Iran-hosted sites often have none. The status dot sits on the tile's corner. */
function ServiceAvatar({
  label,
  host,
  state,
  cause,
}: {
  label: string;
  host: string;
  state: ServiceState;
  cause?: BlockCause;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={`row-avatar${loaded ? " row-avatar-icon" : ""}`}
      data-state={state}
      title={stateTitle(state, cause)}
    >
      <span className="row-avatar-letter">{(label[0] ?? "?").toUpperCase()}</span>
      {host && !failed && (
        <img
          className="row-favicon"
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
          alt=""
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

export function ServiceRow({
  status,
  onRemove,
  onEdit,
  onCheck,
  sortRef,
  sortStyle,
  gripListeners,
  gripAttributes,
}: {
  status: ServiceStatus;
  onRemove: () => Promise<unknown>;
  onEdit: () => void;
  /** Re-check this service now — or, given an endpoint id, only that endpoint. */
  onCheck?: (endpointId?: string) => void;
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
  const { mounted: endpointsMounted, anim: endpointsAnim } = useCollapsible(expanded);

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

  const count = (state: ServiceState) =>
    status.endpoints.filter((e) => e.state === state).length;
  // Heat order: up → reachable → blocked → down (checking last).
  const counts = (["up", "reachable", "blocked", "down", "checking"] as const)
    .map((state) => ({ state, n: count(state) }))
    .filter((c) => c.n > 0);

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
  const badge = !multiEndpoint ? BADGE_LABEL[status.state] : undefined;
  // A closed group shows how fast its hosts are on average ("~45 ms"); open, each host shows its own.
  const groupSpeed = multiEndpoint && !expanded ? averageLatency(status.endpoints) : null;

  const inReorderMode = Boolean(gripListeners);

  // Clicking a name re-checks it. A click on something that is already being checked would only
  // queue a second probe for nothing — but only *that* thing counts: another host of a group can
  // still be checked while one is in flight, and the group name works until every host is.
  const canCheck = Boolean(onCheck) && !inReorderMode;
  function check(e: React.MouseEvent, endpointId?: string) {
    e.stopPropagation(); // the row's own click expands/collapses a group
    const inFlight = endpointId
      ? status.endpoints.find((x) => x.id === endpointId)?.state === "checking"
      : status.endpoints.length > 0 && status.endpoints.every((x) => x.state === "checking");
    if (!inFlight) onCheck?.(endpointId);
  }

  // The whole multi-endpoint row is the expander; the ⋮ menu and the open endpoint list
  // are not.
  function handleRowClick(e: React.MouseEvent) {
    if (!multiEndpoint || inReorderMode) return;
    if ((e.target as HTMLElement).closest(".list-menu-wrap, .endpoint-wrap")) return;
    setExpanded((x) => !x);
  }

  return (
    <li
      className={`row${multiEndpoint ? " row-multi" : ""}${expanded ? " row-open" : ""}`}
      ref={sortRef}
      style={sortStyle}
      onClick={handleRowClick}
    >
      {inReorderMode ? (
        // In reorder mode: replace the tile with a drag grip in the same left slot.
        <button
          className="row-grip-btn"
          {...gripListeners}
          {...gripAttributes}
          title="Drag to reorder"
        >
          <Icon name="grip" size={14} />
        </button>
      ) : (
        <ServiceAvatar
          label={status.label}
          host={primaryEndpoint?.host ?? ""}
          state={status.state}
          cause={status.endpoints.find((e) => e.state === "blocked")?.cause}
        />
      )}

      <div className="row-main">
        {canCheck ? (
          <button
            type="button"
            className="row-label row-check"
            title={multiEndpoint ? `Check all ${status.endpoints.length} hosts now` : "Check now"}
            onClick={(e) => check(e)}
          >
            {status.label}
          </button>
        ) : (
          <span className="row-label">{status.label}</span>
        )}
        {multiEndpoint ? (
          <span className="row-sum">
            {counts.map(({ state, n }) => (
              <span className="sc" key={state} title={`${n} ${state}`}>
                <b>{n}</b>
                <i className="sd" data-state={state} />
              </span>
            ))}
          </span>
        ) : (
          <span className="row-host">{primaryEndpoint?.host ?? ""}</span>
        )}
      </div>

      {status.state === "checking" ? (
        <Pinging />
      ) : groupSpeed ? (
        <span className="row-latency" title={averageLatencyTitle(groupSpeed, status.endpoints.length)}>
          ~{groupSpeed.mean} ms
        </span>
      ) : (
        !multiEndpoint &&
        singleLatency && (
          <span className="row-latency" data-state={primaryEndpoint?.state}>
            {singleLatency}
          </span>
        )
      )}
      {badge && (
        <span className="row-badge" data-state={status.state}>
          {badge}
        </span>
      )}

      {multiEndpoint && !inReorderMode && (
        <button
          className="list-menu-btn row-chev"
          title={expanded ? "Collapse endpoints" : "Expand endpoints"}
          aria-label={expanded ? "Collapse endpoints" : "Expand endpoints"}
          aria-expanded={expanded}
        >
          <Icon name="chevronDown" size={16} strokeWidth={2.7} />
        </button>
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
          aria-haspopup="menu"
          aria-expanded={menuOpen}
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
              <Icon name="edit" size={15} />
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
              <Icon name="x" size={15} />
              <span>Remove</span>
            </button>
          </div>
        )}
      </div>

      {multiEndpoint && endpointsMounted && (
        <div className="collapsible endpoint-wrap" data-anim={endpointsAnim}>
          <div className="collapsible-in">
            <ul className="endpoint-list">
              {status.endpoints.map((ep) => {
                const epLatency = endpointNote(ep);
                return (
                  <li key={ep.id} className="endpoint-row">
                    <i className="sd sd-big" data-state={ep.state} title={stateTitle(ep.state, ep.cause)} />
                    {canCheck ? (
                      <button
                        type="button"
                        className="row-host row-check"
                        title="Check this host now"
                        onClick={(e) => check(e, ep.id)}
                      >
                        {ep.host}
                      </button>
                    ) : (
                      <span className="row-host">{ep.host}</span>
                    )}
                    {ep.state === "checking" ? (
                      <Pinging />
                    ) : (
                      <span className="row-latency" data-state={ep.state}>{epLatency || (ep.state === "down" ? "—" : "")}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </li>
  );
}
