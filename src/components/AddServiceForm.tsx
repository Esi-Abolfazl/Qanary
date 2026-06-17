import { useEffect, useState } from "react";
import { parseHost } from "../utils/parseHost";

interface ListRef {
  id: string;
  name: string;
  icon: string;
}

export function AddServiceForm({
  lists,
  onAdd,
}: {
  lists: ListRef[];
  onAdd: (listId: string, label: string, host: string, port?: number) => void;
}) {
  const [listId, setListId] = useState("");
  const [label, setLabel] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");

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

  return (
    <footer className="add-area">
      <form className="add-service" onSubmit={submitService}>
        <select value={listId} onChange={(e) => setListId(e.target.value)}>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.icon ? `${l.icon} ${l.name}` : l.name}
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
    </footer>
  );
}
