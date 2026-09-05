import { useState } from "react";
import { SEPOLIA_PRESET, isHex, parseCredentialsPaste, probeConnection } from "../lib/presets.js";
import { store } from "../lib/store.js";

/** Mode switcher + direct-mode connection details, with presets and a probe. */
function ConnectionEditor({ onSaved }: { onSaved: () => void }) {
  const cfg = store.config!;
  const [mode, setMode] = useState<"demo" | "direct">(cfg.mode);
  const [rpcUrl, setRpcUrl] = useState(cfg.rpcUrl ?? SEPOLIA_PRESET.rpcUrl);
  const [helper, setHelper] = useState(cfg.helperAddress ?? "");
  const [account, setAccount] = useState(cfg.mode === "direct" ? cfg.accountAddress : "");
  const [key, setKey] = useState(cfg.accountKey ?? "");
  const [identity, setIdentity] = useState(cfg.identityAddress ?? "");
  const [showKey, setShowKey] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const [probe, setProbe] = useState<{ ok: boolean; detail: string } | "checking" | null>(null);
  const [saved, setSaved] = useState(false);

  const applyPreset = () => {
    setRpcUrl(SEPOLIA_PRESET.rpcUrl);
    setHelper(SEPOLIA_PRESET.helperAddress);
    if (!account) setAccount(SEPOLIA_PRESET.accountAddress);
    setProbe(null);
  };

  const applyPaste = (text: string) => {
    const creds = parseCredentialsPaste(text);
    if (!creds) {
      setPasteNote("Couldn't recognize that — paste your sncast accounts JSON, an app backup, or a bare 0x… key.");
      return;
    }
    if (creds.accountAddress) setAccount(creds.accountAddress);
    if (creds.privateKey) setKey(creds.privateKey);
    setPasteNote(`✓ imported from ${creds.source}${creds.privateKey ? " (address + key)" : " (address only)"}`);
    setPasteOpen(false);
    setProbe(null);
  };

  const runProbe = async () => {
    setProbe("checking");
    setProbe(await probeConnection(rpcUrl.trim(), helper.trim(), account.trim()));
  };

  const fieldOk = {
    helper: isHex(helper),
    account: isHex(account),
    key: isHex(key),
  };
  const canSave =
    mode === "demo" || (rpcUrl.trim() !== "" && fieldOk.helper && fieldOk.account && fieldOk.key);

  const save = () => {
    if (mode === "demo") {
      store.updateConnection({ mode: "demo" });
    } else {
      store.updateConnection({
        mode: "direct",
        rpcUrl: rpcUrl.trim(),
        helperAddress: helper.trim(),
        accountAddress: account.trim(),
        accountKey: key.trim(),
        identityAddress: identity.trim() || undefined,
      });
    }
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onSaved();
    }, 900);
  };

  return (
    <div>
      <div className="mode-picker">
        {(
          [
            ["demo", "Demo", "Simulated pool in this browser — nothing leaves your machine"],
            ["direct", "Direct", "Real helper contract over RPC — testnet dev mode"],
          ] as const
        ).map(([value, title, desc]) => (
          <button
            key={value}
            className={`mode-card ${mode === value ? "selected" : ""}`}
            onClick={() => {
              setMode(value);
              setProbe(null);
            }}
          >
            <strong>{title}</strong>
            <span>{desc}</span>
          </button>
        ))}
      </div>
      {mode === "direct" && (
        <>
          <div className="row" style={{ margin: "6px 0 10px" }}>
            <button onClick={applyPreset}>⚡ {SEPOLIA_PRESET.label}</button>
            <button className="ghost" onClick={() => setPasteOpen(!pasteOpen)}>
              paste credentials…
            </button>
          </div>
          {pasteOpen && (
            <textarea
              rows={4}
              placeholder="Paste ~/.starknet_accounts/starknet_open_zeppelin_accounts.json, an app backup, or a bare 0x… private key — fields fill themselves."
              onChange={(e) => e.target.value.trim() && applyPaste(e.target.value)}
            />
          )}
          {pasteNote && <p className="hint">{pasteNote}</p>}

          <label className="field">
            RPC URL
            <input className="mono" value={rpcUrl} onChange={(e) => setRpcUrl(e.target.value)} />
          </label>
          <label className="field">
            Helper contract address
            <input
              className={`mono ${helper && !fieldOk.helper ? "invalid" : ""}`}
              placeholder="0x…"
              value={helper}
              onChange={(e) => setHelper(e.target.value)}
            />
          </label>
          <label className="field">
            Your account address
            <input
              className={`mono ${account && !fieldOk.account ? "invalid" : ""}`}
              placeholder="0x…"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            />
            <span className="hint">Must be the account the helper was deployed with (its `pool`) — Test connection checks this.</span>
          </label>
          <label className="field">
            Account private key
            <span className="row">
              <input
                className={`mono ${key && !fieldOk.key ? "invalid" : ""}`}
                type={showKey ? "text" : "password"}
                placeholder="0x… (testnet key only — stored in this browser)"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <button className="ghost" onClick={() => setShowKey(!showKey)}>
                {showKey ? "hide" : "show"}
              </button>
            </span>
          </label>

          <label className="field">
            Messaging identity (optional, dev)
            <input
              className="mono"
              placeholder="0x… — leave empty to use the account address"
              value={identity}
              onChange={(e) => setIdentity(e.target.value)}
            />
            <span className="hint">
              Lets several browsers share one funded signer while staying distinct people in
              threads and groups. Pool mode ignores this.
            </span>
          </label>

          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={() => void runProbe()} disabled={!fieldOk.helper || !rpcUrl}>
              Test connection
            </button>
            {probe === "checking" && <span className="hint">checking…</span>}
            {probe && probe !== "checking" && (
              <span className={probe.ok ? "probe-ok" : "probe-err"}>{probe.detail}</span>
            )}
          </div>
        </>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="primary" disabled={!canSave} onClick={save}>
          Save & reconnect
        </button>
        {saved && <span className="probe-ok">✓ connected ({mode})</span>}
      </div>
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

        <div className="settings-grid">
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

          <section>
            <h3>Connection</h3>
            <ConnectionEditor onSaved={onClose} />
          </section>
        </div>
      </div>
    </div>
  );
}
