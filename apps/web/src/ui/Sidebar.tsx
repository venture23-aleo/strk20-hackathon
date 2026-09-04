import { useState } from "react";
import { store } from "../lib/store.js";
import { shorten } from "./Onboarding.js";

export function Sidebar({
  active,
  onSelect,
}: {
  active: string | null;
  onSelect: (label: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [peer, setPeer] = useState("");

  const add = async () => {
    if (!label.trim() || !peer.trim()) return;
    const contact = await store.addContact(label.trim(), peer.trim());
    setAdding(false);
    setLabel("");
    setPeer("");
    onSelect(contact.label);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span>Contacts</span>
        <button className="ghost" onClick={() => setAdding(!adding)}>
          {adding ? "cancel" : "+ add"}
        </button>
      </div>
      {adding && (
        <div className="add-contact">
          <input placeholder="Name" value={label} onChange={(e) => setLabel(e.target.value)} />
          <input
            placeholder="Starknet address (0x…)"
            value={peer}
            onChange={(e) => setPeer(e.target.value)}
          />
          <button className="primary" onClick={() => void add()}>
            Add contact
          </button>
          <p className="hint">
            Try any address — in demo mode new peers start <em>unregistered</em> so you can see
            that flow.
          </p>
        </div>
      )}
      <ul className="contact-list">
        {store.contacts.map((c) => (
          <li key={c.label}>
            <button
              className={`contact ${c.label === active ? "active" : ""}`}
              onClick={() => onSelect(c.label)}
            >
              <span className="contact-name">{c.label}</span>
              <span className="contact-addr">{shorten(c.peer)}</span>
              {!c.registered && <span className="badge warn">unregistered</span>}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
