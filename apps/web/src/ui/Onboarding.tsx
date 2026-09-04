import { useState } from "react";
import { randomFelt, store } from "../lib/store.js";
import type { Contact } from "../lib/contacts.js";

/**
 * The three disclosures live HERE, at onboarding — not in settings, not in a
 * footnote (12-client-and-ui.md). Each requires its own acknowledgement.
 */
const DISCLOSURES = [
  {
    title: "An auditor can read your messages",
    body:
      "This system inherits STRK20's compliance model: an escrowed auditor key can recover " +
      "message content under lawful process. Your messages are hidden from the public, " +
      "not from a court order.",
  },
  {
    title: "Messages are permanent",
    body:
      "Messages are written to blockchain storage that can never be edited or deleted — " +
      "not by you, not by the recipient, not by us. There is no delete button anywhere " +
      "in this app, because a delete button would be a lie.",
  },
  {
    title: "“A message was sent” is public",
    body:
      "Anyone watching the chain can see that some message of a certain size was sent at a " +
      "certain time. They cannot see who sent it, who received it, or what it says.",
  },
] as const;

export function Onboarding() {
  const [step, setStep] = useState(0);
  const [acks, setAcks] = useState([false, false, false]);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreText, setRestoreText] = useState("");
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [keys, setKeys] = useState<{ viewingKey: string; accountAddress: string; contacts: Contact[] } | null>(null);
  const [registering, setRegistering] = useState(false);

  const finish = (k: NonNullable<typeof keys>) => {
    setRegistering(true);
    // Registration (SetViewingKey) is bundled into first use — autoRegister
    // semantics, no separate transaction demanded of the user upfront.
    store.completeOnboarding(
      {
        mode: "demo",
        viewingKey: k.viewingKey,
        accountAddress: k.accountAddress,
        provingSeconds: 29,
      },
      k.contacts
    );
  };

  if (step === 0) {
    return (
      <div className="onboarding">
        <h1>STRK20 Messages</h1>
        <p className="lede">
          Private messaging on Starknet. Before you start, three things you must know — really
          know, not scroll past:
        </p>
        {DISCLOSURES.map((d, i) => (
          <label key={d.title} className={`disclosure ${acks[i] ? "acked" : ""}`}>
            <input
              type="checkbox"
              checked={acks[i]}
              onChange={() => setAcks(acks.map((a, j) => (i === j ? !a : a)))}
            />
            <div>
              <strong>{d.title}</strong>
              <p>{d.body}</p>
            </div>
          </label>
        ))}
        <button className="primary" disabled={!acks.every(Boolean)} onClick={() => setStep(1)}>
          I understand all three
        </button>
      </div>
    );
  }

  return (
    <div className="onboarding">
      <h1>Your key</h1>
      <p className="lede">
        One viewing key is your identity, your inbox and your backup. Everything else — your
        entire message history — can be rebuilt from it.
      </p>
      {!keys && !restoreOpen && (
        <div className="key-choices">
          <button
            className="primary"
            onClick={() =>
              setKeys({ viewingKey: randomFelt(), accountAddress: randomFelt(), contacts: [] })
            }
          >
            Create a new key
          </button>
          <button onClick={() => setRestoreOpen(true)}>Restore from backup</button>
        </div>
      )}
      {restoreOpen && !keys && (
        <div className="restore">
          <textarea
            placeholder="Paste your backup JSON here"
            value={restoreText}
            onChange={(e) => setRestoreText(e.target.value)}
            rows={8}
          />
          {restoreError && <p className="error">{restoreError}</p>}
          <button
            className="primary"
            onClick={() => {
              try {
                setKeys(store.restoreFromBackup(restoreText));
                setRestoreError(null);
              } catch (e) {
                setRestoreError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Restore
          </button>
        </div>
      )}
      {keys && (
        <div className="key-summary">
          <p>
            <strong>Account:</strong> <code>{shorten(keys.accountAddress)}</code>
          </p>
          <p className="hint">
            Registration happens automatically with your first action — no separate transaction.
          </p>
          <button className="primary" disabled={registering} onClick={() => finish(keys)}>
            {registering ? "Registering…" : keys.contacts.length > 0 ? `Restore ${keys.contacts.length} contact(s) and start` : "Start messaging"}
          </button>
        </div>
      )}
    </div>
  );
}

export function shorten(addr: string): string {
  return addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-4)}` : addr;
}
