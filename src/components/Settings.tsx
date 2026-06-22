import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import type { Config } from "../types";
import { parseHost } from "../utils/parseHost";
import { checkForUpdate, downloadUpdate, installAndRelaunch, type UpdateInfo } from "../update";
import { setHideDock } from "../api";
import { Switch } from "./Switch";

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
  onSave: (
    providers: string[],
    downNotify: boolean,
    downSound: boolean,
    upNotify: boolean,
    upSound: boolean,
  ) => void;
}) {
  const [slots, setSlots] = useState<[string, string, string, string]>([
    "",
    "",
    "",
    "",
  ]);
  const [downNotify, setDownNotify] = useState(true);
  const [downSound, setDownSound] = useState(true);
  const [upNotify, setUpNotify] = useState(false);
  const [upSound, setUpSound] = useState(true);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState>("idle");
  const [version, setVersion] = useState("");
  // System settings: launch-at-login + hide-dock (macOS).
  const [loginEnabled, setLoginEnabled] = useState(false);
  const [loginInitial, setLoginInitial] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [hideDock, setHideDockState] = useState(false);
  const [hideDockError, setHideDockError] = useState<string | null>(null);
  const isMac = navigator.userAgent.includes("Mac");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  // Re-seed every time the modal opens, so closing without Save discards pending edits
  // (reopening always shows the real, persisted state).
  useEffect(() => {
    if (!open || !config) return;
    setSlots(toSlots(config.ip_providers));
    setDownNotify(config.down_notify);
    setDownSound(config.down_sound);
    setUpNotify(config.up_notify);
    setUpSound(config.up_sound);
    setHideDockState(config.hide_dock);
    setHideDockError(null);
    setLoginError(null);
    // Launch-at-login lives in the OS — query it fresh as the baseline.
    isEnabled()
      .then((on) => {
        setLoginEnabled(on);
        setLoginInitial(on);
      })
      .catch(() => {});
  }, [open, config]);

  function setSlot(i: number, val: string) {
    setSlots((prev) => {
      const next = [...prev] as [string, string, string, string];
      next[i] = val;
      return next;
    });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setLoginError(null);
    setHideDockError(null);

    // Apply system toggles only on Save. If any fails, surface the error and keep the
    // modal open so the user sees it instead of silently closing.
    let ok = true;
    try {
      if (loginEnabled !== loginInitial) {
        if (loginEnabled) await enable(); else await disable();
      }
    } catch {
      setLoginError("Could not update login item");
      ok = false;
    }
    try {
      if (hideDock !== (config?.hide_dock ?? false)) {
        await setHideDock(hideDock);
      }
    } catch {
      setHideDockError("Could not change dock setting");
      ok = false;
    }
    if (!ok) return;
    setLoginInitial(loginEnabled); // applied state is the new baseline

    const providers = slots.map(parseHost).filter(Boolean);
    onSave(providers, downNotify, downSound, upNotify, upSound);
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
          <fieldset className="settings-card">
            <legend className="settings-card-title">IP providers (tried in order)</legend>
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
          </fieldset>

          <fieldset className="settings-card">
            <legend className="settings-card-title">Critical-list alerts</legend>
            <div className="alert-grid">
              <span className="alert-grid-head" />
              <span className="alert-grid-head">Notify</span>
              <span className="alert-grid-head">Sound</span>

              <span className="alert-grid-row-label">Outage (down)</span>
              <input
                type="checkbox"
                checked={downNotify}
                onChange={(e) => setDownNotify(e.target.checked)}
              />
              <input
                type="checkbox"
                checked={downSound}
                onChange={(e) => setDownSound(e.target.checked)}
              />

              <span className="alert-grid-row-label">Recovery (up)</span>
              <input
                type="checkbox"
                checked={upNotify}
                onChange={(e) => setUpNotify(e.target.checked)}
              />
              <input
                type="checkbox"
                checked={upSound}
                onChange={(e) => setUpSound(e.target.checked)}
              />
            </div>
          </fieldset>

          <fieldset className="settings-card">
            <legend className="settings-card-title">System</legend>
            <div className="system-toggle-row">
              <label className="system-toggle-label" htmlFor="login-toggle">
                Launch at login
              </label>
              <Switch
                id="login-toggle"
                checked={loginEnabled}
                onChange={setLoginEnabled}
              />
            </div>
            {loginError && (
              <span className="system-toggle-error">{loginError}</span>
            )}

            {isMac && (
              <>
                <div className="system-toggle-row">
                  <label className="system-toggle-label" htmlFor="dock-toggle">
                    Hide Dock icon
                  </label>
                  <Switch
                    id="dock-toggle"
                    checked={hideDock}
                    onChange={setHideDockState}
                  />
                </div>
                {hideDockError && (
                  <span className="system-toggle-error">{hideDockError}</span>
                )}
              </>
            )}
          </fieldset>

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
          <div className="update-row">
            <span className="app-version">
              Qanary{version && ` v${version}`}
            </span>
            <div className="update-row-right">
              {updateState === "installing" && (
                <span className="update-msg">Installing…</span>
              )}
              {updateState === "up-to-date" && (
                <span className="update-msg">Up to date</span>
              )}
              {updateState === "error" && (
                <span className="update-msg update-err">Check failed</span>
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
      </div>
    </div>
  );
}
