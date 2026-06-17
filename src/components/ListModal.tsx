import { useEffect, useState } from "react";

export function ListModal({
  mode,
  initial,
  onSave,
  onClose,
}: {
  mode: "add" | "edit";
  initial: { name: string; icon: string };
  onSave: (name: string, icon: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [icon, setIcon] = useState(initial.icon);

  // Re-seed when the modal opens for a different list.
  useEffect(() => {
    setName(initial.name);
    setIcon(initial.icon);
  }, [initial.name, initial.icon]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSave(name.trim(), icon.trim());
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{mode === "add" ? "Add list" : "Edit list"}</h3>
        <form onSubmit={handleSubmit} className="modal-form">
          <div className="modal-row">
            <input
              className="modal-icon-input"
              placeholder="🌐"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              maxLength={4}
              aria-label="Icon"
            />
            <input
              className="modal-name-input"
              placeholder="List name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              aria-label="Name"
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="modal-cancel" onClick={onClose}>Cancel</button>
            <button type="submit" className="modal-save">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}
