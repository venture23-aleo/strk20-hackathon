import { useState } from "react";
import { fmtUsd, tierPreview } from "../lib/costs.js";
import { makeGroupInvite, stitchGroupThread, type Group } from "../lib/groups.js";
import { store } from "../lib/store.js";

export function GroupView({ group }: { group: Group }) {
  const [draft, setDraft] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const me = store.identity;
  const history = store.engine?.history() ?? [];
  const thread = stitchGroupThread(history, group, me);
  const preview = tierPreview(draft);

  const queueDraft = () => {
    if (!draft.trim() || !preview.tier) return;
    store.queueToGroup(group, draft);
    setDraft("");
  };

  return (
    <div className="thread">
      <div className="thread-head">
        <strong>#{group.name}</strong>
        <span className="hint">{group.members.length} members</span>
        <button
          className="ghost"
          title="Copy the group invite — new members paste it under '+ group'. Note: joining reveals the group's FULL history."
          onClick={() => {
            void navigator.clipboard.writeText(JSON.stringify(makeGroupInvite(group), null, 2));
            setInviteCopied(true);
            setTimeout(() => setInviteCopied(false), 1500);
          }}
        >
          {inviteCopied ? "invite copied ✓" : "copy group invite"}
        </button>
        <span className="head-note">messages are permanent · one lane per member</span>
      </div>

      <div className="bubbles">
        {thread.length === 0 && (
          <p className="hint center">
            No messages yet. Every member writes on their own encrypted lane; everyone reads all lanes.
          </p>
        )}
        {thread.map((m) => (
          <div key={`${m.channelKey}:${m.index}`} className={`bubble ${m.direction}`}>
            {m.direction === "received" && <div className="bubble-sender">{m.senderLabel}</div>}
            <div className="bubble-body">{m.body}</div>
            <div className="bubble-meta">
              {new Date(m.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        ))}
      </div>

      <div className="compose">
        <textarea
          rows={2}
          placeholder={`Message #${group.name}… (adds to the outbox, not sent immediately)`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              queueDraft();
            }
          }}
        />
        <div className="compose-foot">
          <span className="tier">
            {preview.tier
              ? `${preview.tier} B tier · ${fmtUsd(preview.usd ?? 0)}`
              : `too long by ${preview.overBy} bytes — split it or attach a link`}
          </span>
          <button className="primary" disabled={!draft.trim() || !preview.tier} onClick={queueDraft}>
            Add to outbox
          </button>
        </div>
      </div>
    </div>
  );
}
