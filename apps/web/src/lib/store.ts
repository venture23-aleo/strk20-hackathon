import {
  Outbox,
  SyncEngine,
  emptySnapshot,
  seal,
  msgId,
  tierOf,
  type OutboxEntry,
  type OutboxStore,
  type Sealed,
  type SyncSnapshot,
  type SyncStore,
} from "@strk20-messaging/sdk";
import { DemoBackend, DirectBackend, type Backend } from "./backend.js";
import { exportBackup, parseBackup } from "./backup.js";
import type { Contact } from "./contacts.js";
import { groupLanes, myLane, type Group, type GroupInvite, type GroupMember } from "./groups.js";

export interface AppConfig {
  onboarded: boolean;
  mode: "demo" | "direct";
  viewingKey: string;
  accountAddress: string;
  /** Honest by default; adjustable in settings for demos. */
  provingSeconds: number;
  rpcUrl?: string;
  helperAddress?: string;
  accountKey?: string;
  /**
   * Dev-mode only: messaging identity, when it differs from the signing
   * account — lets several browsers share one funded signer while remaining
   * distinct members of groups and threads. In pool mode identity IS the
   * account and this stays unset.
   */
  identityAddress?: string;
}

export interface FlushProgress {
  phase: "idle" | "proving" | "submitted" | "confirmed" | "failed";
  startedAt?: number;
  secondsTotal?: number;
  txHash?: string;
  error?: string;
}

const CONFIG_KEY = "strk20msg.config";
const CONTACTS_KEY = "strk20msg.contacts";
const GROUPS_KEY = "strk20msg.groups";
const OUTBOX_KEY = "strk20msg.outbox";
const SYNC_KEY = "strk20msg.sync";

class LsOutboxStore implements OutboxStore {
  load(): OutboxEntry[] {
    try {
      return JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? "[]") as OutboxEntry[];
    } catch {
      return [];
    }
  }
  save(entries: OutboxEntry[]): void {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries));
  }
}

class LsSyncStore implements SyncStore {
  load(): SyncSnapshot {
    try {
      const raw = localStorage.getItem(SYNC_KEY);
      if (raw) return JSON.parse(raw) as SyncSnapshot;
    } catch {
      /* fresh */
    }
    return emptySnapshot();
  }
  save(s: SyncSnapshot): void {
    localStorage.setItem(SYNC_KEY, JSON.stringify(s));
  }
}

export function randomFelt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(31));
  return "0x" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class AppStore {
  private listeners = new Set<() => void>();
  private version = 0;

  config: AppConfig | null;
  contacts: Contact[];
  groups: Group[];
  outbox: Outbox;
  flush: FlushProgress = { phase: "idle" };
  syncing = false;

  backend: Backend | null = null;
  engine: SyncEngine | null = null;

  constructor() {
    this.config = readJson<AppConfig>(CONFIG_KEY);
    this.contacts = readJson<Contact[]>(CONTACTS_KEY) ?? [];
    this.groups = readJson<Group[]>(GROUPS_KEY) ?? [];
    this.outbox = new Outbox(new LsOutboxStore());
    if (this.config?.onboarded) this.connect();
  }

  // -- plumbing -------------------------------------------------------------
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = (): number => this.version;
  private notify(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  private connect(): void {
    const cfg = this.config!;
    this.backend =
      cfg.mode === "direct" && cfg.rpcUrl && cfg.helperAddress && cfg.accountKey
        ? new DirectBackend(cfg.rpcUrl, cfg.helperAddress, cfg.accountAddress, cfg.accountKey)
        : new DemoBackend(cfg.provingSeconds);
    this.engine = new SyncEngine(this.backend.reader, new LsSyncStore());
  }

  // -- onboarding -----------------------------------------------------------
  completeOnboarding(cfg: Omit<AppConfig, "onboarded">, restoredContacts: Contact[] = []): void {
    this.config = { ...cfg, onboarded: true };
    this.contacts = restoredContacts;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(this.config));
    localStorage.setItem(CONTACTS_KEY, JSON.stringify(this.contacts));
    this.connect();
    void this.backend!.register(this.config.accountAddress);
    this.notify();
  }

  /** Switch mode / connection details (Settings) and reconnect the backend. */
  updateConnection(patch: Partial<AppConfig>): void {
    this.config = { ...this.config!, ...patch };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(this.config));
    this.connect();
    this.notify();
  }

  // -- contacts & the unregistered-recipient flow ---------------------------
  async addContact(
    label: string,
    peer: string,
    keys?: { outKey: string; inKey: string }
  ): Promise<Contact> {
    const registered = await this.backend!.isRegistered(peer);
    const contact: Contact = {
      label,
      peer,
      outKey: keys?.outKey ?? randomFelt(),
      inKey: keys?.inKey ?? randomFelt(),
      registered,
    };
    this.contacts = [...this.contacts.filter((c) => c.label !== label), contact];
    localStorage.setItem(CONTACTS_KEY, JSON.stringify(this.contacts));
    this.notify();
    return contact;
  }

  async refreshRegistration(contact: Contact): Promise<void> {
    const registered = await this.backend!.isRegistered(contact.peer);
    if (registered !== contact.registered) {
      this.contacts = this.contacts.map((c) => (c.peer === contact.peer ? { ...c, registered } : c));
      localStorage.setItem(CONTACTS_KEY, JSON.stringify(this.contacts));
      this.notify();
    }
  }

  simulatePeerRegistration(contact: Contact): void {
    this.backend?.demo?.simulatePeerRegistration(contact.peer);
    void this.refreshRegistration(contact);
  }

  /** Messaging identity: who I am in threads and groups (see identityAddress). */
  get identity(): string {
    return this.config?.identityAddress || this.config!.accountAddress;
  }

  // -- groups ---------------------------------------------------------------
  createGroup(name: string, members: GroupMember[]): Group {
    const group: Group = {
      name,
      groupKey: randomFelt(),
      // No viewer-relative labels in the stored/shared member list — "you" is
      // computed per viewer at stitch time.
      members: [{ address: this.identity }, ...members.filter((m) => m.address)],
    };
    this.groups = [...this.groups.filter((g) => g.name !== name), group];
    localStorage.setItem(GROUPS_KEY, JSON.stringify(this.groups));
    this.notify();
    return group;
  }

  joinGroup(invite: GroupInvite): Group {
    const group: Group = { name: invite.name, groupKey: invite.groupKey, members: invite.members };
    this.groups = [...this.groups.filter((g) => g.name !== group.name), group];
    localStorage.setItem(GROUPS_KEY, JSON.stringify(this.groups));
    this.notify();
    return group;
  }

  groupByName(name: string): Group | undefined {
    return this.groups.find((g) => g.name === name);
  }

  queueToGroup(group: Group, text: string): void {
    this.outbox.queue(`#${group.name}`, text);
    this.notify();
  }

  // -- outbox ---------------------------------------------------------------
  queue(contact: Contact, text: string): void {
    this.outbox.queue(contact.label, text);
    this.notify();
  }

  /** Resolve an outbox destination to the lane it writes on. */
  private laneFor(to: string): { laneHex: string; display: string } | null {
    if (to.startsWith("#")) {
      const group = this.groupByName(to.slice(1));
      return group ? { laneHex: myLane(group, this.identity), display: to } : null;
    }
    const contact = this.contacts.find((c) => c.label === to);
    return contact ? { laneHex: contact.outKey, display: contact.label } : null;
  }

  queuedTiers(): number[] {
    return this.outbox.take().map((e) => tierOf(e.body, e.padTo));
  }

  /** Flush every queued message: one transaction per contact lane. */
  async sendBatch(): Promise<void> {
    const queued = this.outbox.take();
    if (queued.length === 0 || this.flush.phase === "proving") return;
    const cfg = this.config!;

    try {
      const byLane = new Map<string, { display: string; entries: OutboxEntry[] }>();
      for (const e of queued) {
        const dest = this.laneFor(e.to);
        if (!dest) continue;
        const bucket = byLane.get(dest.laneHex) ?? { display: dest.display, entries: [] };
        bucket.entries.push(e);
        byLane.set(dest.laneHex, bucket);
      }

      for (const [laneHex, { display, entries }] of byLane) {
        const outKey = BigInt(laneHex);
        let index = 0;
        for (;;) {
          const lens = await this.backend!.reader.slotLens(
            Array.from({ length: 16 }, (_, k) => msgId(outKey, index + k))
          );
          const empty = lens.findIndex((l) => l === 0);
          if (empty >= 0) {
            index += empty;
            break;
          }
          index += 16;
        }

        const items: { entry: OutboxEntry; sealed: Sealed; index: number }[] = entries.map(
          (entry, k) => ({
            entry,
            index: index + k,
            sealed: seal({
              channelKey: outKey,
              index: index + k,
              sender: BigInt(this.identity),
              timestamp: BigInt(Math.floor(Date.now() / 1000)),
              body: new TextEncoder().encode(entry.body),
            }),
          })
        );
        const ids = items.map((i) => i.entry.id);

        this.flush = {
          phase: "proving",
          startedAt: Date.now(),
          secondsTotal: cfg.provingSeconds,
        };
        this.outbox.mark(ids, "proving");
        this.notify();

        const { txHash } = await this.backend!.submitBatch(
          items.map((i) => i.sealed),
          (state) => {
            this.flush = { ...this.flush, phase: state };
            this.outbox.mark(ids, state);
            this.notify();
          }
        );

        this.outbox.mark(ids, "confirmed", {
          txHash,
          indices: new Map(items.map((i) => [i.entry.id, i.index])),
        });
        this.flush = { phase: "confirmed", txHash };
        this.notify();

        await this.syncNow();
        // Demo counterparty replies only in one-to-one threads.
        const contact = this.contacts.find((c) => c.label === display);
        if (contact) this.backend!.demo?.scheduleReply(contact, () => void this.syncNow());
      }
    } catch (err) {
      // A failed batch goes BACK to queued — retryable, never stuck in
      // "proving"/"submitted" limbo. (WriteOnce slots make an accidental
      // double-send self-defeating anyway: a re-flush re-walks the indices.)
      const stuck = [...this.outbox.list("proving"), ...this.outbox.list("submitted")].map((e) => e.id);
      if (stuck.length) this.outbox.mark(stuck, "queued");
      this.flush = { phase: "failed", error: err instanceof Error ? err.message : String(err) };
      this.notify();
    }
  }

  // -- sync -----------------------------------------------------------------
  async syncNow(): Promise<void> {
    if (!this.engine || this.syncing) return;
    this.syncing = true;
    this.notify();
    try {
      const me = this.identity;
      const keys = [
        ...this.contacts.flatMap((c) => [c.outKey, c.inKey]),
        ...this.groups.flatMap((g) => groupLanes(g, me).map((l) => l.laneKey)),
      ];
      await this.engine.sync(keys);
    } finally {
      this.syncing = false;
      this.notify();
    }
  }

  // -- backup ---------------------------------------------------------------
  backupJson(): string {
    const cfg = this.config!;
    return exportBackup({
      viewingKey: cfg.viewingKey,
      accountAddress: cfg.accountAddress,
      contacts: this.contacts,
    });
  }

  restoreFromBackup(json: string): { viewingKey: string; accountAddress: string; contacts: Contact[] } {
    const b = parseBackup(json);
    return { viewingKey: b.viewingKey, accountAddress: b.accountAddress, contacts: b.contacts };
  }
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export const store = new AppStore();
