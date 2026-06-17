import { useEffect, useState } from "react";
import "./App.css";
import * as api from "./api";
import type { Config, Snapshot } from "./types";
import { Header } from "./components/Header";
import { ServiceList } from "./components/ServiceList";
import { AddServiceForm } from "./components/AddServiceForm";
import { Settings } from "./components/Settings";
import { ListModal } from "./components/ListModal";

type ModalState =
  | null
  | { kind: "addList" }
  | { kind: "editList"; id: string; name: string; icon: string }
  | { kind: "settings" };

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [modal, setModal] = useState<ModalState>(null);

  useEffect(() => {
    api.getSnapshot().then((s) => s && setSnapshot(s));
    api.getConfig().then(setConfig);
    let unlisten: (() => void) | undefined;
    api.onStatusUpdate(setSnapshot).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

  const lists = snapshot?.lists ?? [];

  async function handleSaveList(name: string, icon: string) {
    if (modal?.kind === "addList") {
      const cfg = await api.addList(name, icon);
      setConfig(cfg);
    } else if (modal?.kind === "editList") {
      const cfg = await api.updateList(modal.id, name, icon);
      setConfig(cfg);
    }
    const s = await api.refreshNow();
    setSnapshot(s);
  }

  return (
    <main className="app">
      <Header
        snapshot={snapshot}
        onRefresh={() => api.refreshNow().then(setSnapshot)}
        onAddList={() => setModal({ kind: "addList" })}
        onOpenSettings={() => setModal({ kind: "settings" })}
        onResetConfig={() =>
          api.resetConfig().then(() => window.location.reload())
        }
      />

      <div className="lists">
        {lists.map((list) => (
          <ServiceList
            key={list.id}
            list={list}
            onRemoveService={(lid, sid) => api.removeService(lid, sid)}
            onRemoveList={(lid) => api.removeList(lid)}
            onEditList={(id, name, icon) => setModal({ kind: "editList", id, name, icon })}
          />
        ))}
        {lists.length === 0 && <p className="loading">Starting first probe…</p>}
      </div>

      <AddServiceForm
        lists={lists.map((l) => ({ id: l.id, name: l.name, icon: l.icon }))}
        onAdd={(listId, label, host, port) => api.addService(listId, label, host, port)}
      />

      {(modal?.kind === "addList" || modal?.kind === "editList") && (
        <ListModal
          mode={modal.kind === "addList" ? "add" : "edit"}
          initial={
            modal.kind === "editList"
              ? { name: modal.name, icon: modal.icon }
              : { name: "", icon: "" }
          }
          onSave={handleSaveList}
          onClose={() => setModal(null)}
        />
      )}

      <Settings
        config={config}
        open={modal?.kind === "settings"}
        onClose={() => setModal(null)}
        onSave={(providers) =>
          api.updateSettings(undefined, undefined, providers)
            .then(setConfig)
            .then(() => api.refreshNow().then(setSnapshot))
        }
      />
    </main>
  );
}

export default App;
