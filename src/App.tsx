import { useEffect, useRef, useState } from "react";
import "./App.css";
import * as api from "./api";
import type { ChangelogEntry } from "./api";
import type { Config, ListStatus, Service, ServiceDraft, Snapshot } from "./types";
import { StatusHero } from "./components/StatusHero";
import { HeroMenu } from "./components/HeroMenu";
import { Icon } from "./components/Icon";
import { ServiceList } from "./components/ServiceList";
import { Settings } from "./components/Settings";
import { ListModal } from "./components/ListModal";
import { ServiceModal } from "./components/ServiceModal";
import { ChangelogModal } from "./components/ChangelogModal";
import { checkForUpdate, downloadUpdate, installAndRelaunch } from "./update";
import { nextUpdatePhase } from "./utils/updateCheck";
import { criticalTransitions, blockedTransitions } from "./utils/transitions";
import { fireBatch, reconcilePending, type BatchEntry } from "./utils/alerts";
import { mergeDelta } from "./utils/mergeDelta";
import { LIST_EDGE_PX, LIST_GAP_PX, LIST_MAX_PX, columnCount, toColumns } from "./utils/listColumns";
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
// once the round goes quiet. Quiet = `timeout_ms + 1s`. `timeout_ms` is only the TCP-connect
// timeout (the HTTPS step has its own 5s), so a straggler can land later than this; that's
// harmless because a round's snapshot only settles once its last probe lands, and unsettled
// snapshots are never diffed (ADR-0029). ALERT_MAX_MS caps a batch that keeps re-arming, so an
// alert can never be starved indefinitely.
const ALERT_QUIET_PAD_MS = 1000;
const ALERT_MAX_MS = 12_000;
// Fallback quiet base when config hasn't loaded yet — matches the backend default timeout.
const DEFAULT_TIMEOUT_MS = 3000;

// Re-check for updates every 6 hours in the background (long-running machines / sleep wakeup).
const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000;

// --- System wake -------------------------------------------------------------------------
// The webview's timers stop while the machine is asleep, so a heartbeat tick that comes back
// with far more wall clock elapsed than its own interval is the wake signal. No OS API is
// involved, so this works identically on Windows and Linux.
const WAKE_TICK_MS = 5_000;
// Gap that counts as a suspension rather than WebKit throttling a hidden window (which caps out
// around 1 tick/s). A false positive costs one silent grace window, never a lost alert.
const WAKE_GAP_MS = 20_000;
// After a wake the OS spends several seconds re-establishing wifi/DHCP/DNS/VPN. Probes in that
// window fail honestly but describe the wake, not an outage the user had — so alerts are held
// until the network proves itself (a settled snapshot with no cut-off) or this cap expires.
// ponytail: fixed cap rather than a configurable one. Upgrade path: derive it from observed
// post-wake recovery times only if real machines are shown to need longer.
const WAKE_GRACE_MAX_MS = 20_000;

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
      initial: Service;
    }
  | { kind: "settings" };

export type UpdatePhase = "available" | "downloading" | "ready";

/**
 * Is this snapshot a measurement, safe to diff for alerts? The backend's `settled` says no endpoint
 * is Checking — except that re-checking one service by hand marks just that row Checking and leaves
 * `settled` alone (so the rest of the app does not look like it is refreshing). A snapshot that still
 * has a Checking row is a placeholder for that row, not a result: diffing it would make the row's
 * own re-check look like a brand-new transition (e.g. an already-blocked list "becoming" blocked).
 */
export function isSettled(s: Snapshot): boolean {
  return (
    s.settled &&
    !s.lists.some((l) => l.services.some((sv) => sv.endpoints.some((e) => e.state === "checking")))
  );
}

/** Edit order needs something to order. Asked by the hero menu and the native app menu. */
export function canEditOrder(s: Snapshot | null): boolean {
  return !!s?.lists.length;
}

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
    transform: CSS.Translate.toString(transform),
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
  const [config, setConfigState] = useState<Config | null>(null);
  const [modal, setModalState] = useState<ModalState>(null);
  // Mirrored for the app-menu listener, subscribed once at mount.
  const modalRef = useRef<ModalState>(null);
  function setModal(m: ModalState) {
    modalRef.current = m;
    setModalState(m);
  }
  const [updatePhase, setUpdatePhaseState] = useState<UpdatePhase | null>(null);
  const [updateVersion, setUpdateVersionState] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [reorderMode, setReorderMode] = useState(false);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // Changelog shown once after a self-update (auto) or on demand via Settings button.
  const [changelog, setChangelog] = useState<ChangelogEntry[] | null>(null);
  // One inline message for anything the backend refused or couldn't save, plus the startup
  // "config was unusable and moved aside" warning. Dismissed by the user.
  const [notice, setNotice] = useState<string | null>(null);
  const report = (err: unknown) => setNotice(String(err));
  // The last snapshot handed to the UI — the merge base for per-Service deltas.
  const prevSnapshotRef = useRef<Snapshot | null>(null);
  // The ☰ drawer and the native ⇧⌘O share it: a second press ends ordering.
  const toggleEditOrder = () =>
    setReorderMode((on) => !on && canEditOrder(prevSnapshotRef.current));
  // The last *settled* snapshot — the Transition baseline. Unsettled snapshots are displayed but
  // never diffed and never become the baseline: their `all_down: false` means "not measured yet",
  // not "recovered" (ADR-0029).
  const baselineRef = useRef<Snapshot | null>(null);

  // The latest config for timer/event callbacks, written in the same call as the state — an effect
  // would leave it stale until React commits, and a flush in that gap would reconcile pending
  // alerts against the pre-delete config.
  const configRef = useRef<Config | null>(null);
  function setConfig(c: Config) {
    configRef.current = c;
    setConfigState(c);
  }

  // App is the only owner of update state (the hero button and Settings both render it), so two
  // views can't hold two answers (audit A12). The refs mirror it synchronously for callbacks: a
  // check fired right after `setUpdatePhase("downloading")` must already see it.
  const updatePhaseRef = useRef<UpdatePhase | null>(null);
  const availableVersionRef = useRef<string | null>(null);
  function setUpdatePhase(phase: UpdatePhase | null) {
    updatePhaseRef.current = phase;
    setUpdatePhaseState(phase);
  }
  function setUpdateVersion(version: string | null) {
    availableVersionRef.current = version;
    setUpdateVersionState(version);
  }

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
  // Wall-clock time of the last edge that armed the batch. Read only to spot a batch that
  // outlived a process suspension — see armFlush.
  const lastEdgeAtRef = useRef(0);
  // Wall-clock time the process was last seen running (see detectWake). A large gap means it was
  // suspended.
  const lastTickRef = useRef(Date.now());
  // While non-null, the deadline (ms) of the open post-wake grace window: snapshots repaint but
  // are not diffed, and the baseline stays at the pre-sleep state.
  const wakeGraceUntilRef = useRef<number | null>(null);
  const graceTimerRef = useRef<number | null>(null);

  /**
   * Did the process just come back from a suspension (system sleep / App Nap)? Any callback can
   * be the first to run after resume — the 4s alert timer often beats the 5s heartbeat — so each
   * entry point asks before acting on what it holds (audit A09).
   */
  function detectWake(): boolean {
    const now = Date.now();
    const gap = now - lastTickRef.current;
    lastTickRef.current = now;
    if (gap <= WAKE_GAP_MS) return false;
    handleWake();
    return true;
  }

  // (Re-)arm the flush timer. Called on every edge-bearing snapshot, so each new edge pushes
  // the flush out by another quiet period — up to the hard cap measured from batch start.
  function armFlush() {
    const now = Date.now();
    const quiet = (configRef.current?.timeout_ms ?? DEFAULT_TIMEOUT_MS) + ALERT_QUIET_PAD_MS;
    // A live batch always flushes within `quiet` of its last edge, so a longer gap proves the
    // timer never ran — the webview was suspended (system sleep / App Nap). Its batch start is
    // now that whole suspension old on the wall clock, which drives ALERT_MAX_MS negative and
    // collapses the delay to 0ms. Treat it as a fresh batch instead.
    if (batchStartRef.current !== null && now - lastEdgeAtRef.current > quiet) {
      batchStartRef.current = null;
    }
    lastEdgeAtRef.current = now;
    if (batchStartRef.current === null) batchStartRef.current = now;
    const elapsed = now - batchStartRef.current;
    const delay = Math.max(0, Math.min(quiet, ALERT_MAX_MS - elapsed));
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(flushAlerts, delay);
  }

  /**
   * Close the post-wake grace window: one diff of the settled state the user is now looking at
   * against the state they last saw, then flush anything an interrupted batch still owes.
   *
   * The second half matters on its own: an edge collected just before the sleep never reached
   * the user, and `diffAgainstBaseline` has already advanced the baseline past it, so nothing
   * else would ever announce it.
   */
  function endWakeGrace(s: Snapshot | null) {
    wakeGraceUntilRef.current = null;
    if (s && isSettled(s)) diffAgainstBaseline(s);
    // A cut-off edge alone is owed too: it has no list id, so it never enters pendingRef (A10).
    const owed = pendingRef.current.size > 0 || cutOffEdgeRef.current;
    if (owed && timerRef.current === null) armFlush();
  }

  /**
   * A wake was detected. Stop the timer the sleep froze — its delay is meaningless now — but
   * keep the pending entries: what the user is owed is one diff of the settled post-wake state
   * against the state they last saw, plus whatever the interrupted batch had already collected.
   */
  function handleWake() {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    batchStartRef.current = null;
    const deadline = Date.now() + WAKE_GRACE_MAX_MS;
    wakeGraceUntilRef.current = deadline;
    // The window must close even if no further snapshot arrives: a Service that settled to Down
    // backs off to 120s (scheduler::BACKOFF_CEILING), which would otherwise hold a real
    // "you're offline" for that long.
    graceTimerRef.current = window.setTimeout(() => {
      // Superseded by a later wake, or already closed by a snapshot.
      if (wakeGraceUntilRef.current !== deadline) return;
      endWakeGrace(prevSnapshotRef.current);
    }, WAKE_GRACE_MAX_MS);
  }

  function flushAlerts() {
    timerRef.current = null;
    // Fired first after a sleep: what it holds describes the sleep, not the user's present.
    // handleWake keeps it pending; the grace window pays it out.
    if (detectWake()) return;
    batchStartRef.current = null;
    pendingRef.current = reconcilePending(pendingRef.current, configRef.current?.lists);
    const cutOffEdge = cutOffEdgeRef.current;
    cutOffEdgeRef.current = false;

    // "all" = every critical list is now in that direction (full outage / full recovery).
    const crit = (baselineRef.current?.lists ?? []).filter((l) => l.critical);
    const allDown = crit.length > 0 && crit.every((l) => l.all_down);
    const allUp = crit.length > 0 && crit.every((l) => !l.all_down);

    // fireBatch owns the precedence rule (cut-off > blocked > outage). Entries it suppressed
    // stay pending, so an outage that outlives the cut-off is announced once cut-off clears.
    const { suppressed } = fireBatch(
      [...pendingRef.current.values()],
      {
        cutOff: baselineRef.current?.cut_off ?? false,
        cutOffEdge,
        allDown,
        allUp,
      },
      configRef.current,
    );
    if (!suppressed) pendingRef.current = new Map();
  }

  /**
   * Collect the Transition edges between the last settled snapshot and `s`, then advance the
   * baseline and arm the flush if there is anything to say. Only ever called with a settled `s`.
   */
  function diffAgainstBaseline(s: Snapshot) {
    const prev = baselineRef.current;
    baselineRef.current = s;
    if (prev === null) return; // no baseline yet — first settled round
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
    // against the pending list edges. A true→false clearing is silent but still re-arms
    // below, since it can release an outage the cut-off suppressed.
    if (!prev.cut_off && s.cut_off) cutOffEdgeRef.current = true;
    // Any edge — list Transition or a cut-off change in either direction — opens or extends
    // the batch. A cut-off change alone must be able to open one: it can trip with no list
    // transition at all.
    if (all.length > 0 || prev.cut_off !== s.cut_off) {
      armFlush();
    }
  }

  function handleSnapshot(s: Snapshot) {
    detectWake();
    if (isSettled(s)) {
      const graceUntil = wakeGraceUntilRef.current;
      if (graceUntil === null) {
        diffAgainstBaseline(s);
      } else if (!s.cut_off || Date.now() >= graceUntil) {
        // The network proved itself, or the window ran out. Either way this is the settled
        // state the one post-wake diff should describe.
        endWakeGrace(s);
      }
      // Otherwise: still inside the window — repaint only, baseline untouched.
    }
    showSnapshot(s);
  }

  /**
   * The only way a snapshot reaches the screen. Keeps the delta merge base (`prevSnapshotRef`) and
   * the rendered state in step: a `setSnapshot` that skipped the ref would let the next
   * `service-update` merge onto an older snapshot and revert whatever changed (audit A05/R3).
   */
  function showSnapshot(s: Snapshot) {
    prevSnapshotRef.current = s;
    setSnapshot(s);
  }

  /** A layout write (reorder/collapse) was refused: say why and repaint from the backend's truth. */
  function layoutRejected(err: unknown) {
    report(err);
    api.getSnapshot().then((s) => s && handleSnapshot(s));
  }

  /**
   * The one update check — startup, interval, visibility and Settings' button all call it.
   * Resolves true when an update is available/downloading/ready; rejects when the check failed.
   * Skipped while a download is in progress (that download is the answer).
   */
  async function runUpdateCheck(): Promise<boolean> {
    if (updatePhaseRef.current === "downloading") return true;
    lastCheckRef.current = Date.now();
    const info = await checkForUpdate();
    const next = nextUpdatePhase(
      { phase: updatePhaseRef.current, version: availableVersionRef.current },
      info,
    );
    if (next.phase !== updatePhaseRef.current) setUpdatePhase(next.phase);
    setUpdateVersion(next.version);
    return next.phase !== null;
  }
  // A failed background check is non-fatal; the next interval retries.
  const backgroundUpdateCheck = () => void runUpdateCheck().catch(() => {});

  useEffect(() => {
    api.getSnapshot().then((s) => s && handleSnapshot(s), report);
    api.getConfig().then(setConfig, report);
    api.takeLoadWarning().then((w) => w && setNotice(w));
    // Show the "What's new" changelog once when the app version changed since last launch.
    // Backend reads the bundled CHANGELOG, so this fires for any update path (in-app or manual).
    api.takeNewChangelog().then((entries) => {
      if (entries.length > 0) setChangelog(entries);
    });
    // status-update = full snapshot (WAN refresh + initial). service-update = per-Service delta,
    // merged onto the latest snapshot before running the same transition/alert diff.
    // `listen` resolves asynchronously; an unmount before it does must still unlisten (B05).
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    const keep = (fn: () => void) => (disposed ? fn() : unlisteners.push(fn));
    api.onStatusUpdate(handleSnapshot).then(keep);
    api.onServiceUpdate((d) => {
      const base = prevSnapshotRef.current;
      if (!base) return;
      handleSnapshot(mergeDelta(base, d));
    }).then(keep);
    // The native app menu (macOS). A dialog already open wins: replacing it would drop its edits.
    api.onMenuAction((action) => {
      if (modalRef.current) return;
      if (action === "edit-order") toggleEditOrder();
      else setModal({ kind: action === "settings" ? "settings" : "addList" });
    }).then(keep);
    // Startup check
    backgroundUpdateCheck();
    // Background interval: re-check every 6 h so long-running machines stay current.
    const intervalId = window.setInterval(backgroundUpdateCheck, UPDATE_CHECK_MS);
    // Wake detector: a tick that observes far more wall clock than its own interval means the
    // process was suspended (system sleep / App Nap).
    const heartbeatId = window.setInterval(detectWake, WAKE_TICK_MS);
    // Visibility re-check: webview timers throttle during laptop sleep; fire on focus
    // if at least one interval period has elapsed since the last check.
    function handleVisibilityChange() {
      if (document.visibilityState === "visible" &&
          Date.now() - lastCheckRef.current >= UPDATE_CHECK_MS) {
        backgroundUpdateCheck();
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      disposed = true;
      unlisteners.forEach((fn) => fn());
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (graceTimerRef.current !== null) window.clearTimeout(graceTimerRef.current);
      window.clearInterval(intervalId);
      window.clearInterval(heartbeatId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  /** Resolves true once the update is on disk. */
  async function handleDownload(): Promise<boolean> {
    if (updatePhaseRef.current !== "available") return updatePhaseRef.current === "ready";
    setUpdatePhase("downloading");
    setDownloadProgress(0);
    try {
      await downloadUpdate(setDownloadProgress);
      setUpdatePhase("ready");
      return true;
    } catch {
      setUpdatePhase("available");
      return false;
    }
  }

  async function handleInstall() {
    try {
      await installAndRelaunch();
    } catch {
      setUpdatePhase("ready");
    }
  }

  async function handleInstallNow() {
    if (await handleDownload()) await handleInstall();
  }

  const lists = snapshot?.lists ?? [];
  // Edit order is one column: a straight vertical drag.
  const cols = reorderMode ? 1 : columnCount(windowWidth, lists.length);

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
      // Edit mode always yields exactly one draft (separate Label + Endpoints fields).
      const draft = drafts[0];
      if (!draft) return;
      const cfg = await api.updateService(
        modal.listId,
        modal.serviceId,
        draft.label,
        draft.endpoints,
        draft.check_block ?? false,
      );
      setConfig(cfg);
    }
  }

  // PointerSensor with a small activation distance so accidental clicks don't drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Layout edits paint optimistically through showSnapshot (so the merge base moves with them);
  // the backend then saves, applies the same layout to its live snapshot and pushes it.
  function handleListDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const base = prevSnapshotRef.current;
    if (!over || active.id === over.id || !base) return;
    const oldIndex = base.lists.findIndex((l) => l.id === active.id);
    const newIndex = base.lists.findIndex((l) => l.id === over.id);
    const reordered = arrayMove(base.lists, oldIndex, newIndex);
    showSnapshot({ ...base, lists: reordered });
    api.reorderLists(reordered.map((l) => l.id)).then(setConfig, layoutRejected);
  }

  function handleReorderServices(listId: string, newIds: string[]) {
    const base = prevSnapshotRef.current;
    if (!base) return;
    const newLists = base.lists.map((l) => {
      if (l.id !== listId) return l;
      const reordered = newIds
        .map((id) => l.services.find((s) => s.id === id))
        .filter(Boolean) as ListStatus["services"];
      return { ...l, services: reordered };
    });
    showSnapshot({ ...base, lists: newLists });
    api.reorderServices(listId, newIds).then(setConfig, layoutRejected);
  }

  function handleToggleCollapse(listId: string, collapsed: boolean) {
    const base = prevSnapshotRef.current;
    if (!base) return;
    showSnapshot({
      ...base,
      lists: base.lists.map((l) => (l.id === listId ? { ...l, collapsed } : l)),
    });
    api.setListCollapsed(listId, collapsed).then(setConfig, layoutRejected);
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
      initial: svc,
    });
  }

  return (
    <main
      className={`app${snapshot?.cut_off ? " cut-off" : ""}`}
      style={
        {
          "--cols": cols,
          "--list-max": `${LIST_MAX_PX}px`,
          "--list-gap": `${LIST_GAP_PX}px`,
          "--list-edge": `${LIST_EDGE_PX}px`,
        } as React.CSSProperties
      }
    >
      <StatusHero
        snapshot={snapshot}
        icon={config?.status_icon ?? "pulse"}
        onRefresh={api.refreshNow}
        menu={
          <HeroMenu
            onAddList={() => setModal({ kind: "addList" })}
            onEditOrder={toggleEditOrder}
            onOpenSettings={() => setModal({ kind: "settings" })}
            canEditOrder={canEditOrder(snapshot)}
            editingOrder={reorderMode}
          />
        }
        updatePhase={updatePhase}
        downloadProgress={downloadProgress}
        onDownload={handleDownload}
        onInstall={handleInstall}
      />

      {notice && (
        <div className="notice" role="alert">
          <Icon name="alert" size={18} />
          <span>{notice}</span>
          <button className="notice-close" aria-label="Dismiss" onClick={() => setNotice(null)}>
            <Icon name="x" size={16} />
          </button>
        </div>
      )}

      {/* The lists scroll under the hero; their top edge fades out (see .lists). */}
      <div className="lists-wrap">
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
                    onToggleCollapse={handleToggleCollapse}
                    onEditOrder={() => setReorderMode(true)}
                    onRemoveService={(lid, sid) => api.removeService(lid, sid).then(setConfig, report)}
                    onRemoveList={(lid) => api.removeList(lid).then(setConfig, report)}
                    onEditList={(id, name, icon, critical) =>
                      setModal({ kind: "editList", id, name, icon, critical })
                    }
                    onAddService={(listId, listName) =>
                      setModal({ kind: "addService", listId, listName })
                    }
                    onEditService={(listId, serviceId) =>
                      handleOpenEdit(listId, serviceId, list.name)
                    }
                    onCheckService={() => {}} // reorder mode: names are not clickable
                    onCheckList={() => {}}
                  />
                ))}
              </SortableContext>
            </DndContext>
          ) : (
            toColumns(lists, cols).map((column, c) => (
              <div className="lists-col" key={c}>
                {column.map((list) => (
              <ServiceList
                key={list.id}
                list={list}
                reorderMode={false}
                onReorderServices={handleReorderServices}
                onToggleCollapse={handleToggleCollapse}
                onEditOrder={() => setReorderMode(true)}
                onRemoveService={(lid, sid) => api.removeService(lid, sid).then(setConfig, report)}
                onRemoveList={(lid) => api.removeList(lid).then(setConfig, report)}
                onEditList={(id, name, icon, critical) =>
                  setModal({ kind: "editList", id, name, icon, critical })
                }
                onAddService={(listId, listName) =>
                  setModal({ kind: "addService", listId, listName })
                }
                onEditService={(listId, serviceId) =>
                  handleOpenEdit(listId, serviceId, list.name)
                }
                onCheckService={(listId, serviceId, endpointId) =>
                  api.checkNow(listId, serviceId, endpointId).catch(report)
                }
                onCheckList={(listId) => api.checkList(listId).catch(report)}
              />
                ))}
              </div>
            ))
          )}
          {lists.length === 0 &&
            (config?.lists.length === 0 ? (
              <p className="loading">
                No lists yet —{" "}
                <button className="link-btn" onClick={() => setModal({ kind: "addList" })}>
                  Add list
                </button>
              </p>
            ) : (
              <p className="loading">Starting first probe…</p>
            ))}
        </div>
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
        onSave={(patch) => api.updateSettings(patch).then(setConfig)}
        onResetConfig={() =>
          api.resetConfig().then(() => window.location.reload(), report)
        }
        updater={{
          phase: updatePhase,
          version: updateVersion,
          progress: downloadProgress,
          check: runUpdateCheck,
          installNow: handleInstallNow,
        }}
        onShowReleaseNotes={() =>
          api.getChangelog().then((entries) => {
            if (entries.length > 0) setChangelog(entries);
          })
        }
        onImport={(path) =>
          api
            .importConfig(path)
            .then(() => window.location.reload())
            .catch((err) => {
              setModal(null); // the notice renders behind the Settings modal
              report(err);
            })
        }
      />
    </main>
  );
}

export default App;
