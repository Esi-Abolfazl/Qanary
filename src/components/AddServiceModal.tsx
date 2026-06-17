import { useState } from "react";
import { splitHostPort } from "../utils/parseHost";

export function AddServiceModal({
  listName,
  onAdd,
  onClose,
}: {
  listName: string;
  onAdd: (label: string, host: string, port: number | undefined) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState("");
  const [host, setHost] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { host: cleanHost, port } = splitHostPort(host);
    if (!cleanHost) return;
    onAdd(label.trim() || cleanHost, cleanHost, port);
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Add service to {listName}</h3>
        <form onSubmit={handleSubmit} className="modal-form">
          <div className="modal-row">
            <input
              className="modal-name-input"
              placeholder="Label (optional)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              aria-label="Label"
            />
          </div>
          <div className="modal-row">
            <input
              className="modal-name-input"
              placeholder="github.com  or  github.com:8080"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              autoFocus
              aria-label="Host"
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="modal-cancel" onClick={onClose}>Cancel</button>
            <button type="submit" className="modal-save">Add</button>
          </div>
        </form>
      </div>
    </div>
  );
}
