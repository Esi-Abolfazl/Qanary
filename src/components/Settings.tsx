import { useEffect, useState } from "react";
import type { Config } from "../types";
import { parseHost } from "../utils/parseHost";
import { checkForUpdate, downloadAndInstall, type UpdateInfo } from "../update";

type UpdateState = "idle" | "checking" | "available" | "installing" | "up-to-date" | "error";

function toSlots(arr: string[]): [string, string, string] {
  const s = arr.concat(["", "", ""]).slice(0, 3);
  return [s[0], s[1], s[2]];
}

export function Settings({
  config,
  onSave,
}: {
  config: Config | null;
  onSave: (providers: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [slots, setSlots] = useState<[string, string, string]>(["", "", ""]);
  const [seeded, setSeeded] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState>("idle");

  // Seed inputs once the config arrives from the backend.
  useEffect(() => {
    if (config && !seeded) {
      setSlots(toSlots(config.ip_providers));
      setSeeded(true);
    }
  }, [config, seeded]);

  function setSlot(i: number, val: string) {
    setSlots((prev) => {
      const next = [...prev] as [string, string, string];
      next[i] = val;
      return next;
    });
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    // parseHost cleans each value; drop empties.
    const providers = slots.map(parseHost).filter(Boolean);
    onSave(providers);
  }

  async function handleCheckUpdate() {
    setUpdateState("checking");
    try {
      const info = await checkForUpdate();
      if (info) { setUpdateInfo(info); setUpdateState("available"); }
      else setUpdateState("up-to-date");
    } catch {
      setUpdateState("error");
    }
  }

  async function handleInstall() {
    setUpdateState("installing");
    try {
      await downloadAndInstall(); // relaunches — never returns
    } catch {
      setUpdateState("error");
    }
  }

  return (
    <section className="settings">
      <button className="settings-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? "▲" : "▼"} Settings
      </button>

      {open && (
        <div className="settings-body">
          <form className="providers-form" onSubmit={handleSave}>
            <p className="settings-label">IP providers (tried in order):</p>
            {slots.map((p, i) => (
              <input
                key={i}
                className="provider-input"
                placeholder={
                  i === 0 ? "ifconfig.me/ip" : i === 1 ? "ipify.ir" : "api.ipify.org"
                }
                value={p}
                onChange={(e) => setSlot(i, e.target.value)}
              />
            ))}
            <button type="submit">Save</button>
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
            {updateState === "installing" && <span className="update-msg">Installing…</span>}
            {updateState === "up-to-date" && <span className="update-msg">Already up to date.</span>}
            {updateState === "error" && (
              <span className="update-msg update-err">Update check failed.</span>
            )}
            <button
              className="update-check-btn"
              onClick={handleCheckUpdate}
              disabled={updateState === "checking" || updateState === "installing"}
            >
              {updateState === "checking" ? "Checking…" : "Check for updates"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
