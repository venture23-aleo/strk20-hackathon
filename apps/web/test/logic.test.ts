import { describe, expect, it } from "vitest";
import { seal, MemorySyncStore, SyncEngine } from "@strk20-messaging/sdk";
import { exportBackup, parseBackup } from "../src/lib/backup.js";
import { stitchThread, type Contact } from "../src/lib/contacts.js";
import { MAX_BODY_BYTES, batchPreview, tierPreview } from "../src/lib/costs.js";

const contact: Contact = {
  label: "bob",
  peer: "0xb0b",
  outKey: "0x29f111f2674fda971bbee26106be4792a4336860bea7f3c4289d9c8dc16a948",
  inKey: "0x5a0aa03c5d8649895810c86ed63b62d91895734e6d3ab2e80ada6f6fb400c84",
  registered: true,
};

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const fromB64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
const rec = (channelKey: string, index: number, timestamp: number, body: string) => ({
  channelKey,
  index,
  sender: "0xa11ce",
  timestamp,
  bodyBase64: b64(body),
});

describe("tierPreview — padding-tier cost preview with boundary warnings", () => {
  it("shows the tier and cost for a small message, with no warning", () => {
    const p = tierPreview("hello");
    expect(p.tier).toBe(256);
    expect(p.usd).toBeGreaterThan(0);
    expect(p.boundary).toBeUndefined();
  });

  it("warns near a boundary with the byte distance and price delta", () => {
    // 256 − header(45) = 211 max; 200 bytes leaves 11 left — inside the warn window
    const p = tierPreview("x".repeat(200));
    expect(p.tier).toBe(256);
    expect(p.boundary).toBeDefined();
    expect(p.boundary!.bytesLeft).toBe(11);
    expect(p.boundary!.nextTier).toBe(1024);
    expect(p.boundary!.extraUsd).toBeGreaterThan(0);
  });

  it("crosses the boundary into the next tier", () => {
    expect(tierPreview("x".repeat(212)).tier).toBe(1024);
  });

  it("rejects over-ceiling bodies with the overage", () => {
    const p = tierPreview("x".repeat(MAX_BODY_BYTES + 7));
    expect(p.tier).toBeNull();
    expect(p.overBy).toBe(7);
  });

  it("batchPreview sums cost and reports the single-transaction shape", () => {
    const b = batchPreview([256, 256, 1024], 29);
    expect(b.count).toBe(3);
    expect(b.seconds).toBe(29);
    expect(b.usd).toBeGreaterThan(0);
  });
});

describe("stitchThread — two directional lanes, one conversation", () => {
  it("merges both lanes by timestamp and tags direction", () => {
    const history = [
      rec(contact.outKey, 0, 100, "hi bob"),
      rec(contact.inKey, 0, 150, "hi alice"),
      rec(contact.outKey, 1, 200, "how are you"),
      rec(contact.inKey, 1, 250, "good!"),
    ];
    const thread = stitchThread(history, contact);
    expect(thread.map((m) => m.body)).toEqual(["hi bob", "hi alice", "how are you", "good!"]);
    expect(thread.map((m) => m.direction)).toEqual(["sent", "received", "sent", "received"]);
  });

  it("keeps a deterministic order when timestamps tie", () => {
    const history = [rec(contact.outKey, 0, 100, "A"), rec(contact.inKey, 0, 100, "B")];
    const a = stitchThread(history, contact);
    const b = stitchThread([...history].reverse(), contact);
    expect(a.map((m) => m.body)).toEqual(b.map((m) => m.body));
    expect(a[0]!.direction).toBe("received"); // ties: received lane first
  });

  it("ignores other channels' records", () => {
    const history = [rec("0xdead", 0, 100, "noise"), rec(contact.outKey, 0, 120, "real")];
    expect(stitchThread(history, contact).map((m) => m.body)).toEqual(["real"]);
  });
});

describe("invite — pairing two clients onto the same lanes", () => {
  it("round-trips with mirrored lanes: my out is their in, and vice versa", async () => {
    const { makeInvite, parseInvite } = await import("../src/lib/contacts.js");
    const invite = parseInvite(JSON.stringify(makeInvite(contact, "0xa11ce")))!;
    expect(invite).not.toBeNull();
    expect(invite.peer).toBe("0xa11ce");
    expect(invite.yourOutKey).toBe(contact.inKey); // they send on what I read
    expect(invite.yourInKey).toBe(contact.outKey); // they read what I send

    // the receiver's contact, built from the invite, stitches the SAME thread
    const theirContact: Contact = {
      label: "alice",
      peer: invite.peer,
      outKey: invite.yourOutKey,
      inKey: invite.yourInKey,
      registered: true,
    };
    const history = [rec(contact.outKey, 0, 100, "from me"), rec(contact.inKey, 0, 200, "from them")];
    const mine = stitchThread(history, contact).map((m) => [m.body, m.direction]);
    const theirs = stitchThread(history, theirContact).map((m) => [m.body, m.direction]);
    expect(mine).toEqual([
      ["from me", "sent"],
      ["from them", "received"],
    ]);
    expect(theirs).toEqual([
      ["from me", "received"],
      ["from them", "sent"],
    ]);
  });

  it("rejects garbage and near-misses", async () => {
    const { parseInvite } = await import("../src/lib/contacts.js");
    expect(parseInvite("hello")).toBeNull();
    expect(parseInvite(JSON.stringify({ peer: "0x1" }))).toBeNull();
    expect(
      parseInvite(JSON.stringify({ "strk20msg-invite": 1, peer: "0x1", yourOutKey: "nope", yourInKey: "0x2" }))
    ).toBeNull();
  });
});

describe("backup — key export and restore", () => {
  it("round-trips key, address and contacts", () => {
    const json = exportBackup({
      viewingKey: "0x123abc",
      accountAddress: "0xa11ce",
      contacts: [contact],
    });
    const restored = parseBackup(json);
    expect(restored.viewingKey).toBe("0x123abc");
    expect(restored.contacts[0]!.outKey).toBe(contact.outKey);
  });

  it("rejects garbage, wrong versions, and missing keys", () => {
    expect(() => parseBackup("not json")).toThrow(/JSON/);
    expect(() => parseBackup(JSON.stringify({ version: 2 }))).toThrow(/version/);
    expect(() => parseBackup(JSON.stringify({ version: 1, viewingKey: "hello" }))).toThrow(/viewing key/);
    expect(() =>
      parseBackup(JSON.stringify({ version: 1, viewingKey: "0x1", accountAddress: "0xa", contacts: [{}] }))
    ).toThrow(/contact/);
  });

  it("a restored key rebuilds history via sync — backup needs no message data", async () => {
    // Simulate: messages exist on 'chain'; a fresh device restores the backup
    // (keys only) and syncs. Mirrors the M5 guarantee end to end in the web model.
    const slots = new Map<string, bigint[]>();
    const s = seal({
      channelKey: BigInt(contact.outKey),
      index: 0,
      sender: 0xa11cen,
      timestamp: 1000n,
      body: new TextEncoder().encode("survives reinstall"),
    });
    slots.set(s.msgId.toString(), s.felts);
    const reader = {
      slotLens: async (ids: bigint[]) => ids.map((id) => slots.get(id.toString())?.length ?? 0),
      slots: async (id: bigint) => slots.get(id.toString())!,
      blockNumber: async () => 7,
    };
    const restored = parseBackup(exportBackup({ viewingKey: "0x1", accountAddress: "0xa", contacts: [contact] }));
    const engine = new SyncEngine(reader, new MemorySyncStore());
    await engine.sync(restored.contacts.flatMap((c) => [c.outKey, c.inKey]));
    const history = engine.history();
    expect(history.length).toBe(1);
    expect(fromB64(history[0]!.bodyBase64)).toBe("survives reinstall");
  });
});
