import { useEffect, useRef, useState } from "react";
import type { ListStatus } from "../types";
import { ServiceRow } from "./ServiceRow";
import { Icon } from "./Icon";
import * as api from "../api";
import type { GripProps } from "../App";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Thin sortable shell for service-level drag. Only mounted inside the inner DndContext
// (when reorderMode). Calls useSortable and passes grip props to ServiceRow.
function SortableRow({
  s,
  onRemove,
  onEdit,
}: {
  s: ListStatus["services"][number];
  onRemove: () => Promise<unknown>;
  onEdit: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: s.id });
  const sortStyle = { transform: CSS.Transform.toString(transform), transition };
  return (
    <ServiceRow
      status={s}
      onRemove={onRemove}
      onEdit={onEdit}
      sortRef={setNodeRef}
      sortStyle={sortStyle}
      gripListeners={listeners}
      gripAttributes={attributes}
    />
  );
}

export function ServiceList({
  list,
  reorderMode,
  onReorderServices,
  onRemoveService,
  onRemoveList,
  onEditList,
  onAddService,
  onEditService,
  // Optional sortable props passed from SortableListItem in App.tsx (list-level drag).
  sortRef,
  sortStyle,
  gripListeners,
  gripAttributes,
}: {
  list: ListStatus;
  reorderMode: boolean;
  onReorderServices: (listId: string, newIds: string[]) => void;
  onRemoveService: (listId: string, serviceId: string) => Promise<unknown>;
  onRemoveList: (listId: string) => Promise<unknown>;
  onEditList: (listId: string, name: string, icon: string, critical: boolean) => void;
  onAddService: (listId: string, listName: string) => void;
  onEditService: (listId: string, serviceId: string) => void;
} & Partial<GripProps>) {
  const banner = list.all_down;
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(list.collapsed);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // PointerSensor for inner service-level drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

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

  async function handleDelete() {
    setMenuOpen(false);
    if (!window.confirm(`Delete "${list.name}"?`)) return;
    setDeleteBusy(true);
    try {
      await onRemoveList(list.id);
    } finally {
      setDeleteBusy(false);
    }
  }

  function handleEdit() {
    setMenuOpen(false);
    onEditList(list.id, list.name, list.icon, list.critical);
  }

  function handleToggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    api.setListCollapsed(list.id, next);
  }

  function handleServiceDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = list.services.findIndex((s) => s.id === active.id);
    const newIndex = list.services.findIndex((s) => s.id === over.id);
    const reordered = arrayMove(list.services, oldIndex, newIndex);
    onReorderServices(list.id, reordered.map((s) => s.id));
  }

  const serviceRows = reorderMode ? (
    <DndContext sensors={sensors} onDragEnd={handleServiceDragEnd}>
      <SortableContext
        items={list.services.map((s) => s.id)}
        strategy={verticalListSortingStrategy}
      >
        {list.services.map((s) => (
          <SortableRow
            key={s.id}
            s={s}
            onRemove={() => onRemoveService(list.id, s.id)}
            onEdit={() => onEditService(list.id, s.id)}
          />
        ))}
        {list.services.length === 0 && (
          <li className="empty">No services yet</li>
        )}
      </SortableContext>
    </DndContext>
  ) : (
    <>
      {list.services.map((s) => (
        <ServiceRow
          key={s.id}
          status={s}
          onRemove={() => onRemoveService(list.id, s.id)}
          onEdit={() => onEditService(list.id, s.id)}
        />
      ))}
      {list.services.length === 0 && (
        <li className="empty">No services yet</li>
      )}
    </>
  );

  return (
    <section className={`list${reorderMode ? " list-reorder" : ""}`} ref={sortRef} style={sortStyle}>
      <div className="list-head">
        {/* Grip handle: visible only in reorder mode, owns the drag listeners for list-level drag. */}
        {reorderMode && (
          <button
            className="list-grip-btn"
            {...gripListeners}
            {...gripAttributes}
            title="Drag to reorder"
          >
            <Icon name="grip" size={14} />
          </button>
        )}
        <span className="list-name">
          {list.icon && <span className="list-name-icon">{list.icon}</span>}
          <h2 className="list-name-text">{list.name}</h2>
        </span>
        {!reorderMode && (
          <button
            className="list-menu-btn"
            onClick={() => onAddService(list.id, list.name)}
            title="Add service"
          >
            <Icon name="plus" />
          </button>
        )}
        {!reorderMode && (
          <div className="list-menu-wrap" ref={menuRef}>
            <button
              className="list-menu-btn"
              onClick={() => setMenuOpen((o) => !o)}
              title="List options"
            >
              <Icon name="ellipsisHorizontal" />
            </button>
            {menuOpen && (
              <div className="list-dropdown">
                <button className="list-dropdown-item" onClick={handleEdit}>
                  Edit
                </button>
                <button
                  className="list-dropdown-item list-dropdown-delete"
                  onClick={handleDelete}
                  disabled={deleteBusy}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        )}
        {!reorderMode && (
          <button
            className="list-menu-btn list-chevron-btn"
            onClick={handleToggleCollapse}
            title={collapsed ? "Expand" : "Collapse"}
          >
            <Icon name={collapsed ? "chevronDown" : "chevronUp"} />
          </button>
        )}
      </div>

      {!collapsed && (
        <>
          {banner && !reorderMode && (
            <div className="banner banner-critical">
              All services unreachable
            </div>
          )}
          <ul className="rows">
            {serviceRows}
          </ul>
        </>
      )}
    </section>
  );
}
