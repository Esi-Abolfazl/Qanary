import type { ListStatus } from "../types";
import { ServiceRow } from "./ServiceRow";

export function ServiceList({
  list,
  onRemoveService,
  onRemoveList,
}: {
  list: ListStatus;
  onRemoveService: (listId: string, serviceId: string) => void;
  onRemoveList: (listId: string) => void;
}) {
  // Whole-list outage banner: red for intranet (critical), yellow for internet (warning).
  const banner = list.all_down ? (list.kind === "intranet" ? "critical" : "warn") : null;

  return (
    <section className="list">
      <div className="list-head">
        <h2 className="list-name">{list.name}</h2>
        <span className={`tag tag-${list.kind}`}>{list.kind}</span>
        <button className="list-remove" onClick={() => onRemoveList(list.id)} title="Remove list">
          🗑
        </button>
      </div>

      {banner && (
        <div className={`banner banner-${banner}`}>
          {banner === "critical"
            ? "All services unreachable — critical"
            : "All services unreachable"}
        </div>
      )}

      <ul className="rows">
        {list.services.map((s) => (
          <ServiceRow key={s.id} status={s} onRemove={() => onRemoveService(list.id, s.id)} />
        ))}
        {list.services.length === 0 && <li className="empty">No services yet</li>}
      </ul>
    </section>
  );
}
