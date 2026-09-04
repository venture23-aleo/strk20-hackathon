import { useState } from "react";
import { parseInvite } from "../lib/contacts.js";
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
  const [inviteText, setInviteText] = useState("");
  const invite = inviteText.trim() ? parseInvite(inviteText) : null;

  const reset = () => {
    setAdding(false);
    setLabel("");
    setPeer("");
    setInviteText("");
  };

  const add = async () => {
    if (!label.trim()) return;
    const contact = invite
      ? // Paired contact: the invite carries the mirrored lane keys.
        await store.addContact(label.trim(), invite.peer, {
          outKey: invite.yourOutKey,
          inKey: invite.yourInKey,
        })
      : peer.trim()
        ? await store.addContact(label.trim(), peer.trim())
        : null;
    if (!contact) return;
    reset();
    onSelect(contact.label);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span>Contacts</span>
        <button className="ghost" onClick={() => (adding ? reset() : setAdding(true))}>
          {adding ? "cancel" : "+ add"}
        </button>
      </div>
      {adding && (
        <div className="add-contact">
          <input placeholder="Name" value={label} onChange={(e) => setLabel(e.target.value)} />
          {!invite && (
            <input
              placeholder="Starknet address (0x…)"
              value={peer}
              onChange={(e) => setPeer(e.target.value)}
            />
          )}
          <textarea
            rows={3}
            placeholder="…or paste an invite from the other person (thread head → copy invite)"
            value={inviteText}
            onChange={(e) => setInviteText(e.target.value)}
          />
          {inviteText.trim() !== "" && (
            <p className={invite ? "hint invite-ok" : "error"}>
              {invite
                ? `✓ invite from ${shorten(invite.peer)} — lanes will pair with their thread`
                : "that doesn't look like an invite"}
            </p>
          )}
          <button className="primary" disabled={!label.trim() || (!invite && !peer.trim())} onClick={() => void add()}>
            {invite ? "Add paired contact" : "Add contact"}
          </button>
          <p className="hint">
            An invite pairs both clients onto the same encrypted lanes. Without one, a new
            contact gets fresh lanes — the other side then needs <em>your</em> invite to reply.
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
