import { useEffect, useState } from "react";
import type { Config } from "../types";
import { parseHost } from "../utils/parseHost";
import { checkForUpdate, downloadUpdate, installAndRelaunch, type UpdateInfo } from "../update";

type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "installing"
  | "up-to-date"
  | "error";

function toSlots(arr: string[]): [string, string, string, string] {
  const s = arr.concat(["", "", "", ""]).slice(0, 4);
  return [s[0], s[1], s[2], s[3]];
}

export function Settings({
  config,
  open,
  onClose,
  onSave,
}: {
  config: Config | null;
  open: boolean;
  onClose: () => void;
  onSave: (providers: string[]) => void;
}) {
  const [slots, setSlots] = useState<[string, string, string, string]>([
    "",
    "",
    "",
    "",
  ]);
  const [seeded, setSeeded] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState>("idle");

  useEffect(() => {
    if (config && !seeded) {
      setSlots(toSlots(config.ip_providers));
      setSeeded(true);
    }
  }, [config, seeded]);

  function setSlot(i: number, val: string) {
    setSlots((prev) => {
      const next = [...prev] as [string, string, string, string];
      next[i] = val;
      return next;
    });
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const providers = slots.map(parseHost).filter(Boolean);
    onSave(providers);
    onClose();
  }

  async function handleCheckUpdate() {
    setUpdateState("checking");
    try {
      const info = await checkForUpdate();
      if (info) {
        setUpdateInfo(info);
        setUpdateState("available");
      } else setUpdateState("up-to-date");
    } catch {
      setUpdateState("error");
    }
  }

  async function handleInstall() {
    setUpdateState("installing");
    try {
      await downloadUpdate(() => {});
      await installAndRelaunch();
    } catch {
      setUpdateState("error");
    }
  }

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal modal-settings"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="modal-title">Settings</h3>

        <form className="providers-form" onSubmit={handleSave}>
          <p className="settings-label">IP providers (tried in order):</p>
          {slots.map((p, i) => (
            <input
              key={i}
              className="provider-input"
              placeholder={
                ["ip.shecan.ir", "ifconfig.me/ip", "api.ipify.org", "ipify.ir"][
                  i
                ]
              }
              value={p}
              onChange={(e) => setSlot(i, e.target.value)}
            />
          ))}
          <div className="modal-actions">
            <button type="button" className="modal-cancel" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="modal-save">
              Save
            </button>
          </div>
        </form>

        <div className="update-section">
          {updateState === "available" && updateInfo && (
            <div className="update-banner">
              <span>Update available: v{updateInfo.version}</span>
              <button className="update-btn" onClick={handleInstall}>
                Install &amp; restart
              </button>
            </div>
          )}
          {updateState === "installing" && (
            <span className="update-msg">Installing…</span>
          )}
          {updateState === "up-to-date" && (
            <span className="update-msg">Already up to date.</span>
          )}
          {updateState === "error" && (
            <span className="update-msg update-err">Update check failed.</span>
          )}
          <button
            className="update-check-btn"
            onClick={handleCheckUpdate}
            disabled={
              updateState === "checking" || updateState === "installing"
            }
          >
            {updateState === "checking" ? "Checking…" : "Check for updates"}
          </button>
        </div>
      </div>
    </div>
  );
}
