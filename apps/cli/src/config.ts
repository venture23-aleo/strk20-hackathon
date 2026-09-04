import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ChannelConfig {
  /** Human name used by `send --to`. */
  label: string;
  /** Counterparty Starknet address (informational; the key is what addresses slots). */
  peer: string;
  /**
   * Directional channel key, hex. In pool mode this comes from the Privacy SDK's
   * channel scan; in direct (dev) mode it is provisioned out of band.
   */
  channelKey: string;
}

export interface CliConfig {
  rpcUrl: string;
  helperAddress: string;
  /**
   * "pool": submit through the STRK20 pool (anonymous, needs proving).
   * "direct": call the helper straight from the account — DEV ONLY: the helper
   * must have been deployed with this account as `pool`, and the submitter is
   * fully visible on-chain.
   */
  mode: "direct" | "pool";
  account: {
    address: string;
    /** Prefer env STRK20_MSG_PRIVATE_KEY over storing this in the file. */
    privateKey?: string;
  };
  channels: ChannelConfig[];
  pool?: {
    /** Path to a built starknet-privacy checkout (sdk/dist must exist). */
    sdkPath: string;
    poolAddress: string;
    provingUrl?: string;
    /** Token used for the zero-amount carrier note. */
    carrierToken?: string;
  };
}

export function configDir(): string {
  return process.env.STRK20_MSG_HOME ?? join(homedir(), ".strk20-msg");
}

export function loadConfig(): CliConfig {
  const p = join(configDir(), "config.json");
  if (!existsSync(p)) {
    throw new Error(`no config at ${p} — run: msg init --rpc <url> --helper <addr> --account <addr>`);
  }
  return JSON.parse(readFileSync(p, "utf8")) as CliConfig;
}

export function saveConfig(cfg: CliConfig): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(join(configDir(), "config.json"), JSON.stringify(cfg, null, 2) + "\n");
}

export function privateKey(cfg: CliConfig): string {
  const pk = process.env.STRK20_MSG_PRIVATE_KEY ?? cfg.account.privateKey;
  if (!pk) throw new Error("no private key: set STRK20_MSG_PRIVATE_KEY or account.privateKey");
  return pk;
}

/** Client state is { channelKey -> nextIndex } and nothing else (06-sdk.md). */
export type Cursors = Record<string, number>;

export function loadCursors(): Cursors {
  const p = join(configDir(), "state.json");
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Cursors) : {};
}

export function saveCursors(c: Cursors): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(join(configDir(), "state.json"), JSON.stringify(c, null, 2) + "\n");
}
