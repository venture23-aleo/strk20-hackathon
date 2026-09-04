/**
 * The outbox model (12-client-and-ui.md): the client accumulates and flushes;
 * batching is the primary interaction, not a fallback. Send states are explicit
 * and four of them last long enough for a user to notice:
 *
 *   queued -> proving (~29 s) -> submitted -> confirmed   (| failed)
 */
import { bucketFor, type Bucket } from "./framing.js";

export type SendStatus = "queued" | "proving" | "submitted" | "confirmed" | "failed";

export interface OutboxEntry {
  id: string;
  /** Channel label or peer address, resolved at flush time. */
  to: string;
  body: string;
  padTo?: Bucket;
  status: SendStatus;
  queuedAt: number;
  /** Set once submitted. */
  txHash?: string;
  /** Slot index the message landed at, set at seal time. */
  index?: number;
  error?: string;
}

export interface OutboxStore {
  load(): OutboxEntry[];
  save(entries: OutboxEntry[]): void;
}

export class MemoryStore implements OutboxStore {
  private entries: OutboxEntry[] = [];
  load(): OutboxEntry[] {
    return structuredClone(this.entries);
  }
  save(entries: OutboxEntry[]): void {
    this.entries = structuredClone(entries);
  }
}

export class Outbox {
  private entries: OutboxEntry[];

  constructor(private readonly store: OutboxStore) {
    this.entries = store.load();
  }

  queue(to: string, body: string, padTo?: Bucket): OutboxEntry {
    // Validates the size up front, so the failure happens at queue time, not
    // in the middle of a flush.
    bucketFor(new TextEncoder().encode(body).length, padTo);
    const entry: OutboxEntry = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      to,
      body,
      ...(padTo !== undefined ? { padTo } : {}),
      status: "queued",
      queuedAt: Date.now(),
    };
    this.entries.push(entry);
    this.persist();
    return entry;
  }

  list(status?: SendStatus): OutboxEntry[] {
    return this.entries.filter((e) => (status ? e.status === status : true));
  }

  /** Queued entries, oldest first, optionally capped. */
  take(max = Infinity): OutboxEntry[] {
    return this.entries
      .filter((e) => e.status === "queued")
      .sort((a, b) => a.queuedAt - b.queuedAt)
      .slice(0, max);
  }

  mark(
    ids: string[],
    status: SendStatus,
    extra: { txHash?: string; error?: string; indices?: Map<string, number> } = {}
  ): void {
    for (const e of this.entries) {
      if (!ids.includes(e.id)) continue;
      e.status = status;
      if (extra.txHash !== undefined) e.txHash = extra.txHash;
      if (extra.error !== undefined) e.error = extra.error;
      const idx = extra.indices?.get(e.id);
      if (idx !== undefined) e.index = idx;
    }
    this.persist();
  }

  /** Drop confirmed entries (local tidy-up only — the chain copy is permanent). */
  clearConfirmed(): number {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.status !== "confirmed");
    this.persist();
    return before - this.entries.length;
  }

  private persist(): void {
    this.store.save(this.entries);
  }
}

/** Tier preview for a body — what `msg outbox` shows before any money is spent. */
export function tierOf(body: string, padTo?: Bucket): Bucket {
  return bucketFor(new TextEncoder().encode(body).length, padTo);
}
