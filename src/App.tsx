import { useEffect, useState } from "react";
import "./App.css";
import * as api from "./api";
import type { Config, Snapshot } from "./types";
import { Header } from "./components/Header";
import { ServiceList } from "./components/ServiceList";
import { AddServiceForm } from "./components/AddServiceForm";
import { Settings } from "./components/Settings";

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    api.getSnapshot().then((s) => s && setSnapshot(s));
    api.getConfig().then(setConfig);
    let unlisten: (() => void) | undefined;
    api.onStatusUpdate(setSnapshot).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

  const lists = snapshot?.lists ?? [];

  return (
    <main className="app">
      <Header snapshot={snapshot} onRefresh={() => api.refreshNow().then(setSnapshot)} />

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

      <Settings
        config={config}
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
