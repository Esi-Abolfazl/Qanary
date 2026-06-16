import { useEffect, useState } from "react";
import "./App.css";
import * as api from "./api";
import type { Snapshot } from "./types";
import { Header } from "./components/Header";
import { ServiceList } from "./components/ServiceList";
import { AddServiceForm } from "./components/AddServiceForm";
import { checkForUpdate, downloadAndInstall, type UpdateInfo } from "./update";

type UpdateState = "idle" | "checking" | "available" | "installing" | "up-to-date" | "error";

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState>("idle");

  useEffect(() => {
    // Seed from the last stored snapshot, then listen for live pushes from the probe loop.
    api.getSnapshot().then((s) => s && setSnapshot(s));
    let unlisten: (() => void) | undefined;
    api.onStatusUpdate(setSnapshot).then((fn) => {
      unlisten = fn;
    });
    // Silent startup check — no noise if up to date.
    checkForUpdate().then((info) => {
      if (info) { setUpdateInfo(info); setUpdateState("available"); }
    }).catch(() => { /* silent on startup */ });
    return () => unlisten?.();
  }, []);

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

  const lists = snapshot?.lists ?? [];

  return (
    <main className="app">
      <Header snapshot={snapshot} onRefresh={() => api.refreshNow().then(setSnapshot)} />

      {updateState === "available" && updateInfo && (
        <div className="update-banner">
          <span>Update available: v{updateInfo.version}</span>
          <button className="update-btn" onClick={handleInstall}>Install &amp; restart</button>
        </div>
      )}

      <div className="lists">
        {lists.map((list) => (
          <ServiceList
            key={list.id}
            list={list}
            onRemoveService={(lid, sid) => api.removeService(lid, sid)}
            onRemoveList={(lid) => api.removeList(lid)}
          />
        ))}
        {lists.length === 0 && <p className="loading">Starting first probe…</p>}
      </div>

      <AddServiceForm
        lists={lists.map((l) => ({ id: l.id, name: l.name }))}
        onAdd={(listId, label, host, port) => api.addService(listId, label, host, port)}
        onAddList={(name, kind) => api.addList(name, kind)}
      />

      <div className="update-footer">
        {updateState === "installing" && <span className="update-msg">Installing…</span>}
        {updateState === "up-to-date" && <span className="update-msg">Already up to date.</span>}
        {updateState === "error" && <span className="update-msg update-err">Update check failed.</span>}
        <button
          className="update-check-btn"
          onClick={handleCheckUpdate}
          disabled={updateState === "checking" || updateState === "installing"}
        >
          {updateState === "checking" ? "Checking…" : "Check for updates"}
        </button>
      </div>
    </main>
  );
}

export default App;
