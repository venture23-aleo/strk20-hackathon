import {
  privacyInvokeCalldata,
  seal,
  tierOf,
  type Bucket,
  type OutboxEntry,
  type Sealed,
} from "@strk20-messaging/sdk";
import { Account, RpcProvider } from "starknet";
import {
  loadConfig,
  loadCursors,
  privateKey,
  saveCursors,
  type ChannelConfig,
  type CliConfig,
} from "./config.js";
import { HelperClient } from "./helper.js";
import { fileOutbox } from "./outboxStore.js";
import { poolSend, type PoolTransfer } from "./pool.js";
import { submitWithResilience } from "./resilience.js";
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

// --- M4: outbox, batched flush, memo, resilience ---------------------------

export function queueMessage(to: string, text: string, padTo?: Bucket): OutboxEntry {
  const cfg = loadConfig();
  resolveChannel(cfg, to); // fail at queue time, not at flush time
  return fileOutbox().queue(to, text, padTo);
}

export function listOutbox(): { entry: OutboxEntry; tier: Bucket }[] {
  return fileOutbox()
    .list()
    .map((entry) => ({ entry, tier: tierOf(entry.body, entry.padTo) }));
}

export interface FlushReport {
  transactions: { txHash: string; count: number; channel: string }[];
  flushed: number;
}

interface SealedItem {
  entry: OutboxEntry;
  sealed: Sealed;
  index: number;
}

/**
 * The outbox flush: N queued messages per channel land in ONE privacy_invoke —
 * one transaction, one proof, one fee — through the resilience loop (retry with
 * proof-nonce invalidation, provingBlockId re-fetch per attempt and between
 * chained transactions, proof-size fallback to a smaller batch).
 */
export async function flushOutbox(
  opts: { max?: number; log?: (line: string) => void } = {}
): Promise<FlushReport> {
  const log = opts.log ?? (() => {});
  const cfg = loadConfig();
  const { provider, helper } = clients(cfg);
  const account = accountOf(cfg, provider);
  const outbox = fileOutbox();
  const cursors = loadCursors();
  const report: FlushReport = { transactions: [], flushed: 0 };

  const queued = outbox.take(opts.max ?? Infinity);
  if (queued.length === 0) {
    log("outbox empty");
    return report;
  }

  const byChannel = new Map<string, OutboxEntry[]>();
  for (const e of queued) {
    const ch = resolveChannel(cfg, e.to);
    byChannel.set(ch.channelKey, [...(byChannel.get(ch.channelKey) ?? []), e]);
  }

  for (const [channelKeyHex, entries] of byChannel) {
    const channelKey = BigInt(channelKeyHex);
    const label = resolveChannel(cfg, entries[0]!.to).label;

    const sealBatch = async (batch: OutboxEntry[]): Promise<SealedItem[]> => {
      const start = await nextFreeIndex(helper, channelKey, cursors[channelKeyHex] ?? 0);
      return batch.map((entry, k) => ({
        entry,
        index: start + k,
        sealed: seal({
          channelKey,
          index: start + k,
          sender: BigInt(cfg.account.address),
          timestamp: BigInt(Math.floor(Date.now() / 1000)),
          body: new TextEncoder().encode(entry.body),
          padTo: entry.padTo,
        }),
      }));
    };

    let toSend = await sealBatch(entries);
    while (toSend.length > 0) {
      const ids = toSend.map((i) => i.entry.id);
      if (cfg.mode === "pool") outbox.mark(ids, "proving");
      log(`flushing ${toSend.length} message(s) to ${label} in one transaction…`);

      const outcome = await submitWithResilience(toSend, {
        fetchHead: () => provider.getBlockNumber(),
        invalidateProofNonceCache: () => {
          /* direct mode: nothing cached; pool mode invalidates inside poolSend's tail */
        },
        reseal: (batch) => sealBatch(batch.map((i) => i.entry)),
        onRetry: (reason, attempt, size) =>
          log(`retry ${attempt} (${reason}) — batch size ${size}`),
        submit: async (batch, provingBlockId) => {
          const events = {
            onSubmitted: (h: string) => {
              outbox.mark(
                batch.map((i) => i.entry.id),
                "submitted",
                { txHash: h }
              );
              log(`submitted ${h}`);
            },
          };
          if (cfg.mode === "direct") {
            return submitDirect(
              account,
              provider,
              [
                {
                  contractAddress: cfg.helperAddress,
                  entrypoint: "privacy_invoke",
                  calldata: privacyInvokeCalldata(batch.map((i) => i.sealed)),
                },
              ],
              events
            );
          }
          return poolSend(
            cfg,
            account,
            provider,
            batch.map((i) => i.sealed),
            { ...events, onProving: () => log("proving… (~29 s)") },
            { provingBlockId }
          );
        },
      });

      const maxIndex = Math.max(...outcome.sent.map((i) => i.index));
      outbox.mark(
        outcome.sent.map((i) => i.entry.id),
        "confirmed",
        { txHash: outcome.txHash, indices: new Map(outcome.sent.map((i) => [i.entry.id, i.index])) }
      );
      cursors[channelKeyHex] = maxIndex + 1;
      saveCursors(cursors);
      report.transactions.push({ txHash: outcome.txHash, count: outcome.sent.length, channel: label });
      report.flushed += outcome.sent.length;
      log(`confirmed ${outcome.txHash} (${outcome.sent.length} message(s))`);

      toSend = outcome.remaining; // chained tx; provingBlockId re-fetched by the loop
    }
  }
  return report;
}

/**
 * Memo riding a transfer, atomically: one transaction carrying both the token
 * transfer and the sealed memo. If the transfer reverts, the memo reverts with
 * it — there is no state in which one lands without the other.
 */
export async function pay(
  to: string,
  token: string,
  amount: bigint,
  memoText: string,
  opts: { log?: (line: string) => void } = {}
): Promise<{ txHash: string; index: number }> {
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
    body: new TextEncoder().encode(memoText),
  });
  log(`memo · ${channel.label} · index ${index} · transfer ${amount} of ${token.slice(0, 10)}…`);

  const transfer: PoolTransfer = { token, recipient: channel.peer, amount };
  let txHash: string;
  if (cfg.mode === "direct") {
    // Public ERC-20 transfer + memo in one multicall — atomic by Starknet
    // account semantics. (Pool mode makes the transfer private too.)
    const res = await submitDirect(
      account,
      provider,
      [
        {
          contractAddress: token,
          entrypoint: "transfer",
          calldata: [
            channel.peer,
            "0x" + (amount & ((1n << 128n) - 1n)).toString(16),
            "0x" + (amount >> 128n).toString(16),
          ],
        },
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
    }, { transfer });
    txHash = res.txHash;
  }
  log(`confirmed ${txHash}`);
  cursors[channel.channelKey] = index + 1;
  saveCursors(cursors);
  return { txHash, index };
}

export function formatAge(timestamp: bigint): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - Number(timestamp));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
