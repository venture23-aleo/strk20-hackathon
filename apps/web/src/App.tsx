import { useSyncExternalStore, useState } from "react";
import { store } from "./lib/store.js";
import { Chrome } from "./ui/Chrome.js";
import { Onboarding } from "./ui/Onboarding.js";
import { OutboxBar } from "./ui/OutboxBar.js";
import { Settings } from "./ui/Settings.js";
import { Sidebar } from "./ui/Sidebar.js";
import { ThreadView } from "./ui/ThreadView.js";

export function App() {
  useSyncExternalStore(store.subscribe, store.getVersion);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  if (!store.config?.onboarded) return <Onboarding />;

  const active = store.contacts.find((c) => c.label === activeLabel) ?? store.contacts[0] ?? null;

  return (
    <div className="app">
      <Chrome onSettings={() => setShowSettings(true)} />
      <div className="body">
        <Sidebar active={active?.label ?? null} onSelect={setActiveLabel} />
        <main className="thread-pane">
          {active ? (
            <ThreadView contact={active} />
          ) : (
            <div className="empty-state">
              <h2>No conversations yet</h2>
              <p>Add a contact to start a thread. Messages are end-to-end encrypted and permanent.</p>
            </div>
          )}
        </main>
      </div>
      <OutboxBar />
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
