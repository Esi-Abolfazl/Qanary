import { useEffect, useState } from "react";

export function ListModal({
  mode,
  initial,
  onSave,
  onClose,
}: {
  mode: "add" | "edit";
  initial: { name: string; icon: string; critical: boolean };
  onSave: (name: string, icon: string, critical: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [icon, setIcon] = useState(initial.icon);
  const [critical, setCritical] = useState(initial.critical);
  const [busy, setBusy] = useState(false);

  // Re-seed when the modal opens for a different list.
  useEffect(() => {
    setName(initial.name);
    setIcon(initial.icon);
    setCritical(initial.critical);
  }, [initial.name, initial.icon, initial.critical]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onSave(name.trim(), icon.trim(), critical);
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
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
              disabled={busy}
            />
            <input
              className="modal-name-input"
              placeholder="List name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              aria-label="Name"
              disabled={busy}
            />
          </div>
          <button
            type="button"
            className={`modal-critical-btn${critical ? " modal-critical-btn--on" : ""}`}
            onClick={() => setCritical((v) => !v)}
            disabled={busy}
            title="When on, this list going fully down raises a red alarm. When off, it only warns (yellow)."
          >
            Critical
          </button>
          <div className="modal-actions">
            <button type="button" className="modal-cancel" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="modal-save" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
