import { useEffect, useState } from "react";
import "./App.css";
import * as api from "./api";
import type { Config, ServiceDraft, Snapshot } from "./types";
import { StatusHero } from "./components/StatusHero";
import { ServiceList } from "./components/ServiceList";
import { Settings } from "./components/Settings";
import { ListModal } from "./components/ListModal";
import { ServiceModal } from "./components/ServiceModal";
import { serviceToText } from "./utils/parseServices";

type ModalState =
  | null
  | { kind: "addList" }
  | { kind: "editList"; id: string; name: string; icon: string }
  | { kind: "addService"; listId: string; listName: string }
  | { kind: "editService"; listId: string; serviceId: string; listName: string; initial: string }
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
  }

  async function handleSaveService(drafts: ServiceDraft[]) {
    if (modal?.kind === "addService") {
      const cfg = await api.addServices(modal.listId, drafts);
      setConfig(cfg);
    } else if (modal?.kind === "editService") {
      // Edit: use only the first parsed draft
      const draft = drafts[0];
      if (!draft) return;
      const cfg = await api.updateService(modal.listId, modal.serviceId, draft.label, draft.endpoints);
      setConfig(cfg);
    }
  }

  function handleOpenEdit(listId: string, serviceId: string, listName: string) {
    const list = config?.lists.find((l) => l.id === listId);
    const svc = list?.services.find((s) => s.id === serviceId);
    if (!svc) return;
    setModal({ kind: "editService", listId, serviceId, listName, initial: serviceToText(svc) });
  }

  return (
    <main className="app">
      <StatusHero
        snapshot={snapshot}
        onRefresh={() => api.refreshNow().then(setSnapshot)}
        onAddList={() => setModal({ kind: "addList" })}
        onOpenSettings={() => setModal({ kind: "settings" })}
        onResetConfig={() => api.resetConfig().then(() => window.location.reload())}
      />

      <div className="lists">
        {lists.map((list) => (
          <ServiceList
            key={list.id}
            list={list}
            onRemoveService={(lid, sid) => api.removeService(lid, sid)}
            onRemoveList={(lid) => api.removeList(lid)}
            onEditList={(id, name, icon) => setModal({ kind: "editList", id, name, icon })}
            onAddService={(listId, listName) => setModal({ kind: "addService", listId, listName })}
            onEditService={(listId, serviceId) => handleOpenEdit(listId, serviceId, list.name)}
          />
        ))}
        {lists.length === 0 && <p className="loading">Starting first probe…</p>}
      </div>

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

      {(modal?.kind === "addService" || modal?.kind === "editService") && (
        <ServiceModal
          mode={modal.kind === "addService" ? "add" : "edit"}
          listName={modal.listName}
          initial={modal.kind === "editService" ? modal.initial : undefined}
          onSave={handleSaveService}
          onClose={() => setModal(null)}
        />
      )}

      <Settings
        config={config}
        open={modal?.kind === "settings"}
        onClose={() => setModal(null)}
        onSave={(providers) =>
          api.updateSettings(undefined, undefined, providers).then(setConfig)
        }
      />
    </main>
  );
}

export default App;
