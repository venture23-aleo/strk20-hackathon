import { useEffect, useState } from "react";
import { store } from "../lib/store.js";
import { shorten } from "./Onboarding.js";

/**
 * Sync state is first-class chrome (12-client-and-ui.md): a stale view renders
 * as "no new messages", which is the worst failure mode for a messenger — so
 * the block watermark lives in the header, not in a settings pane.
 */
/**
 * Your address, one click to copy — it's what other people enter under
 * "+ add" to reach you, so it should never require digging through files.
 */
function IdentityChip() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="id-chip"
      title={`your messaging identity — click to copy:\n${store.identity}${
        store.config?.identityAddress ? `\nsigner: ${store.config.accountAddress}` : "\n(also the signer)"
      }`}
      onClick={() => {
        void navigator.clipboard.writeText(store.identity);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "address copied ✓" : (
        <>
          you: <code>{shorten(store.identity)}</code> ⧉
        </>
      )}
    </button>
  );
}

export function Chrome({ onSettings }: { onSettings: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    // Auto-sync: incoming messages appear without hunting for a button. A
    // stale view rendering as "no new messages" is the failure mode to avoid.
    const s = setInterval(() => void store.syncNow(), 15000);
    return () => {
      clearInterval(t);
      clearInterval(s);
    };
  }, []);

  const status = store.engine?.status();
  const age =
    status?.updatedAt != null ? Math.max(0, Math.round((Date.now() - status.updatedAt) / 1000)) : null;

  return (
    <header className="chrome">
      <div className="brand">STRK20 Messages</div>
      <IdentityChip />
      <button
        className={`sync ${store.syncing ? "busy" : ""}`}
        onClick={() => void store.syncNow()}
        title="Click to sync now"
      >
        {store.syncing
          ? "syncing…"
          : status?.syncedToBlock != null
            ? `synced to block ${status.syncedToBlock.toLocaleString()} · ${age}s ago`
            : "not synced yet"}
      </button>
      <button className="ghost" onClick={onSettings}>
        Settings
      </button>
    </header>
  );
}
