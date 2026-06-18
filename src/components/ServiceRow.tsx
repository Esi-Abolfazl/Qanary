import { useState } from "react";
import type { ServiceState, ServiceStatus } from "../types";

const STATE_TITLE: Record<ServiceState, string> = {
  up: "Reachable",
  blocked: "Blocked — TCP connected but HTTPS failed (likely interception)",
  down: "No route — TCP connect failed or timed out",
  checking: "Checking…",
};

export function ServiceRow({
  status,
  onRemove,
}: {
  status: ServiceStatus;
  onRemove: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const latency =
    status.state === "up" && status.latency_ms != null ? `${status.latency_ms} ms` : "";

  async function handleRemove() {
    setBusy(true);
    try {
      await onRemove();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="row">
      <span className={`dot dot-${status.state}`} title={STATE_TITLE[status.state]} />
      <img
        className="row-favicon"
        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(status.host)}&sz=32`}
        alt=""
        loading="lazy"
        onError={(e) => {
          e.currentTarget.style.visibility = "hidden";
        }}
      />
      <span className="row-label">{status.label}</span>
      <span className="row-host">{status.host}</span>
      <span className="row-latency">{latency}</span>
      <button className="row-remove" onClick={handleRemove} disabled={busy} title="Remove service">
        ×
      </button>
    </li>
  );
}
