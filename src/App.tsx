import { useEffect, useState } from "react";
import "./App.css";
import * as api from "./api";
import type { Snapshot } from "./types";
import { Header } from "./components/Header";
import { ServiceList } from "./components/ServiceList";
import { AddServiceForm } from "./components/AddServiceForm";

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    // Seed from the last stored snapshot, then listen for live pushes from the probe loop.
    api.getSnapshot().then((s) => s && setSnapshot(s));
    let unlisten: (() => void) | undefined;
    api.onStatusUpdate(setSnapshot).then((fn) => {
      unlisten = fn;
    });
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
    </main>
  );
}

export default App;
