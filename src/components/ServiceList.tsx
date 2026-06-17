import { useEffect, useRef, useState } from "react";
import type { ListStatus } from "../types";
import { ServiceRow } from "./ServiceRow";
import * as api from "../api";

export function ServiceList({
  list,
  onRemoveService,
  onRemoveList,
  onEditList,
  onAddService,
}: {
  list: ListStatus;
  onRemoveService: (listId: string, serviceId: string) => void;
  onRemoveList: (listId: string) => void;
  onEditList: (listId: string, name: string, icon: string) => void;
  onAddService: (listId: string, listName: string) => void;
}) {
  const banner = list.all_down;
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(list.collapsed);
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

  function handleDelete() {
    setMenuOpen(false);
    if (window.confirm(`Delete "${list.name}"?`)) {
      onRemoveList(list.id);
    }
  }

  function handleEdit() {
    setMenuOpen(false);
    onEditList(list.id, list.name, list.icon);
  }

  function handleToggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    api.setListCollapsed(list.id, next);
  }

  return (
    <section className="list">
      <div className="list-head">
        <h2 className="list-name">
          {list.icon && <span className="list-icon">{list.icon}</span>}
          {list.name}
        </h2>
        <button
          className="list-menu-btn"
          onClick={() => onAddService(list.id, list.name)}
          title="Add service"
        >
          +
        </button>
        <div className="list-menu-wrap" ref={menuRef}>
          <button
            className="list-menu-btn"
            onClick={() => setMenuOpen((o) => !o)}
            title="List options"
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="list-dropdown">
              <button className="list-dropdown-item" onClick={handleEdit}>Edit</button>
              <button className="list-dropdown-item list-dropdown-delete" onClick={handleDelete}>
                Delete
              </button>
            </div>
          )}
        </div>
        <button
          className="list-menu-btn list-chevron-btn"
          onClick={handleToggleCollapse}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "v" : "^"}
        </button>
      </div>

      {!collapsed && (
        <>
          {banner && (
            <div className="banner banner-critical">All services unreachable</div>
          )}
          <ul className="rows">
            {list.services.map((s) => (
              <ServiceRow key={s.id} status={s} onRemove={() => onRemoveService(list.id, s.id)} />
            ))}
            {list.services.length === 0 && <li className="empty">No services yet</li>}
          </ul>
        </>
      )}
    </section>
  );
}
