import { seal, type Bucket } from "@strk20-messaging/sdk";
import { Account, RpcProvider } from "starknet";
import {
  loadConfig,
  loadCursors,
  privateKey,
  saveCursors,
  type ChannelConfig,
  type CliConfig,
} from "./config.js";
import { HelperClient, privacyInvokeCalldata } from "./helper.js";
import { poolSend } from "./pool.js";
import { submitDirect } from "./tail.js";
import { nextFreeIndex, walkChannel, type FoundMessage } from "./walk.js";

export interface SendResult {
  channel: ChannelConfig;
  index: number;
  bucket: number;
  txHash: string;
}

function clients(cfg: CliConfig) {
  const provider = new RpcProvider({ nodeUrl: cfg.rpcUrl });
  const helper = new HelperClient(provider, cfg.helperAddress);
  return { provider, helper };
}

function accountOf(cfg: CliConfig, provider: RpcProvider): Account {
  return new Account({
    provider,
    address: cfg.account.address,
    signer: privateKey(cfg),
  });
}

export function resolveChannel(cfg: CliConfig, to: string): ChannelConfig {
  const ch = cfg.channels.find((c) => c.label === to || c.peer.toLowerCase() === to.toLowerCase());
  if (!ch) {
    throw new Error(
      `no channel for "${to}" — add one: msg channel add --label <name> --peer <addr> --key <channel key>`
    );
  }
  return ch;
}

export async function sendMessage(
  to: string,
  text: string,
  opts: { padTo?: Bucket; log?: (line: string) => void } = {}
): Promise<SendResult> {
  const log = opts.log ?? (() => {});
  const cfg = loadConfig();
  const { provider, helper } = clients(cfg);
  const account = accountOf(cfg, provider);
  const channel = resolveChannel(cfg, to);
  const channelKey = BigInt(channel.channelKey);

  const cursors = loadCursors();
  const index = await nextFreeIndex(helper, channelKey, cursors[channel.channelKey] ?? 0);

  const sealed = seal({
    channelKey,
    index,
    sender: BigInt(cfg.account.address),
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    body: new TextEncoder().encode(text),
    padTo: opts.padTo,
  });
  log(`queued · ${channel.label} · index ${index} · ${sealed.bucket} B tier`);

  let txHash: string;
  if (cfg.mode === "direct") {
    log("submitting (direct — dev mode, submitter visible)…");
    const res = await submitDirect(
      account,
      provider,
      [
        {
          contractAddress: cfg.helperAddress,
          entrypoint: "privacy_invoke",
          calldata: privacyInvokeCalldata([sealed]),
        },
      ],
      { onSubmitted: (h) => log(`submitted ${h}`) }
    );
    txHash = res.txHash;
  } else {
    const res = await poolSend(cfg, account, provider, [sealed], {
      onProving: () => log("proving… (~29 s)"),
      onSubmitted: (h) => log(`submitted ${h}`),
    });
    txHash = res.txHash;
  }
  log(`confirmed ${txHash}`);

  cursors[channel.channelKey] = index + 1;
  saveCursors(cursors);
  return { channel, index, bucket: sealed.bucket, txHash };
}

export interface ReadResult {
  channel: ChannelConfig;
  messages: FoundMessage[];
}

export async function readMessages(): Promise<ReadResult[]> {
  const cfg = loadConfig();
  const { helper } = clients(cfg);
  const cursors = loadCursors();
  const out: ReadResult[] = [];
  for (const channel of cfg.channels) {
    const channelKey = BigInt(channel.channelKey);
    const { messages, nextIndex } = await walkChannel(
      helper,
      channelKey,
      cursors[channel.channelKey] ?? 0
    );
    cursors[channel.channelKey] = nextIndex;
    if (messages.length > 0) out.push({ channel, messages });
  }
  saveCursors(cursors);
  return out;
}

export function formatAge(timestamp: bigint): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - Number(timestamp));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
