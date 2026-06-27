import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import {
  save as saveDialog,
  open as openDialog,
} from "@tauri-apps/plugin-dialog";
import type { Config } from "../types";
import { parseHost } from "../utils/parseHost";
import {
  checkForUpdate,
  downloadUpdate,
  installAndRelaunch,
  type UpdateInfo,
} from "../update";
import { exportConfig, setHideDock } from "../api";
import { Switch } from "./Switch";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Icon } from "./Icon";

type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "installing"
  | "up-to-date"
  | "error";

// A provider slot with a stable id so dnd-kit can track it across re-renders.
type ProviderSlot = { id: string; value: string };

let _slotSeq = 0;
function makeSlot(value: string): ProviderSlot {
  return { id: `slot-${_slotSeq++}`, value };
}

function toSlots(arr: string[]): ProviderSlot[] {
  const padded = arr.concat(["", "", "", ""]).slice(0, 4);
  return padded.map(makeSlot);
}

// One draggable provider row — calls useSortable.
function SortableProviderSlot({
  slot,
  placeholder,
  onChange,
}: {
  slot: ProviderSlot;
  placeholder: string;
  onChange: (id: string, val: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: slot.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div className="provider-slot" ref={setNodeRef} style={style}>
      <button
        type="button"
        className="provider-grip-btn"
        {...listeners}
        {...attributes}
        title="Drag to reorder"
      >
        <Icon name="grip" size={14} />
      </button>
      <input
        className="provider-input provider-input-sortable"
        placeholder={placeholder}
        value={slot.value}
        onChange={(e) => onChange(slot.id, e.target.value)}
      />
    </div>
  );
}

export function Settings({
  config,
  open,
  onClose,
  onSave,
  onShowReleaseNotes,
  onImport,
}: {
  config: Config | null;
  open: boolean;
  onClose: () => void;
  onSave: (
    criticalInterval: number,
    noncriticalInterval: number,
    providers: string[],
    downNotify: boolean,
    downSound: boolean,
    upNotify: boolean,
    upSound: boolean,
  ) => void;
  onShowReleaseNotes: () => void;
  onImport: (path: string) => void;
}) {
  const [slots, setSlots] = useState<ProviderSlot[]>(() => toSlots([]));
  // Probe intervals held as strings while editing; parsed + floored (≥10) on Save.
  const [criticalInterval, setCriticalInterval] = useState("30");
  const [noncriticalInterval, setNoncriticalInterval] = useState("60");
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
  const [configMsg, setConfigMsg] = useState<{
    text: string;
    kind: "ok" | "err";
  } | null>(null);
  // Path picked for import, awaiting the overwrite confirmation. null = no pending import.
  const [pendingImport, setPendingImport] = useState<string | null>(null);
  const isMac = navigator.userAgent.includes("Mac");

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  // Re-seed every time the modal opens, so closing without Save discards pending edits
  // (reopening always shows the real, persisted state).
  useEffect(() => {
    if (!open || !config) return;
    setSlots(toSlots(config.ip_providers));
    setCriticalInterval(String(config.critical_interval_secs));
    setNoncriticalInterval(String(config.noncritical_interval_secs));
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

  function updateSlotValue(id: string, val: string) {
    setSlots((prev) =>
      prev.map((s) => (s.id === id ? { ...s, value: val } : s)),
    );
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function handleProviderDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = slots.findIndex((s) => s.id === active.id);
    const newIndex = slots.findIndex((s) => s.id === over.id);
    setSlots(arrayMove(slots, oldIndex, newIndex));
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
        if (loginEnabled) await enable();
        else await disable();
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

    const providers = slots.map((s) => parseHost(s.value)).filter(Boolean);
    // Floor each interval at 10s; fall back to the default if left blank/invalid.
    const floorInterval = (raw: string, fallback: number) => {
      const n = Math.floor(Number(raw));
      return Number.isFinite(n) && n > 0 ? Math.max(n, 10) : fallback;
    };
    onSave(
      floorInterval(criticalInterval, 30),
      floorInterval(noncriticalInterval, 60),
      providers,
      downNotify,
      downSound,
      upNotify,
      upSound,
    );
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
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div
          className="modal modal-settings"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="modal-title">Settings</h3>

          {/* Config export/import — standalone, NOT governed by the form's Save button. */}
          <fieldset className="settings-card config-card">
            <legend className="settings-card-title">Config</legend>
            <div className="config-actions">
              <button
                type="button"
                className="config-action-btn"
                onClick={async () => {
                  setConfigMsg(null);
                  const path = await saveDialog({
                    defaultPath: "qanary-config.json",
                    filters: [{ name: "JSON", extensions: ["json"] }],
                  });
                  if (!path) return;
                  try {
                    await exportConfig(path);
                    setConfigMsg({ text: "Config exported.", kind: "ok" });
                  } catch (e) {
                    setConfigMsg({ text: `Export failed: ${e}`, kind: "err" });
                  }
                }}
              >
                Export…
              </button>
              <button
                type="button"
                className="config-action-btn"
                onClick={async () => {
                  setConfigMsg(null);
                  const path = await openDialog({
                    filters: [{ name: "JSON", extensions: ["json"] }],
                    multiple: false,
                  });
                  if (!path) return;
                  // Confirm before overwriting — import is a full, destructive replace.
                  setPendingImport(path as string);
                }}
              >
                Import…
              </button>
            </div>
            {configMsg && (
              <span
                className={
                  configMsg.kind === "err"
                    ? "config-msg config-msg-err"
                    : "config-msg config-msg-ok"
                }
              >
                {configMsg.text}
              </span>
            )}
          </fieldset>

          <form className="providers-form" onSubmit={handleSave}>
            <fieldset className="settings-card">
              <legend className="settings-card-title">
                IP providers (drag to reorder)
              </legend>
              <DndContext sensors={sensors} onDragEnd={handleProviderDragEnd}>
                <SortableContext
                  items={slots.map((s) => s.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {slots.map((slot, i) => (
                    <SortableProviderSlot
                      key={slot.id}
                      slot={slot}
                      placeholder={
                        [
                          "ip.shecan.ir",
                          "ifconfig.me/ip",
                          "api.ipify.org",
                          "ipify.ir",
                        ][i]
                      }
                      onChange={updateSlotValue}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </fieldset>

            <fieldset className="settings-card">
              <legend className="settings-card-title">
                Probe interval (seconds, min 10)
              </legend>
              <div className="interval-row">
                <label className="interval-label" htmlFor="critical-interval">
                  Critical lists
                </label>
                <input
                  id="critical-interval"
                  type="number"
                  min={10}
                  step={1}
                  value={criticalInterval}
                  onChange={(e) => setCriticalInterval(e.target.value)}
                />
              </div>
              <div className="interval-row">
                <label
                  className="interval-label"
                  htmlFor="noncritical-interval"
                >
                  Non-critical lists
                </label>
                <input
                  id="noncritical-interval"
                  type="number"
                  min={10}
                  step={1}
                  value={noncriticalInterval}
                  onChange={(e) => setNoncriticalInterval(e.target.value)}
                />
              </div>
              <p className="settings-note">
                Probing too often can look like abuse — some services may
                rate-limit or block you. Keep intervals as high as your needs
                allow.
              </p>
            </fieldset>

            <fieldset className="settings-card">
              <legend className="settings-card-title">
                Critical-list alerts
              </legend>
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
                    <label
                      className="system-toggle-label"
                      htmlFor="dock-toggle"
                    >
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
            <div className="update-meta">
              <span className="app-version">
                Qanary{version && ` v${version}`}
              </span>
              <button
                type="button"
                className="release-notes-link"
                onClick={() => {
                  onShowReleaseNotes();
                  onClose();
                }}
              >
                Release notes
              </button>
            </div>

            <div className="update-actions">
              {updateState === "up-to-date" && (
                <span className="update-msg">Up to date</span>
              )}
              {updateState === "error" && (
                <span className="update-msg update-err">Check failed</span>
              )}
              {updateState === "installing" && (
                <span className="update-msg">Installing…</span>
              )}

              {updateState === "available" && updateInfo ? (
                <>
                  <span className="update-available-label">
                    v{updateInfo.version} available
                  </span>
                  <button
                    className="update-install-btn"
                    onClick={handleInstall}
                  >
                    Install &amp; restart
                  </button>
                </>
              ) : (
                <button
                  className="update-check-btn"
                  onClick={handleCheckUpdate}
                  disabled={
                    updateState === "checking" || updateState === "installing"
                  }
                >
                  {updateState === "checking"
                    ? "Checking…"
                    : "Check for updates"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Import confirmation — import is a full destructive replace of the live config. */}
      {pendingImport && (
        <div className="modal-overlay" onClick={() => setPendingImport(null)}>
          <div
            className="modal modal-confirm"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="modal-title">Import config?</h3>
            <p className="modal-confirm-text">
              This will overwrite and clear your current setup — all lists,
              services, and settings will be replaced by the imported file. This
              cannot be undone.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="modal-cancel"
                onClick={() => setPendingImport(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-save modal-danger"
                onClick={() => {
                  const path = pendingImport;
                  setPendingImport(null);
                  onImport(path);
                }}
              >
                Overwrite
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
