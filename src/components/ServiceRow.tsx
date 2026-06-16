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
  onRemove: () => void;
}) {
  const latency =
    status.state === "up" && status.latency_ms != null ? `${status.latency_ms} ms` : "";

  return (
    <li className="row">
      <span className={`dot dot-${status.state}`} title={STATE_TITLE[status.state]} />
      <span className="row-label">{status.label}</span>
      <span className="row-host">{status.host}</span>
      <span className="row-latency">{latency}</span>
      <button className="row-remove" onClick={onRemove} title="Remove service">
        ×
      </button>
    </li>
  );
}
