import { useEffect, useId, useState } from "react";
import { endpointsToText, parseEndpoints, parseServiceLines } from "../utils/parseServices";
import type { Service, ServiceDraft } from "../types";
import { Switch } from "./Switch";

/**
 * Add/edit modal for services.
 *
 * Add mode:  one textarea, each line = one service ("Label: h1, h2").
 * Edit mode: separate Label and Endpoints fields, pre-filled from the stored Service, so saving
 *            can only ever produce that one service with the label as typed (no text grammar to
 *            round-trip through — the old `label: hosts` round-trip corrupted bare-host services).
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
  initial?: Service; // the service being edited
  onSave: (drafts: ServiceDraft[]) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [hosts, setHosts] = useState(initial ? endpointsToText(initial.endpoints) : "");
  const [checkBlock, setCheckBlock] = useState(initial?.check_block ?? false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const blockId = useId();

  useEffect(() => {
    setLabel(initial?.label ?? "");
    setHosts(initial ? endpointsToText(initial.endpoints) : "");
    setCheckBlock(initial?.check_block ?? false);
    setError("");
  }, [initial]);

  function parse(): { drafts: ServiceDraft[]; invalid: string[] } {
    if (mode === "add") return parseServiceLines(text);
    const { endpoints, invalid } = parseEndpoints(hosts);
    if (endpoints.length === 0) return { drafts: [], invalid };
    return { drafts: [{ label: label.trim() || endpoints[0].host, endpoints }], invalid };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parse();
    const { invalid } = parsed;
    const drafts = parsed.drafts.map((d) => ({ ...d, check_block: checkBlock }));
    if (invalid.length > 0) {
      setError(`Can't read: ${invalid.join(" · ")}`);
      return;
    }
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
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "add" ? `Add service to ${listName}` : `Edit service in ${listName}`;
  const submitLabel = busy ? (mode === "add" ? "Adding…" : "Saving…") : (mode === "add" ? "Add" : "Save");
  const clearError = () => setError("");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{title}</h3>
        <form onSubmit={handleSubmit} className="modal-form">
          {mode === "add" ? (
            <div className="modal-row">
              <textarea
                className="modal-textarea"
                placeholder={"Label: host1.com, host2.com:8080, host3.com\nOther service: api.example.com"}
                value={text}
                onChange={(e) => { setText(e.target.value); clearError(); }}
                rows={5}
                disabled={busy}
                aria-label="Services"
                autoFocus
              />
            </div>
          ) : (
            <>
              <div className="modal-row">
                <input
                  className="modal-name-input"
                  placeholder="Label (optional)"
                  value={label}
                  onChange={(e) => { setLabel(e.target.value); clearError(); }}
                  disabled={busy}
                  aria-label="Label"
                />
              </div>
              <div className="modal-row">
                <input
                  className="modal-name-input"
                  placeholder="host1.com, host2.com:8080"
                  value={hosts}
                  onChange={(e) => { setHosts(e.target.value); clearError(); }}
                  disabled={busy}
                  aria-label="Endpoints"
                  autoFocus
                />
              </div>
            </>
          )}
          <div className="modal-block-row">
            <span className="modal-block-label">
              <label htmlFor={blockId}>
                Check Cloudflare block <em>(experimental)</em>
              </label>
              <button
                type="button"
                className="modal-help"
                aria-expanded={helpOpen}
                aria-label="What does this do?"
                title="What does this do?"
                onClick={() => setHelpOpen((o) => !o)}
              >
                ?
              </button>
            </span>
            <Switch id={blockId} checked={checkBlock} onChange={setCheckBlock} />
          </div>
          {helpOpen && (
            <p className="modal-hint modal-block-help" role="note">
              Some sites behind Cloudflare or Akamai refuse your IP (a VPN's, often) and show a "you have been
              blocked" page. Normally Qanary still counts that as Up. With this on, when the site answers 403,
              Qanary reads that page once and marks the site Blocked if it is a block page. It reads again only
              after your IP or network changes, so it adds almost no traffic.
            </p>
          )}
          {error && <p className="modal-error">{error}</p>}
          <p className="modal-hint">
            {mode === "add"
              ? "One line per service. Commas separate endpoints. Label is optional."
              : "Commas separate endpoints. Add :port for anything other than 443."}
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
