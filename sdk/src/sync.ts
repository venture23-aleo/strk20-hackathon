/**
 * The M5 sync engine: reconstruct message history from channel keys alone by
 * walking helper slots — resumable, gap-free, duplicate-free.
 *
 * Effects are injected (chain reads via SlotReader, persistence via SyncStore)
 * so the engine is pure enough to unit-test with forced interruptions:
 *
 *   - state persists after EVERY window, so a killed scan resumes where it
 *     stopped; `scannedTo` only advances past indices whose payloads are
 *     already stored, so resumption can neither skip nor re-add a message.
 *   - history is keyed by (channel, index) — WriteOnce slots make that key
 *     canonical, so replays and overlapping scans deduplicate naturally.
 *   - `syncedToBlock` is the block observed BEFORE the scan started: anything
 *     landing during the scan is caught by the next one, so the watermark
 *     never overstates what has been seen.
 */
import { open } from "./aead.js";
import { msgId } from "./derivations.js";

export interface SlotReader {
  /** Batched: lengths for many msg_ids in one round trip. */
  slotLens(msgIds: bigint[]): Promise<number[]>;
  slots(msgId: bigint): Promise<bigint[]>;
  blockNumber(): Promise<number>;
}

export interface HistoryRecord {
  channelKey: string;
  index: number;
  sender: string;
  /** Unix seconds. */
  timestamp: number;
  /** Base64 body — bytes are authoritative; text is a view. */
  bodyBase64: string;
}

export interface SyncSnapshot {
  syncedToBlock: number | null;
  updatedAt: number | null;
  /** channelKey hex -> next index to scan (everything below is stored). */
  channels: Record<string, { scannedTo: number }>;
  /** "channelKey:index" -> record. */
  messages: Record<string, HistoryRecord>;
}

export interface SyncStore {
  load(): SyncSnapshot;
  save(snapshot: SyncSnapshot): void;
}

export function emptySnapshot(): SyncSnapshot {
  return { syncedToBlock: null, updatedAt: null, channels: {}, messages: {} };
}

export class MemorySyncStore implements SyncStore {
  private snapshot = emptySnapshot();
  load(): SyncSnapshot {
    return structuredClone(this.snapshot);
  }
  save(s: SyncSnapshot): void {
    this.snapshot = structuredClone(s);
  }
}

export interface SyncProgress {
  channelKey: string;
  scannedTo: number;
  found: number;
}

export interface SyncResult {
  syncedToBlock: number;
  /** Newly stored this run. */
  found: number;
  totalMessages: number;
}

export class SyncEngine {
  constructor(
    private readonly reader: SlotReader,
    private readonly store: SyncStore,
    private readonly window = 16
  ) {}

  /**
   * Walk every channel to its first empty slot. `fromScratch` rescans from
   * index 0 — with no local state this reconstructs the full history.
   * `onWindow` fires after each persisted window (progress UI; tests use it to
   * force interruptions — anything thrown propagates AFTER persistence).
   */
  async sync(
    channelKeys: string[],
    opts: { fromScratch?: boolean; onWindow?: (p: SyncProgress) => void } = {}
  ): Promise<SyncResult> {
    const startBlock = await this.reader.blockNumber();
    let snapshot = this.store.load();
    if (opts.fromScratch) {
      for (const ck of channelKeys) {
        delete snapshot.channels[ck];
        for (const key of Object.keys(snapshot.messages)) {
          if (key.startsWith(`${ck}:`)) delete snapshot.messages[key];
        }
      }
      this.store.save(snapshot);
    }

    let found = 0;
    for (const ckHex of channelKeys) {
      const ck = BigInt(ckHex);
      let i = snapshot.channels[ckHex]?.scannedTo ?? 0;
      for (;;) {
        const indices = Array.from({ length: this.window }, (_, k) => i + k);
        const lens = await this.reader.slotLens(indices.map((k) => msgId(ck, k)));
        const emptyAt = lens.findIndex((l) => l === 0);
        const occupied = emptyAt === -1 ? indices : indices.slice(0, emptyAt);

        // Batched payload reads: the whole window concurrently.
        const payloads = await Promise.all(
          occupied.map(async (idx) => {
            if (snapshot.messages[`${ckHex}:${idx}`]) return null; // dedupe
            const frame = open(ck, idx, await this.reader.slots(msgId(ck, idx)));
            return { idx, frame };
          })
        );
        for (const p of payloads) {
          if (!p) continue;
          snapshot.messages[`${ckHex}:${p.idx}`] = {
            channelKey: ckHex,
            index: p.idx,
            sender: "0x" + p.frame.sender.toString(16),
            timestamp: Number(p.frame.timestamp),
            bodyBase64: base64(p.frame.body),
          };
          found++;
        }

        i = emptyAt === -1 ? i + this.window : i + emptyAt;
        snapshot.channels[ckHex] = { scannedTo: i };
        snapshot.updatedAt = Date.now();
        this.store.save(snapshot); // resumability: persist BEFORE any abort
        opts.onWindow?.({ channelKey: ckHex, scannedTo: i, found });
        if (emptyAt !== -1) break;
      }
      snapshot = this.store.load();
    }

    snapshot.syncedToBlock = startBlock;
    snapshot.updatedAt = Date.now();
    this.store.save(snapshot);
    return { syncedToBlock: startBlock, found, totalMessages: Object.keys(snapshot.messages).length };
  }

  /** Full history, ordered per channel by index. */
  history(channelKey?: string): HistoryRecord[] {
    const all = Object.values(this.store.load().messages);
    return all
      .filter((m) => (channelKey ? m.channelKey === channelKey : true))
      .sort((a, b) =>
        a.channelKey === b.channelKey ? a.index - b.index : a.channelKey.localeCompare(b.channelKey)
      );
  }

  status(): { syncedToBlock: number | null; updatedAt: number | null; totalMessages: number } {
    const s = this.store.load();
    return {
      syncedToBlock: s.syncedToBlock,
      updatedAt: s.updatedAt,
      totalMessages: Object.keys(s.messages).length,
    };
  }
}

function base64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
