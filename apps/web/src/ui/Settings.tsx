import { useState } from "react";
import { store } from "../lib/store.js";

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
          <p className="hint">
            Mode: <strong>{cfg.mode}</strong>
            {cfg.mode === "demo" &&
              " — a simulated pool in your browser, with real encryption and real proving latency."}
          </p>
          <label className="field">
            Proving time (demo): {cfg.provingSeconds} s
            <input
              type="range"
              min={3}
              max={29}
              value={cfg.provingSeconds}
              onChange={(e) => {
                store.config = { ...cfg, provingSeconds: Number(e.target.value) };
                localStorage.setItem("strk20msg.config", JSON.stringify(store.config));
                onClose();
              }}
            />
            <span className="hint">Production proves in ~29 s. Lower this only for demos.</span>
          </label>
        </section>
      </div>
    </div>
  );
}
