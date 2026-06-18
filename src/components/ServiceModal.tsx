import { useEffect, useRef, useState } from "react";
import { parseServiceLines } from "../utils/parseServices";
import type { ServiceDraft } from "../types";

/**
 * Unified add/edit modal for services.
 *
 * Add mode:  textarea starts empty; each line = one service ("Label: h1, h2").
 * Edit mode: textarea pre-filled with the current service text; single line only.
 */
export function ServiceModal({
  mode,
  listName,
  initial,
  onSave,
  onClose,
}: {
  mode: "add" | "edit";
  listName: string;
  initial?: string; // pre-filled text for edit mode
  onSave: (drafts: ServiceDraft[]) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(initial ?? "");
    setError("");
  }, [initial]);

  useEffect(() => {
    // Focus and move cursor to end on open
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const drafts = parseServiceLines(text);
    if (drafts.length === 0) {
      setError("Enter at least one valid host.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave(drafts);
      onClose();
    } catch (err) {
      console.error(err);
      setError("Failed to save.");
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "add" ? `Add service to ${listName}` : `Edit service in ${listName}`;
  const submitLabel = busy ? (mode === "add" ? "Adding…" : "Saving…") : (mode === "add" ? "Add" : "Save");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{title}</h3>
        <form onSubmit={handleSubmit} className="modal-form">
          <div className="modal-row">
            <textarea
              ref={textareaRef}
              className="modal-textarea"
              placeholder={"Label: host1.com, host2.com:8080, host3.com\nOther service: api.example.com"}
              value={text}
              onChange={(e) => { setText(e.target.value); setError(""); }}
              rows={mode === "edit" ? 2 : 5}
              disabled={busy}
              aria-label="Services"
            />
          </div>
          {error && <p className="modal-error">{error}</p>}
          <p className="modal-hint">
            One line per service. Commas separate endpoints. Label is optional.
          </p>
          <div className="modal-actions">
            <button type="button" className="modal-cancel" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="modal-save" disabled={busy}>
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
