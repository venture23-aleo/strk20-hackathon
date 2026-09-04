/**
 * M5 exit criteria at the unit level, against a fake chain:
 *   - no local state -> full history reconstructed
 *   - interrupted mid-scan -> resumes with no gaps and no duplicates
 *   - sync state reports the block reached
 */
import { describe, expect, it } from "vitest";
import {
  MemorySyncStore,
  SyncEngine,
  msgId,
  seal,
  type SlotReader,
} from "../src/index.js";

const CK = "0x29f111f2674fda971bbee26106be4792a4336860bea7f3c4289d9c8dc16a948";
const CK2 = "0x5a0aa03c5d8649895810c86ed63b62d91895734e6d3ab2e80ada6f6fb400c84";

/** In-memory chain: seal real messages into a msgId -> felts map. */
function fakeChain(perChannel: Record<string, string[]>, block = 4242): SlotReader {
  const slots = new Map<string, bigint[]>();
  for (const [ckHex, bodies] of Object.entries(perChannel)) {
    bodies.forEach((body, index) => {
      const s = seal({
        channelKey: BigInt(ckHex),
        index,
        sender: 0xa11cen,
        timestamp: 1_756_944_000n + BigInt(index),
        body: new TextEncoder().encode(body),
      });
      slots.set(s.msgId.toString(), s.felts);
    });
  }
  return {
    slotLens: async (ids) => ids.map((id) => slots.get(id.toString())?.length ?? 0),
    slots: async (id) => {
      const felts = slots.get(id.toString());
      if (!felts) throw new Error("read of empty slot");
      return felts;
    },
    blockNumber: async () => block,
  };
}

const bodies = (n: number, prefix = "msg") => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe("SyncEngine", () => {
  it("reconstructs full history from nothing, across channels and window boundaries", async () => {
    // 21 messages: spans two 16-windows; second channel small
    const chain = fakeChain({ [CK]: bodies(21), [CK2]: bodies(3, "other") });
    const engine = new SyncEngine(chain, new MemorySyncStore());
    const result = await engine.sync([CK, CK2]);

    expect(result.found).toBe(24);
    expect(result.totalMessages).toBe(24);
    expect(result.syncedToBlock).toBe(4242);

    const history = engine.history(CK);
    expect(history.length).toBe(21);
    expect(history.map((h) => h.index)).toEqual([...Array(21).keys()]); // dense, ordered
    expect(Buffer.from(history[20]!.bodyBase64, "base64").toString()).toBe("msg20");
  });

  it("interrupted mid-scan resumes without gaps or duplicates", async () => {
    const chain = fakeChain({ [CK]: bodies(40) }); // 3 windows
    const store = new MemorySyncStore();
    const engine = new SyncEngine(chain, store);

    // First run: die after the first persisted window.
    await expect(
      engine.sync([CK], {
        onWindow: () => {
          throw new Error("SIGKILL, effectively");
        },
      })
    ).rejects.toThrow(/SIGKILL/);
    const partial = store.load();
    expect(Object.keys(partial.messages).length).toBe(16); // one window persisted
    expect(partial.syncedToBlock).toBeNull(); // watermark only set on completion

    // Second run: resume — same engine state lives entirely in the store.
    const result = await new SyncEngine(chain, store).sync([CK]);
    expect(result.found).toBe(24); // only the missing ones
    expect(result.totalMessages).toBe(40); // no duplicates: 16 + 24

    const history = new SyncEngine(chain, store).history(CK);
    expect(history.map((h) => h.index)).toEqual([...Array(40).keys()]); // no gaps
  });

  it("re-sync after new messages picks up only the delta", async () => {
    const store = new MemorySyncStore();
    await new SyncEngine(fakeChain({ [CK]: bodies(5) }, 100), store).sync([CK]);
    const second = await new SyncEngine(fakeChain({ [CK]: bodies(9) }, 200), store).sync([CK]);
    expect(second.found).toBe(4);
    expect(second.totalMessages).toBe(9);
    expect(second.syncedToBlock).toBe(200); // watermark advances
  });

  it("fromScratch rescans index 0 and converges to the same history", async () => {
    const chain = fakeChain({ [CK]: bodies(10) });
    const store = new MemorySyncStore();
    await new SyncEngine(chain, store).sync([CK]);
    const again = await new SyncEngine(chain, store).sync([CK], { fromScratch: true });
    expect(again.found).toBe(10); // fully rebuilt
    expect(again.totalMessages).toBe(10); // not duplicated
  });

  it("status reports the watermark", async () => {
    const store = new MemorySyncStore();
    const engine = new SyncEngine(fakeChain({ [CK]: bodies(2) }, 777), store);
    expect(engine.status().syncedToBlock).toBeNull();
    await engine.sync([CK]);
    const s = engine.status();
    expect(s.syncedToBlock).toBe(777);
    expect(s.totalMessages).toBe(2);
    expect(s.updatedAt).toBeGreaterThan(0);
  });

  it("never reads an empty slot's payload", async () => {
    // fakeChain throws on empty-slot reads, so a clean pass proves the walk
    // only fetches occupied indices.
    const engine = new SyncEngine(fakeChain({ [CK]: bodies(17) }), new MemorySyncStore());
    await engine.sync([CK]);
    // and msgId spot check: the walk uses the derived slot ids
    expect(msgId(BigInt(CK), 0)).not.toBe(msgId(BigInt(CK2), 0));
  });
});
