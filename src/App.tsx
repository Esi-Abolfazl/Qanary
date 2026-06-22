import { useEffect, useRef, useState } from "react";
import "./App.css";
import * as api from "./api";
import type { Config, ServiceDraft, Snapshot } from "./types";
import { StatusHero } from "./components/StatusHero";
import { ServiceList } from "./components/ServiceList";
import { Settings } from "./components/Settings";
import { ListModal } from "./components/ListModal";
import { ServiceModal } from "./components/ServiceModal";
import { ChangelogModal } from "./components/ChangelogModal";
import { serviceToText } from "./utils/parseServices";
import { checkForUpdate, downloadUpdate, installAndRelaunch } from "./update";
import { criticalTransitions } from "./utils/transitions";
import { fireAlert, type Dir } from "./utils/alerts";

// Collect Transitions for this long before firing, so several lists dropping at
// once produce a single batched notification instead of one each.
const ALERT_WINDOW_MS = 2500;

type ModalState =
  | null
  | { kind: "addList" }
  | { kind: "editList"; id: string; name: string; icon: string; critical: boolean }
  | { kind: "addService"; listId: string; listName: string }
  | {
      kind: "editService";
      listId: string;
      serviceId: string;
      listName: string;
      initial: string;
    }
  | { kind: "settings" };

export type UpdatePhase = "available" | "downloading" | "ready";

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  // Changelog shown once after a self-update relaunch.
  const [changelog, setChangelog] = useState<{ version: string; body: string } | null>(null);
  // Holds the previous snapshot so we can diff for Transitions on each update.
  const prevSnapshotRef = useRef<Snapshot | null>(null);

  // Keep a ref to the latest config so the status-update callback reads fresh flags
  // without needing to re-subscribe whenever config changes.
  const configRef = useRef<Config | null>(null);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  // Batching: pending Transitions keyed by list id (latest edge wins), plus the
  // open window timer. Flushed once per ALERT_WINDOW_MS into per-direction alerts.
  const pendingRef = useRef<Map<string, { name: string; dir: Dir }>>(new Map());
  const timerRef = useRef<number | null>(null);

  function flushAlerts() {
    timerRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = new Map();

    // "all" = every critical list is now in that direction (full outage / full recovery).
    const crit = (prevSnapshotRef.current?.lists ?? []).filter((l) => l.critical);
    const allDown = crit.length > 0 && crit.every((l) => l.all_down);
    const allUp = crit.length > 0 && crit.every((l) => !l.all_down);

    const downNames: string[] = [];
    const upNames: string[] = [];
    for (const { name, dir } of pending.values()) {
      (dir === "down" ? downNames : upNames).push(name);
    }
    fireAlert("down", downNames, allDown, configRef.current);
    fireAlert("up", upNames, allUp, configRef.current);
  }

  function handleSnapshot(s: Snapshot) {
    const prev = prevSnapshotRef.current;
    if (prev !== null) {
      const transitions = criticalTransitions(prev.lists, s.lists);
      for (const t of transitions) {
        pendingRef.current.set(t.id, { name: t.name, dir: t.dir });
      }
      // Open one window from the first Transition; later ones join the same batch.
      if (transitions.length > 0 && timerRef.current === null) {
        timerRef.current = window.setTimeout(flushAlerts, ALERT_WINDOW_MS);
      }
    }
    prevSnapshotRef.current = s;
    setSnapshot(s);
  }

  useEffect(() => {
    api.getSnapshot().then((s) => s && handleSnapshot(s));
    api.getConfig().then(setConfig);
    // Show the "What's new" changelog once when the app version changed since last launch.
    // Backend reads the bundled CHANGELOG, so this fires for any update path (in-app or manual).
    api.takeNewChangelog().then((cl) => cl && setChangelog(cl));
    let unlisten: (() => void) | undefined;
    api.onStatusUpdate(handleSnapshot).then((fn) => {
      unlisten = fn;
    });
    checkForUpdate()
      .then((info) => {
        if (info) setUpdatePhase("available");
      })
      .catch(() => {});
    return () => {
      unlisten?.();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  async function handleDownload() {
    setUpdatePhase("downloading");
    setDownloadProgress(0);
    try {
      await downloadUpdate(setDownloadProgress);
      setUpdatePhase("ready");
    } catch {
      setUpdatePhase("available");
    }
  }

  async function handleInstall() {
    try {
      await installAndRelaunch();
    } catch {
      setUpdatePhase("ready");
    }
  }

  const lists = snapshot?.lists ?? [];

  async function handleSaveList(name: string, icon: string, critical: boolean) {
    if (modal?.kind === "addList") {
      const cfg = await api.addList(name, icon, critical);
      setConfig(cfg);
    } else if (modal?.kind === "editList") {
      const cfg = await api.updateList(modal.id, name, icon, critical);
      setConfig(cfg);
    }
  }

  async function handleSaveService(drafts: ServiceDraft[]) {
    if (modal?.kind === "addService") {
      const cfg = await api.addServices(modal.listId, drafts);
      setConfig(cfg);
    } else if (modal?.kind === "editService") {
      // Edit: use only the first parsed draft
      const draft = drafts[0];
      if (!draft) return;
      const cfg = await api.updateService(
        modal.listId,
        modal.serviceId,
        draft.label,
        draft.endpoints,
      );
      setConfig(cfg);
    }
  }

  function handleOpenEdit(listId: string, serviceId: string, listName: string) {
    const list = config?.lists.find((l) => l.id === listId);
    const svc = list?.services.find((s) => s.id === serviceId);
    if (!svc) return;
    setModal({
      kind: "editService",
      listId,
      serviceId,
      listName,
      initial: serviceToText(svc),
    });
  }

  return (
    <main className="app">
      <StatusHero
        snapshot={snapshot}
        onRefresh={() => api.refreshNow().then(setSnapshot)}
        onAddList={() => setModal({ kind: "addList" })}
        onOpenSettings={() => setModal({ kind: "settings" })}
        onResetConfig={() =>
          api.resetConfig().then(() => window.location.reload())
        }
        updatePhase={updatePhase}
        downloadProgress={downloadProgress}
        onDownload={handleDownload}
        onInstall={handleInstall}
      />

      <div className="lists">
        {lists.map((list) => (
          <ServiceList
            key={list.id}
            list={list}
            onRemoveService={(lid, sid) => api.removeService(lid, sid)}
            onRemoveList={(lid) => api.removeList(lid)}
            onEditList={(id, name, icon, critical) =>
              setModal({ kind: "editList", id, name, icon, critical })
            }
            onAddService={(listId, listName) =>
              setModal({ kind: "addService", listId, listName })
            }
            onEditService={(listId, serviceId) =>
              handleOpenEdit(listId, serviceId, list.name)
            }
          />
        ))}
        {lists.length === 0 && <p className="loading">Starting first probe…</p>}
      </div>

      {(modal?.kind === "addList" || modal?.kind === "editList") && (
        <ListModal
          mode={modal.kind === "addList" ? "add" : "edit"}
          initial={
            modal.kind === "editList"
              ? { name: modal.name, icon: modal.icon, critical: modal.critical }
              : { name: "", icon: "", critical: false }
          }
          onSave={handleSaveList}
          onClose={() => setModal(null)}
        />
      )}

      {(modal?.kind === "addService" || modal?.kind === "editService") && (
        <ServiceModal
          mode={modal.kind === "addService" ? "add" : "edit"}
          listName={modal.listName}
          initial={modal.kind === "editService" ? modal.initial : undefined}
          onSave={handleSaveService}
          onClose={() => setModal(null)}
        />
      )}

      {changelog && (
        <ChangelogModal
          version={changelog.version}
          body={changelog.body}
          onClose={() => setChangelog(null)}
        />
      )}

      <Settings
        config={config}
        open={modal?.kind === "settings"}
        onClose={() => setModal(null)}
        onSave={(providers, downNotify, downSound, upNotify, upSound) =>
          api
            .updateSettings(
              undefined,
              undefined,
              providers,
              downNotify,
              downSound,
              upNotify,
              upSound,
            )
            .then(setConfig)
        }
      />
    </main>
  );
}

export default App;
