import { useEffect, useId, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import {
  save as saveDialog,
  open as openDialog,
} from "@tauri-apps/plugin-dialog";
import type { Config, StatusIcon, TrayShape } from "../types";
import { parseHost } from "../utils/parseHost";
import type { UpdatePhase } from "../App";
import { exportConfig, type SettingsPatch } from "../api";
import { previewSound } from "../utils/alerts";
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
import { useTheme, type ThemeMode } from "../theme";
import { StatusIconPicker } from "./StatusIconPicker";

const THEME_ICON: Record<ThemeMode, "sun" | "moon" | "monitor"> = {
  light: "sun",
  dark: "moon",
  system: "monitor",
};
const THEME_LABEL: Record<ThemeMode, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

/** The update state App owns, plus its two actions — Settings only renders it. */
export type Updater = {
  phase: UpdatePhase | null;
  version: string | null;
  progress: number;
  /** Resolves true when an update is available; rejects when the check failed. */
  check: () => Promise<boolean>;
  /** Download if needed, then install and relaunch. */
  installNow: () => void;
};

/** Feedback for the last manual check — not update state. */
type CheckResult = "idle" | "checking" | "up-to-date" | "error";

/** True when at least one Sound alert is on — the one predicate for "the volume control applies". */
const anySound = (d: boolean, u: boolean, b: boolean) => d || u || b;

// A provider slot with a stable id so dnd-kit can track it across re-renders.
type ProviderSlot = { id: string; value: string };

let _slotSeq = 0;
function makeSlot(value: string): ProviderSlot {
  return { id: `slot-${_slotSeq++}`, value };
}

// At least 4 slots to type into; never fewer than the saved providers (a 5th must survive Save).
function toSlots(arr: string[]): ProviderSlot[] {
  const padded = arr.concat(Array(Math.max(0, 4 - arr.length)).fill(""));
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
  const style = { transform: CSS.Translate.toString(transform), transition };
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

/** A titled group of settings. A plain `role="group"` div, not a <fieldset>/<legend>: legend
 *  placement and fieldset-as-flex-container differ across WebKit versions, and the heading
 *  must sit at the top of the card in all of them. */
function SettingsCard({
  title,
  className = "",
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div
      className={`settings-card ${className}`.trim()}
      role="group"
      aria-labelledby={id}
    >
      <div className="settings-card-title" id={id}>
        {title}
      </div>
      {children}
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
  onResetConfig,
  updater,
}: {
  config: Config | null;
  open: boolean;
  onClose: () => void;
  /** Resolves once saved; a rejection keeps the modal open and shows the message. */
  onSave: (patch: SettingsPatch) => Promise<unknown>;
  onShowReleaseNotes: () => void;
  onImport: (path: string) => void;
  /** Wipe the config back to the seeded defaults (the caller reloads on success). */
  onResetConfig: () => void;
  updater: Updater;
}) {
  const [slots, setSlots] = useState<ProviderSlot[]>(() => toSlots([]));
  // Probe intervals held as strings while editing; parsed + floored (≥10) on Save.
  const [criticalInterval, setCriticalInterval] = useState("30");
  const [noncriticalInterval, setNoncriticalInterval] = useState("60");
  const [downNotify, setDownNotify] = useState(true);
  const [downSound, setDownSound] = useState(true);
  const [upNotify, setUpNotify] = useState(false);
  const [upSound, setUpSound] = useState(true);
  const [blockedNotify, setBlockedNotify] = useState(true);
  const [blockedSound, setBlockedSound] = useState(true);
  // Notification volume, percent in steps of 1. Independent of the three Sound flags
  // (ADR-0028): 0 mutes the audio, it does not uncheck anything. The flags choose which
  // directions make a sound; this chooses how loud.
  const [volume, setVolume] = useState(100);
  const [checkResult, setCheckResult] = useState<CheckResult>("idle");
  const [version, setVersion] = useState("");
  // System settings: launch-at-login + hide-dock (macOS).
  const [loginEnabled, setLoginEnabled] = useState(false);
  const [loginInitial, setLoginInitial] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [hideDock, setHideDockState] = useState(false);
  const [statusIcon, setStatusIcon] = useState<StatusIcon>("pulse");
  const [trayFilled, setTrayFilled] = useState(true);
  const [trayShape, setTrayShape] = useState<TrayShape>("same");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [configMsg, setConfigMsg] = useState<{
    text: string;
    kind: "ok" | "err";
  } | null>(null);
  // Path picked for import, awaiting the overwrite confirmation. null = no pending import.
  const [pendingImport, setPendingImport] = useState<string | null>(null);
  const isMac = navigator.userAgent.includes("Mac");
  // Theme + "Reset to defaults" used to live in the hero menu; they moved here unchanged.
  const [theme, cycleTheme] = useTheme();
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

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
    setBlockedNotify(config.blocked_notify);
    setBlockedSound(config.blocked_sound);
    setVolume(config.notify_volume);
    setHideDockState(config.hide_dock);
    setStatusIcon(config.status_icon);
    setTrayFilled(config.tray_filled);
    setTrayShape(config.tray_shape);
    setSaveError(null);
    setLoginError(null);
    setConfirmReset(false);
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
    setSaveError(null);

    // Launch-at-login lives in the OS, not the config, so it's applied first; if it fails the
    // modal stays open with the error and nothing else is written.
    try {
      if (loginEnabled !== loginInitial) {
        if (loginEnabled) await enable();
        else await disable();
      }
    } catch {
      setLoginError("Could not update login item");
      return;
    }
    setLoginInitial(loginEnabled); // applied state is the new baseline

    // Floor each interval at 10s; fall back to the default if left blank/invalid.
    const floorInterval = (raw: string, fallback: number) => {
      const n = Math.floor(Number(raw));
      return Number.isFinite(n) && n > 0 ? Math.max(n, 10) : fallback;
    };
    setSaving(true);
    try {
      await onSave({
        critical_interval_secs: floorInterval(criticalInterval, 30),
        noncritical_interval_secs: floorInterval(noncriticalInterval, 60),
        ip_providers: slots.map((s) => parseHost(s.value)).filter(Boolean),
        down_notify: downNotify,
        down_sound: downSound,
        up_notify: upNotify,
        up_sound: upSound,
        blocked_notify: blockedNotify,
        blocked_sound: blockedSound,
        notify_volume: volume,
        hide_dock: hideDock,
        status_icon: statusIcon,
        tray_filled: trayFilled,
        tray_shape: trayShape,
      });
      onClose();
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setResetBusy(true);
    onClose(); // close first: a failed reset reports through the notice behind the modal
    onResetConfig();
  }

  async function handleCheckUpdate() {
    setCheckResult("checking");
    try {
      setCheckResult((await updater.check()) ? "idle" : "up-to-date");
    } catch {
      setCheckResult("error");
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

          {/* Appearance. Theme is per device and applies at once; the status icon is drawn by the
              backend too (menu bar), so it is config and waits for Save like the cards below. */}
          <SettingsCard className="appearance-card" title="Appearance">
            <button
              type="button"
              className="config-action-btn theme-btn"
              onClick={() => cycleTheme()}
              title="Cycle theme"
            >
              <Icon name={THEME_ICON[theme]} size={14} />
              <span>Theme: {THEME_LABEL[theme]}</span>
            </button>
            <StatusIconPicker
              statusIcon={statusIcon}
              onStatusIcon={setStatusIcon}
              trayShape={trayShape}
              trayFilled={trayFilled}
              onTray={(shape, filled) => {
                setTrayShape(shape);
                setTrayFilled(filled);
              }}
            />
          </SettingsCard>

          {/* Config export/import — standalone, NOT governed by the form's Save button. */}
          <SettingsCard className="config-card" title="Config">
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
            {confirmReset ? (
              <div className="reset-confirm">
                <span className="reset-confirm-label">Reset to defaults?</span>
                <button
                  type="button"
                  className="config-action-btn reset-danger"
                  onClick={handleReset}
                  disabled={resetBusy}
                >
                  Yes, reset
                </button>
                <button
                  type="button"
                  className="config-action-btn"
                  onClick={() => setConfirmReset(false)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="config-action-btn reset-danger reset-btn"
                onClick={() => setConfirmReset(true)}
              >
                <Icon name="x" size={14} />
                <span>Reset to defaults</span>
              </button>
            )}
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
          </SettingsCard>

          <form className="providers-form" onSubmit={handleSave}>
            <SettingsCard title="IP providers (drag to reorder)">
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
            </SettingsCard>

            <SettingsCard title="Probe interval (seconds, min 10)">
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
            </SettingsCard>

            <SettingsCard title="Critical-list alerts">
              <div className="alert-grid">
                <span className="alert-grid-head" />
                <span className="alert-grid-head">Notify</span>
                <span className="alert-grid-head">Sound</span>

                <span className="alert-grid-row-label">
                  <span className="alert-dot alert-dot-down" />
                  Outage (down)
                </span>
                <input
                  type="checkbox"
                  checked={downNotify}
                  aria-label="Notify on outage"
                  onChange={(e) => setDownNotify(e.target.checked)}
                />
                <input
                  type="checkbox"
                  checked={downSound}
                  aria-label="Sound on outage"
                  onChange={(e) => setDownSound(e.target.checked)}
                />

                <span className="alert-grid-row-label">
                  <span className="alert-dot alert-dot-up" />
                  Recovery (up)
                </span>
                <input
                  type="checkbox"
                  checked={upNotify}
                  aria-label="Notify on recovery"
                  onChange={(e) => setUpNotify(e.target.checked)}
                />
                <input
                  type="checkbox"
                  checked={upSound}
                  aria-label="Sound on recovery"
                  onChange={(e) => setUpSound(e.target.checked)}
                />

                <span className="alert-grid-row-label">
                  <span className="alert-dot alert-dot-blocked" />
                  Blocked list
                </span>
                <input
                  type="checkbox"
                  checked={blockedNotify}
                  aria-label="Notify on blocked list"
                  onChange={(e) => setBlockedNotify(e.target.checked)}
                />
                <input
                  type="checkbox"
                  checked={blockedSound}
                  aria-label="Sound on blocked list"
                  onChange={(e) => setBlockedSound(e.target.checked)}
                />
              </div>

              <div className="volume-row">
                <label className="volume-label" htmlFor="notify-volume">
                  Sound volume
                </label>
                <input
                  id="notify-volume"
                  className="volume-slider"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={volume}
                  // Inert only while no direction makes a sound at all — there is nothing for a
                  // level to apply to. Dragging to 0 is a mute, and leaves the checkboxes alone.
                  disabled={!anySound(downSound, upSound, blockedSound)}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  // Preview on release only — not on every onChange, or a held
                  // keyboard/drag sweep would fire a sound per step.
                  onPointerUp={() => previewSound(volume)}
                  onKeyUp={() => previewSound(volume)}
                />
                <span className="volume-readout">
                  {volume === 0 ? "Muted" : `${volume}%`}
                </span>
              </div>
              {!anySound(downSound, upSound, blockedSound) && (
                <p className="settings-note">
                  Enable a Sound alert to set the volume.
                </p>
              )}
            </SettingsCard>

            <SettingsCard title="System">
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
                </>
              )}
            </SettingsCard>

            {saveError && <p className="modal-error" role="alert">{saveError}</p>}
            <div className="modal-actions">
              <button type="button" className="modal-cancel" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="modal-save" disabled={saving}>
                {saving ? "Saving…" : "Save"}
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
              {updater.phase === null && checkResult === "up-to-date" && (
                <span className="update-msg">Up to date</span>
              )}
              {updater.phase === null && checkResult === "error" && (
                <span className="update-msg update-err">Check failed</span>
              )}

              {updater.phase === "downloading" ? (
                <span className="update-msg">Downloading… {updater.progress}%</span>
              ) : updater.phase !== null && updater.version ? (
                <>
                  <span className="update-available-label">
                    v{updater.version} {updater.phase === "ready" ? "ready" : "available"}
                  </span>
                  <button className="update-install-btn" onClick={updater.installNow}>
                    Install &amp; restart
                  </button>
                </>
              ) : (
                <button
                  className="update-check-btn"
                  onClick={handleCheckUpdate}
                  disabled={checkResult === "checking"}
                >
                  {checkResult === "checking" ? "Checking…" : "Check for updates"}
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
