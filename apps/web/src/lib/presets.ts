/**
 * Connection presets and the pre-save probe. Preset values mirror
 * DEPLOYMENTS.md — update both in the same commit as any redeployment.
 */

export interface ConnectionPreset {
  label: string;
  rpcUrl: string;
  helperAddress: string;
  /** Public — safe to prefill. The private key is never part of a preset. */
  accountAddress: string;
}

export const SEPOLIA_PRESET: ConnectionPreset = {
  label: "Sepolia · project deployment",
  rpcUrl: "https://api.cartridge.gg/x/starknet/sepolia",
  helperAddress: "0x06409a4a8c1962bbfd6b04ea9ab1f745be8e7bceddc61f4e322dcbc7781ae032",
  accountAddress: "0x03ab7fda95f39c9b5be0572bd2a115db1bff1db87c88fbcff872473f1f2afac4",
};

export const isHex = (v: string): boolean => /^0x[0-9a-fA-F]+$/.test(v.trim());

/**
 * Accepts either an sncast accounts file (~/.starknet_accounts/…json) or this
 * app's own backup JSON, and extracts { accountAddress, privateKey? }.
 */
export function parseCredentialsPaste(
  text: string
): { accountAddress: string; privateKey?: string; source: string } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // a bare private key or address is also acceptable
    const t = text.trim();
    if (isHex(t) && t.length > 50) return { accountAddress: "", privateKey: t, source: "raw key" };
    return null;
  }
  const obj = raw as Record<string, unknown>;

  // App backup: { version: 1, viewingKey, accountAddress, ... }
  if (obj.version === 1 && typeof obj.accountAddress === "string") {
    return { accountAddress: obj.accountAddress, source: "app backup" };
  }

  // sncast: { "<network>": { "<name>": { address, private_key, ... } } }
  for (const network of Object.values(obj)) {
    if (typeof network !== "object" || network === null) continue;
    for (const acct of Object.values(network as Record<string, unknown>)) {
      const a = acct as { address?: string; private_key?: string };
      if (typeof a?.address === "string" && typeof a?.private_key === "string") {
        return { accountAddress: a.address, privateKey: a.private_key, source: "sncast accounts file" };
      }
    }
  }
  return null;
}

const POOL_SELECTOR = "0x35b2940ca10a9581573918a0d9ed2422f97cc9196f63510c77f5a0ed5393cfd";

export interface ProbeResult {
  ok: boolean;
  detail: string;
}

/** Verify RPC reachability + that a MessageAnonymizer lives at the helper address. */
export async function probeConnection(
  rpcUrl: string,
  helperAddress: string,
  accountAddress: string
): Promise<ProbeResult> {
  let res: { result?: string[]; error?: { message?: string } };
  try {
    const r = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "starknet_call",
        params: [
          { contract_address: helperAddress, entry_point_selector: POOL_SELECTOR, calldata: [] },
          "latest",
        ],
      }),
    });
    res = await r.json();
  } catch (e) {
    return { ok: false, detail: `RPC unreachable: ${e instanceof Error ? e.message : e}` };
  }
  if (res.error || !res.result?.[0]) {
    return {
      ok: false,
      detail: `helper not found at that address (${res.error?.message ?? "no pool() response"})`,
    };
  }
  const pool = BigInt(res.result[0]);
  if (accountAddress && isHex(accountAddress) && pool !== BigInt(accountAddress)) {
    return {
      ok: false,
      detail:
        `helper found, but its pool is 0x${pool.toString(16).slice(0, 8)}… — not your account. ` +
        "Direct mode can only write through the helper's registered pool account.",
    };
  }
  return { ok: true, detail: "helper found · pool() matches your account · ready to send" };
}
