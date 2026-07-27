import { useEffect, useRef, useState } from "react";
import "./App.css";
import * as api from "./api";
import type { ChangelogEntry } from "./api";
import type { Config, ListStatus, ServiceDraft, Snapshot } from "./types";
import { StatusHero } from "./components/StatusHero";
import { ServiceList } from "./components/ServiceList";
import { Settings } from "./components/Settings";
import { ListModal } from "./components/ListModal";
import { ServiceModal } from "./components/ServiceModal";
import { ChangelogModal } from "./components/ChangelogModal";
import { serviceToText } from "./utils/parseServices";
import { checkForUpdate, downloadUpdate, installAndRelaunch } from "./update";
import { nextUpdatePhase } from "./utils/updateCheck";
import { criticalTransitions, blockedTransitions } from "./utils/transitions";
import { fireBatch, type BatchEntry } from "./utils/alerts";
import { mergeDelta } from "./utils/mergeDelta";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Alert batch window — idle-debounced, not fixed. Because Status deltas arrive per-Service,
// one probe round's edges land spread out, so the batch re-arms on every edge and only flushes
// once the round goes quiet. Quiet = `timeout_ms + 1s`: a straggling probe wave lands at most
// one timeout behind the previous one, so the configured timeout is the honest input (a
// hard-coded 4s would be a silent duplicate of it). ALERT_MAX_MS caps a batch that keeps
// re-arming, so an alert can never be starved indefinitely.
const ALERT_QUIET_PAD_MS = 1000;
const ALERT_MAX_MS = 12_000;
// Fallback quiet base when config hasn't loaded yet — matches the backend default timeout.
const DEFAULT_TIMEOUT_MS = 3000;

// Re-check for updates every 6 hours in the background (long-running machines / sleep wakeup).
const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000;

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

// Thin sortable shell for list-level drag. Only mounted inside a DndContext (when reorderMode).
// Calls useSortable and passes the ref/style/grip props down to ServiceList.
export type GripProps = {
  sortRef: (node: HTMLElement | null) => void;
  sortStyle: React.CSSProperties;
  gripListeners: DraggableSyntheticListeners;
  gripAttributes: DraggableAttributes;
};

function SortableListItem({
  list,
  ...rest
}: Omit<React.ComponentProps<typeof ServiceList>, keyof GripProps> & { list: ListStatus }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: list.id });
  const sortStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <ServiceList
      {...rest}
      list={list}
      sortRef={setNodeRef}
      sortStyle={sortStyle}
      gripListeners={listeners}
      gripAttributes={attributes}
    />
  );
}

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [reorderMode, setReorderMode] = useState(false);
  // Changelog shown once after a self-update (auto) or on demand via Settings button.
  const [changelog, setChangelog] = useState<ChangelogEntry[] | null>(null);
  // Holds the previous snapshot so we can diff for Transitions on each update.
  const prevSnapshotRef = useRef<Snapshot | null>(null);

  // Keep a ref to the latest config so the status-update callback reads fresh flags
  // without needing to re-subscribe whenever config changes.
  const configRef = useRef<Config | null>(null);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  // Mirrors for the update state — readable inside interval/event callbacks without
  // stale-closure issues (same pattern as configRef above).
  const updatePhaseRef = useRef<UpdatePhase | null>(null);
  const availableVersionRef = useRef<string | null>(null);
  useEffect(() => {
    updatePhaseRef.current = updatePhase;
  }, [updatePhase]);

  // Timestamp of the last completed update check (ms). 0 = never checked.
  const lastCheckRef = useRef<number>(0);

  // Batching: pending Transitions keyed by list id (latest edge wins), plus the open window
  // timer. Flushed once the probe round settles, into a single alert (see fireBatch).
  const pendingRef = useRef<Map<string, BatchEntry>>(new Map());
  const timerRef = useRef<number | null>(null);
  // Cut-off crossed false→true somewhere inside the open batch. Cleared by the flush.
  const cutOffEdgeRef = useRef(false);
  // When the open batch started (ms), for the ALERT_MAX_MS cap. null = no batch open.
  const batchStartRef = useRef<number | null>(null);

  // (Re-)arm the flush timer. Called on every edge-bearing snapshot, so each new edge pushes
  // the flush out by another quiet period — up to the hard cap measured from batch start.
  function armFlush() {
    const now = Date.now();
    if (batchStartRef.current === null) batchStartRef.current = now;
    const quiet = (configRef.current?.timeout_ms ?? DEFAULT_TIMEOUT_MS) + ALERT_QUIET_PAD_MS;
    const elapsed = now - batchStartRef.current;
    const delay = Math.max(0, Math.min(quiet, ALERT_MAX_MS - elapsed));
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(flushAlerts, delay);
  }

  function flushAlerts() {
    timerRef.current = null;
    batchStartRef.current = null;
    const cutOffEdge = cutOffEdgeRef.current;
    cutOffEdgeRef.current = false;

    // "all" = every critical list is now in that direction (full outage / full recovery).
    const crit = (prevSnapshotRef.current?.lists ?? []).filter((l) => l.critical);
    const allDown = crit.length > 0 && crit.every((l) => l.all_down);
    const allUp = crit.length > 0 && crit.every((l) => !l.all_down);

    // fireBatch owns the precedence rule (cut-off > blocked > outage). Entries it suppressed
    // stay pending, so an outage that outlives the cut-off is announced once cut-off clears.
    const { suppressed } = fireBatch(
      [...pendingRef.current.values()],
      {
        cutOff: prevSnapshotRef.current?.cut_off ?? false,
        cutOffEdge,
        allDown,
        allUp,
      },
      configRef.current,
    );
    if (!suppressed) pendingRef.current = new Map();
  }

  function handleSnapshot(s: Snapshot) {
    const prev = prevSnapshotRef.current;
    if (prev !== null) {
      // Critical-list outage / recovery transitions.
      const transitions = criticalTransitions(prev.lists, s.lists);
      // Critical list entering fully-blocked (TLS interception) transitions.
      // Spread order matters: blocked comes last so it overwrites a same-batch
      // "down" edge for the same list in pendingRef (blocked is more specific).
      const blocked = blockedTransitions(prev.lists, s.lists);
      const all = [...transitions, ...blocked];
      for (const t of all) {
        pendingRef.current.set(t.id, { name: t.name, dir: t.dir });
      }
      // Cut-off (total no-access) has no list id, so it can't live in the list-id-keyed
      // pendingRef — record the false→true edge on its own ref and let the flush rank it
      // against the pending list edges. First load (prev === null) is handled by the outer
      // guard; a true→false clearing is silent but still re-arms below, since it can release
      // an outage the cut-off suppressed.
      if (!prev.cut_off && s.cut_off) cutOffEdgeRef.current = true;
      // Any edge — list Transition or a cut-off change in either direction — opens or extends
      // the batch. A cut-off change alone must be able to open one: it can trip with no list
      // transition at all.
      if (all.length > 0 || prev.cut_off !== s.cut_off) {
        armFlush();
      }
    }
    prevSnapshotRef.current = s;
    setSnapshot(s);
  }

  // Centralised update check — safe to call from startup, interval, or visibility event.
  // Skips while a download is in progress (next interval will catch it instead).
  async function runUpdateCheck() {
    if (updatePhaseRef.current === "downloading") return;
    lastCheckRef.current = Date.now();
    try {
      const info = await checkForUpdate();
      const next = nextUpdatePhase(
        { phase: updatePhaseRef.current, version: availableVersionRef.current },
        info,
      );
      if (next.phase !== updatePhaseRef.current) setUpdatePhase(next.phase);
      availableVersionRef.current = next.version;
    } catch {
      // Silently ignore — failed background check is non-fatal.
    }
  }

  useEffect(() => {
    api.getSnapshot().then((s) => s && handleSnapshot(s));
    api.getConfig().then(setConfig);
    // Show the "What's new" changelog once when the app version changed since last launch.
    // Backend reads the bundled CHANGELOG, so this fires for any update path (in-app or manual).
    api.takeNewChangelog().then((entries) => {
      if (entries.length > 0) setChangelog(entries);
    });
    // status-update = full snapshot (WAN refresh + initial). service-update = per-Service delta,
    // merged onto the latest snapshot before running the same transition/alert diff.
    let unlistenStatus: (() => void) | undefined;
    let unlistenService: (() => void) | undefined;
    api.onStatusUpdate(handleSnapshot).then((fn) => {
      unlistenStatus = fn;
    });
    api.onServiceUpdate((d) => {
      const base = prevSnapshotRef.current;
      if (!base) return;
      handleSnapshot(mergeDelta(base, d));
    }).then((fn) => {
      unlistenService = fn;
    });
    // Startup check
    void runUpdateCheck();
    // Background interval: re-check every 6 h so long-running machines stay current.
    const intervalId = window.setInterval(runUpdateCheck, UPDATE_CHECK_MS);
    // Visibility re-check: webview timers throttle during laptop sleep; fire on focus
    // if at least one interval period has elapsed since the last check.
    function handleVisibilityChange() {
      if (document.visibilityState === "visible" &&
          Date.now() - lastCheckRef.current >= UPDATE_CHECK_MS) {
        void runUpdateCheck();
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      unlistenStatus?.();
      unlistenService?.();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
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

  // PointerSensor with a small activation distance so accidental clicks don't drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleListDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !snapshot) return;
    const oldIndex = snapshot.lists.findIndex((l) => l.id === active.id);
    const newIndex = snapshot.lists.findIndex((l) => l.id === over.id);
    const reordered = arrayMove(snapshot.lists, oldIndex, newIndex);
    setSnapshot({ ...snapshot, lists: reordered });
    void api.reorderLists(reordered.map((l) => l.id));
  }

  function handleReorderServices(listId: string, newIds: string[]) {
    if (!snapshot) return;
    const newLists = snapshot.lists.map((l) => {
      if (l.id !== listId) return l;
      const reordered = newIds
        .map((id) => l.services.find((s) => s.id === id))
        .filter(Boolean) as ListStatus["services"];
      return { ...l, services: reordered };
    });
    setSnapshot({ ...snapshot, lists: newLists });
    void api.reorderServices(listId, newIds);
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
    <main className={`app${snapshot?.cut_off ? " cut-off" : ""}`}>
      <StatusHero
        snapshot={snapshot}
        onRefresh={() => api.refreshNow().then(setSnapshot)}
        onAddList={() => setModal({ kind: "addList" })}
        onOpenSettings={() => setModal({ kind: "settings" })}
        onResetConfig={() =>
          api.resetConfig().then(() => window.location.reload())
        }
        onEditOrder={() => setReorderMode(true)}
        updatePhase={updatePhase}
        downloadProgress={downloadProgress}
        onDownload={handleDownload}
        onInstall={handleInstall}
      />

      <div className="lists">
        {/* ponytail: reorderMode gate — DndContext only rendered when needed; avoids
            useSortable being called outside a context (would throw). */}
        {reorderMode ? (
          <DndContext sensors={sensors} onDragEnd={handleListDragEnd}>
            <SortableContext items={lists.map((l) => l.id)} strategy={verticalListSortingStrategy}>
              {lists.map((list) => (
                <SortableListItem
                  key={list.id}
                  list={list}
                  reorderMode={true}
                  onReorderServices={handleReorderServices}
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
            </SortableContext>
          </DndContext>
        ) : (
          lists.map((list) => (
            <ServiceList
              key={list.id}
              list={list}
              reorderMode={false}
              onReorderServices={handleReorderServices}
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
          ))
        )}
        {lists.length === 0 && <p className="loading">Starting first probe…</p>}
      </div>

      {reorderMode && (
        <button className="reorder-done-btn" onClick={() => setReorderMode(false)}>
          Done
        </button>
      )}

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
          entries={changelog}
          onClose={() => setChangelog(null)}
        />
      )}

      <Settings
        config={config}
        open={modal?.kind === "settings"}
        onClose={() => setModal(null)}
        onSave={(criticalInterval, noncriticalInterval, providers, downNotify, downSound, upNotify, upSound, blockedNotify, blockedSound, volume) =>
          api
            .updateSettings(
              criticalInterval,
              noncriticalInterval,
              undefined,
              providers,
              downNotify,
              downSound,
              upNotify,
              upSound,
              blockedNotify,
              blockedSound,
              volume,
            )
            .then(setConfig)
        }
        onShowReleaseNotes={() =>
          api.getChangelog().then((entries) => {
            if (entries.length > 0) setChangelog(entries);
          })
        }
        onImport={(path) =>
          api
            .importConfig(path)
            .then(() => window.location.reload())
            .catch((e) => alert(`Import failed: ${e}`))
        }
      />
    </main>
  );
}

export default App;
