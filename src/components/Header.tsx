import type { Severity, Snapshot } from "../types";

const SEVERITY_TEXT: Record<Severity, string> = {
  green: "All systems reachable",
  yellow: "Internet unreachable",
  red: "Intranet down — critical",
};

export function Header({
  snapshot,
  onRefresh,
}: {
  snapshot: Snapshot | null;
  onRefresh: () => void;
}) {
  const overall: Severity = snapshot?.overall ?? "green";
  const wan = snapshot?.wan ?? null;

  return (
    <header className="header">
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
      <button className="refresh" onClick={onRefresh} title="Refresh now">
        ↻
      </button>
    </header>
  );
}
