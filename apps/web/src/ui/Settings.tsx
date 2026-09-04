import { useState } from "react";
import { store } from "../lib/store.js";

/** Mode switcher + direct-mode connection details (RPC, helper, account). */
function ConnectionEditor({ onSaved }: { onSaved: () => void }) {
  const cfg = store.config!;
  const [mode, setMode] = useState<"demo" | "direct">(cfg.mode);
  const [rpcUrl, setRpcUrl] = useState(cfg.rpcUrl ?? "https://api.cartridge.gg/x/starknet/sepolia");
  const [helper, setHelper] = useState(cfg.helperAddress ?? "");
  const [account, setAccount] = useState(
    cfg.mode === "direct" ? cfg.accountAddress : ""
  );
  const [key, setKey] = useState(cfg.accountKey ?? "");

  const save = () => {
    if (mode === "demo") {
      store.updateConnection({ mode: "demo" });
    } else {
      if (!rpcUrl || !helper || !account || !key) return;
      store.updateConnection({
        mode: "direct",
        rpcUrl,
        helperAddress: helper,
        accountAddress: account,
        accountKey: key,
      });
    }
    onSaved();
  };

  return (
    <div>
      <label className="field">
        Mode
        <select value={mode} onChange={(e) => setMode(e.target.value as "demo" | "direct")}>
          <option value="demo">demo — simulated pool in this browser</option>
          <option value="direct">direct — real helper contract over RPC (testnet dev mode)</option>
        </select>
      </label>
      {mode === "direct" && (
        <>
          <p className="hint">
            Direct mode writes to a real network. The submitter address is visible on-chain
            (pool mode is what hides it), and the private key is stored in this browser's
            localStorage — use a testnet account only.
          </p>
          <label className="field">
            RPC URL
            <input value={rpcUrl} onChange={(e) => setRpcUrl(e.target.value)} />
          </label>
          <label className="field">
            Helper contract address
            <input placeholder="0x…" value={helper} onChange={(e) => setHelper(e.target.value)} />
          </label>
          <label className="field">
            Account address (must be the helper's registered pool for direct mode)
            <input placeholder="0x…" value={account} onChange={(e) => setAccount(e.target.value)} />
          </label>
          <label className="field">
            Account private key
            <input type="password" placeholder="0x…" value={key} onChange={(e) => setKey(e.target.value)} />
          </label>
        </>
      )}
      <button className="primary" onClick={save}>
        Save & reconnect
      </button>
    </div>
  );
}

/**
 * Backup and restore, and mode plumbing. Deliberately NOT here: the three
 * disclosures (they are onboarding, not settings) and any delete affordance
 * (there is nothing to delete — storage is WriteOnce).
 */
export function Settings({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const cfg = store.config!;

  const download = () => {
    const blob = new Blob([store.backupJson()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "strk20-messages-backup.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Settings</h2>
          <button className="ghost" onClick={onClose}>
            close
          </button>
        </div>

        <section>
          <h3>Key backup</h3>
          <p className="hint">
            The backup holds your viewing key and contacts. Message history is not included —
            it is rebuilt from the chain by sync, which is the point.
          </p>
          <div className="row">
            <button className="primary" onClick={download}>
              Download backup
            </button>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(store.backupJson());
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "Copied ✓" : "Copy to clipboard"}
            </button>
          </div>
          <p className="hint">
            To restore: install the app anywhere, choose “Restore from backup” at onboarding,
            paste this file.
          </p>
        </section>

        <section>
          <h3>Connection</h3>
          <ConnectionEditor onSaved={onClose} />
          {cfg.mode === "demo" && (
            <label className="field">
              Proving time (demo): {cfg.provingSeconds} s
              <input
                type="range"
                min={3}
                max={29}
                value={cfg.provingSeconds}
                onChange={(e) => store.updateConnection({ provingSeconds: Number(e.target.value) })}
              />
              <span className="hint">Production proves in ~29 s. Lower this only for demos.</span>
            </label>
          )}
        </section>
      </div>
    </div>
  );
}
