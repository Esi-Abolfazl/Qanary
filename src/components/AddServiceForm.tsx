import { useEffect, useState } from "react";
import type { ListKind } from "../types";
import { parseHost } from "../utils/parseHost";

/** Minimal {id,name} needed to populate the target-list dropdown. */
interface ListRef {
  id: string;
  name: string;
}

export function AddServiceForm({
  lists,
  onAdd,
  onAddList,
}: {
  lists: ListRef[];
  onAdd: (listId: string, label: string, host: string, port?: number) => void;
  onAddList: (name: string, kind: ListKind) => void;
}) {
  const [listId, setListId] = useState("");
  const [label, setLabel] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");

  const [newListName, setNewListName] = useState("");
  const [newListKind, setNewListKind] = useState<ListKind>("internet");

  // Keep a valid list selected as lists load/change.
  useEffect(() => {
    if (!lists.some((l) => l.id === listId)) {
      setListId(lists[0]?.id ?? "");
    }
  }, [lists, listId]);

  const submitService = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanHost = parseHost(host);
    if (!listId || !cleanHost) return;
    const parsedPort = port.trim() ? Number(port) : undefined;
    onAdd(listId, label.trim() || cleanHost, cleanHost, parsedPort);
    setLabel("");
    setHost("");
    setPort("");
  };

  const submitList = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newListName.trim();
    if (!name) return;
    onAddList(name, newListKind);
    setNewListName("");
  };

  return (
    <footer className="add-area">
      <form className="add-service" onSubmit={submitService}>
        <select value={listId} onChange={(e) => setListId(e.target.value)}>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <input
          placeholder="Label (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <input
          placeholder="host (e.g. github.com)"
          value={host}
          onChange={(e) => setHost(e.target.value)}
        />
        <input
          className="port"
          placeholder="443"
          value={port}
          onChange={(e) => setPort(e.target.value)}
        />
        <button type="submit">Add service</button>
      </form>

      <form className="add-list" onSubmit={submitList}>
        <input
          placeholder="New list name"
          value={newListName}
          onChange={(e) => setNewListName(e.target.value)}
        />
        <select value={newListKind} onChange={(e) => setNewListKind(e.target.value as ListKind)}>
          <option value="internet">internet</option>
          <option value="intranet">intranet</option>
        </select>
        <button type="submit">Add list</button>
      </form>
    </footer>
  );
}
