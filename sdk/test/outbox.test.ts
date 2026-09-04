import { describe, expect, it } from "vitest";
import {
  MemoryStore,
  Outbox,
  calldataFeltCount,
  privacyInvokeCalldata,
  seal,
  splitBatch,
  tierOf,
} from "../src/index.js";

describe("Outbox", () => {
  it("queues, takes oldest-first, and walks the status machine", () => {
    const store = new MemoryStore();
    const box = new Outbox(store);
    const a = box.queue("bob", "first");
    const b = box.queue("bob", "second");
    const c = box.queue("carol", "third");

    expect(box.take().map((e) => e.id)).toEqual([a.id, b.id, c.id]);
    expect(box.take(2).length).toBe(2);

    box.mark([a.id, b.id], "proving");
    box.mark([a.id, b.id], "submitted", { txHash: "0xabc" });
    box.mark([a.id, b.id], "confirmed", {
      txHash: "0xabc",
      indices: new Map([
        [a.id, 4],
        [b.id, 5],
      ]),
    });

    expect(box.take().map((e) => e.id)).toEqual([c.id]); // only carol still queued
    const done = box.list("confirmed");
    expect(done.map((e) => e.index)).toEqual([4, 5]);
    expect(done.every((e) => e.txHash === "0xabc")).toBe(true);
  });

  it("persists through the store and reloads", () => {
    const store = new MemoryStore();
    new Outbox(store).queue("bob", "hello");
    const reloaded = new Outbox(store);
    expect(reloaded.list().length).toBe(1);
    expect(reloaded.list()[0]!.body).toBe("hello");
  });

  it("rejects oversize bodies at queue time, not flush time", () => {
    const box = new Outbox(new MemoryStore());
    expect(() => box.queue("bob", "x".repeat(5000))).toThrow(/4 KiB/);
    expect(box.list().length).toBe(0);
  });

  it("clearConfirmed removes only confirmed entries", () => {
    const box = new Outbox(new MemoryStore());
    const a = box.queue("bob", "one");
    box.queue("bob", "two");
    box.mark([a.id], "confirmed");
    expect(box.clearConfirmed()).toBe(1);
    expect(box.list().length).toBe(1);
  });

  it("tierOf previews the padding bucket", () => {
    expect(tierOf("hi")).toBe(256);
    expect(tierOf("x".repeat(300))).toBe(1024);
    expect(tierOf("hi", 4096)).toBe(4096);
  });
});

describe("batch calldata", () => {
  it("N sealed messages produce one InvokeExternal calldata", () => {
    const batch = [0, 1, 2].map((i) =>
      seal({ channelKey: 0x123n, index: i, sender: 1n, timestamp: 0n, body: new Uint8Array(5) })
    );
    const calldata = privacyInvokeCalldata(batch);
    expect(calldata[0]).toBe("0x3");
    expect(calldata.length).toBe(calldataFeltCount(batch));
    expect(calldataFeltCount(batch)).toBe(1 + 3 * (2 + 9)); // 9 felts per 256 B tier
  });

  it("splitBatch halves with the first half rounded up", () => {
    expect(splitBatch([1, 2, 3, 4, 5])).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
    expect(splitBatch([1])).toEqual([[1], []]);
  });
});
