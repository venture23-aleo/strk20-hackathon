/**
 * M5 exit criteria on devnet, direct mode:
 *   - a client with NO local state (fresh config home, channel keys only)
 *     reconstructs the full message history from chain state
 *   - an interrupted mid-scan resumes without gaps or duplicates, against the
 *     real deployed helper
 *   - sync state reports the block reached
 *
 * Gated: RUN_DEVNET_E2E=1, starknet-devnet v0.8.0-rc.3 on PATH.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemorySyncStore, SyncEngine } from "@strk20-messaging/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HelperClient } from "../src/helper.js";
import { setupDevnet, type DevnetCtx } from "./devnetSetup.js";

const RUN = process.env.RUN_DEVNET_E2E === "1";
const CLI = join(import.meta.dirname, "../dist/index.js");
const CK = "0x6b098ad0b0b4b1881a77f962eb0650de748f24efcabd5a64ac941e9a05777e8";

let ctx: DevnetCtx;

function msgCli(home: string, pk: string, args: string[]): string {
  return execFileSync("node", [CLI, ...args], {
    env: { ...process.env, STRK20_MSG_HOME: home, STRK20_MSG_PRIVATE_KEY: pk },
    encoding: "utf8",
  });
}

function initHome(who: { address: string; privateKey: string }, label: string): string {
  const home = mkdtempSync(join(tmpdir(), "msg-m5-"));
  msgCli(home, who.privateKey, [
    "init", "--rpc", ctx.devnet.provider.url, "--helper", ctx.helperAddress,
    "--account", who.address, "--mode", "direct",
  ]);
  msgCli(home, who.privateKey, [
    "channel", "add", "--label", label, "--peer", ctx.bob.address, "--key", CK,
  ]);
  return home;
}

describe.skipIf(!RUN)("M5 discovery and sync (devnet, direct mode)", () => {
  beforeAll(async () => {
    ctx = await setupDevnet();
    // Populate the chain: 20 messages in two flushed batches from a sender home.
    const homeA = initHome(ctx.alice, "bob");
    for (let i = 1; i <= 12; i++) msgCli(homeA, ctx.alice.privateKey, ["queue", "--to", "bob", `h${i}`]);
    msgCli(homeA, ctx.alice.privateKey, ["flush"]);
    for (let i = 13; i <= 20; i++) msgCli(homeA, ctx.alice.privateKey, ["queue", "--to", "bob", `h${i}`]);
    msgCli(homeA, ctx.alice.privateKey, ["flush"]);
  }, 300_000);

  afterAll(async () => {
    ctx?.devnet.kill();
  });

  it("a client with no local state reconstructs full history", { timeout: 120_000 }, () => {
    // Brand-new home: config + channel key only; no cursors, no cache.
    const fresh = initHome(ctx.bob, "alice");

    const syncOut = msgCli(fresh, ctx.bob.privateKey, ["sync", "--full"]);
    expect(syncOut).toMatch(/synced to block \d+ · 20 message\(s\) known/);

    const historyOut = msgCli(fresh, ctx.bob.privateKey, ["history"]);
    const order = [...historyOut.matchAll(/"h(\d+)"/g)].map((m) => Number(m[1]));
    expect(order).toEqual(Array.from({ length: 20 }, (_, i) => i + 1)); // all 20, in order

    const statusOut = msgCli(fresh, ctx.bob.privateKey, ["status"]);
    expect(statusOut).toMatch(/synced to block \d+ · 20 message\(s\)/);
  });

  it("an interrupted mid-scan resumes without gaps or duplicates", { timeout: 120_000 }, async () => {
    const helper = new HelperClient(ctx.provider, ctx.helperAddress);
    const reader = {
      slotLens: (ids: bigint[]) => helper.slotLens(ids),
      slots: (id: bigint) => helper.slots(id),
      blockNumber: () => ctx.provider.getBlockNumber(),
    };
    const store = new MemorySyncStore();

    // First scan dies after the first persisted window — mid-scan, for real,
    // against the deployed helper.
    await expect(
      new SyncEngine(reader, store).sync([CK], {
        onWindow: () => {
          throw new Error("interrupted");
        },
      })
    ).rejects.toThrow(/interrupted/);
    const partial = Object.keys(store.load().messages).length;
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(20);

    // Resume from the store alone.
    const result = await new SyncEngine(reader, store).sync([CK]);
    expect(result.totalMessages).toBe(20); // no duplicates
    const history = new SyncEngine(reader, store).history(CK);
    expect(history.map((h) => h.index)).toEqual([...Array(20).keys()]); // no gaps
    expect(result.syncedToBlock).toBeGreaterThan(0); // watermark reported
  });
});
