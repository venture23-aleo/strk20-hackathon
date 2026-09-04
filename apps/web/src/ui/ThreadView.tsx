import { useState } from "react";
import { stitchThread, type Contact } from "../lib/contacts.js";
import { fmtUsd, tierPreview } from "../lib/costs.js";
import { store } from "../lib/store.js";
import { shorten } from "./Onboarding.js";

export function ThreadView({ contact }: { contact: Contact }) {
  const [draft, setDraft] = useState("");
  const history = store.engine?.history() ?? [];
  const thread = stitchThread(history, contact);
  const preview = tierPreview(draft);

  // The unregistered-recipient flow: a hard failure at compose time, designed
  // rather than erroring (12-client-and-ui.md).
  if (!contact.registered) {
    return (
      <div className="thread">
        <div className="thread-head">
          <strong>{contact.label}</strong> <code>{shorten(contact.peer)}</code>
        </div>
        <div className="unregistered">
          <h3>{contact.label} can’t receive messages yet</h3>
          <p>
            They haven’t registered a viewing key on the pool (<code>SetViewingKey</code>), so
            there is no key to encrypt to. Nothing you write can reach them until they do.
          </p>
          <div className="row">
            <button
              onClick={() =>
                void navigator.clipboard.writeText(
                  `You've been invited to STRK20 Messages. Register once at strk20.starknet.io and messages to ${contact.peer} will start working.`
                )
              }
            >
              Copy invite for {contact.label}
            </button>
            <button className="ghost" onClick={() => void store.refreshRegistration(contact)}>
              Check again
            </button>
            {store.backend?.demo && (
              <button className="ghost" onClick={() => store.simulatePeerRegistration(contact)}>
                (demo: simulate their registration)
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const queueDraft = () => {
    if (!draft.trim() || !preview.tier) return;
    store.queue(contact, draft);
    setDraft("");
  };

  return (
    <div className="thread">
      <div className="thread-head">
        <strong>{contact.label}</strong> <code>{shorten(contact.peer)}</code>
        <span className="head-note">messages are permanent · encrypted end to end</span>
      </div>

      <div className="bubbles">
        {thread.length === 0 && (
          <p className="hint center">No messages yet. Write one below — it queues into the outbox.</p>
        )}
        {thread.map((m) => (
          <div key={`${m.channelKey}:${m.index}`} className={`bubble ${m.direction}`}>
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
          placeholder={`Message ${contact.label}… (adds to the outbox, not sent immediately)`}
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
          {preview.boundary && (
            <span className="tier-warning">
              {preview.boundary.bytesLeft} more bytes moves this to the{" "}
              {preview.boundary.nextTier >= 1024
                ? `${preview.boundary.nextTier / 1024} KiB`
                : `${preview.boundary.nextTier} B`}{" "}
              tier (+{fmtUsd(preview.boundary.extraUsd)})
            </span>
          )}
          <button className="primary" disabled={!draft.trim() || !preview.tier} onClick={queueDraft}>
            Add to outbox
          </button>
        </div>
      </div>
    </div>
  );
}
