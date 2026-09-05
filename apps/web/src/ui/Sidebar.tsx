import { useState } from "react";
import { parseInvite } from "../lib/contacts.js";
import { parseGroupInvite } from "../lib/groups.js";
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
      <GroupsSection active={active} onSelect={onSelect} />
    </aside>
  );
}

function GroupsSection({
  active,
  onSelect,
}: {
  active: string | null;
  onSelect: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [membersText, setMembersText] = useState("");
  const [inviteText, setInviteText] = useState("");
  const invite = inviteText.trim() ? parseGroupInvite(inviteText) : null;

  const reset = () => {
    setAdding(false);
    setName("");
    setMembersText("");
    setInviteText("");
  };

  const create = () => {
    if (invite) {
      const g = store.joinGroup(invite);
      reset();
      onSelect(`#${g.name}`);
      return;
    }
    if (!name.trim()) return;
    const members = membersText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter((s) => /^0x[0-9a-fA-F]+$/.test(s))
      .map((address) => ({ address }));
    const g = store.createGroup(name.trim().replace(/^#/, ""), members);
    reset();
    onSelect(`#${g.name}`);
  };

  return (
    <>
      <div className="sidebar-head">
        <span>Groups</span>
        <button className="ghost" onClick={() => (adding ? reset() : setAdding(true))}>
          {adding ? "cancel" : "+ group"}
        </button>
      </div>
      {adding && (
        <div className="add-contact">
          {!invite && (
            <>
              <input placeholder="Group name" value={name} onChange={(e) => setName(e.target.value)} />
              <textarea
                rows={3}
                placeholder="Member addresses, one per line (you are included automatically)"
                value={membersText}
                onChange={(e) => setMembersText(e.target.value)}
              />
            </>
          )}
          <textarea
            rows={3}
            placeholder="…or paste a group invite (joining reveals the group's full history)"
            value={inviteText}
            onChange={(e) => setInviteText(e.target.value)}
          />
          {inviteText.trim() !== "" && (
            <p className={invite ? "hint invite-ok" : "error"}>
              {invite
                ? `✓ invite to #${invite.name} · ${invite.members.length} members`
                : "that doesn't look like a group invite"}
            </p>
          )}
          <button
            className="primary"
            disabled={!invite && !name.trim()}
            onClick={create}
          >
            {invite ? `Join #${invite.name}` : "Create group"}
          </button>
        </div>
      )}
      <ul className="contact-list">
        {store.groups.map((g) => (
          <li key={g.name}>
            <button
              className={`contact ${`#${g.name}` === active ? "active" : ""}`}
              onClick={() => onSelect(`#${g.name}`)}
            >
              <span className="contact-name">#{g.name}</span>
              <span className="contact-addr">{g.members.length} members</span>
            </button>
          </li>
        ))}
        {store.groups.length === 0 && !adding && (
          <li className="hint" style={{ padding: "4px 14px 10px" }}>
            (no groups)
          </li>
        )}
      </ul>
    </>
  );
}
