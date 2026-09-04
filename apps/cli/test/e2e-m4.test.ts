/**
 * M4 exit criteria, on devnet in direct mode:
 *   1. 8 queued messages land in ONE transaction (one fee; "one proof" is pool
 *      mode's half, whose calldata is byte-identical).
 *   2. A memo rides a transfer atomically — and an on-chain revert of the
 *      transfer also reverts the memo (asserted on a real reverted receipt).
 *
 * Gated: RUN_DEVNET_E2E=1, starknet-devnet v0.8.0-rc.3 on PATH.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { msgId, privacyInvokeCalldata, seal } from "@strk20-messaging/sdk";
import { Account } from "starknet";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ETH, erc20Balance, setupDevnet, type DevnetCtx } from "./devnetSetup.js";

const RUN = process.env.RUN_DEVNET_E2E === "1";
const CLI = join(import.meta.dirname, "../dist/index.js");
const CK_BATCH = "0x29f111f2674fda971bbee26106be4792a4336860bea7f3c4289d9c8dc16a948";
const CK_PAY = "0x5a0aa03c5d8649895810c86ed63b62d91895734e6d3ab2e80ada6f6fb400c84";
const CK_REVERT = "0x471dc3914662d83a71b3249ae34ad8bed91aebf0ebf9dcd040d5773552d5934";

let ctx: DevnetCtx;
let homeA: string;
let homeB: string;

function msgCli(home: string, pk: string, args: string[]): string {
  return execFileSync("node", [CLI, ...args], {
    env: { ...process.env, STRK20_MSG_HOME: home, STRK20_MSG_PRIVATE_KEY: pk },
    encoding: "utf8",
  });
}

describe.skipIf(!RUN)("M4 batching, memo, resilience (devnet, direct mode)", () => {
  beforeAll(async () => {
    ctx = await setupDevnet();
    homeA = mkdtempSync(join(tmpdir(), "msg-m4-a-"));
    homeB = mkdtempSync(join(tmpdir(), "msg-m4-b-"));
    const url = ctx.devnet.provider.url;
    for (const [home, who] of [
      [homeA, ctx.alice],
      [homeB, ctx.bob],
    ] as const) {
      msgCli(home, who.privateKey, [
        "init", "--rpc", url, "--helper", ctx.helperAddress, "--account", who.address, "--mode", "direct",
      ]);
    }
    for (const [ck, label] of [
      [CK_BATCH, "bob"],
      [CK_PAY, "bob-pay"],
    ] as const) {
      msgCli(homeA, ctx.alice.privateKey, [
        "channel", "add", "--label", label, "--peer", ctx.bob.address, "--key", ck,
      ]);
      msgCli(homeB, ctx.bob.privateKey, [
        "channel", "add", "--label", `alice-${label}`, "--peer", ctx.alice.address, "--key", ck,
      ]);
    }
  }, 300_000);

  afterAll(async () => {
    ctx?.devnet.kill();
  });

  it("8 queued messages flush in one transaction and all arrive in order", { timeout: 120_000 }, () => {
    for (let i = 1; i <= 8; i++) {
      msgCli(homeA, ctx.alice.privateKey, ["queue", "--to", "bob", `m${i}`]);
    }
    const outboxOut = msgCli(homeA, ctx.alice.privateKey, ["outbox"]);
    expect(outboxOut).toContain("8 message(s) queued · one transaction on flush");

    const flushOut = msgCli(homeA, ctx.alice.privateKey, ["flush"]);
    expect(flushOut).toContain("flushing 8 message(s) to bob in one transaction");
    expect(flushOut.match(/submitted 0x/g)?.length).toBe(1); // exactly one tx
    expect(flushOut).toContain("flushed 8 message(s) in 1 transaction(s)");

    const readOut = msgCli(homeB, ctx.bob.privateKey, ["read"]);
    for (let i = 1; i <= 8; i++) expect(readOut).toContain(`· "m${i}"`);
    const order = [...readOut.matchAll(/"m(\d)"/g)].map((m) => Number(m[1]));
    expect(order).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    // outbox reflects the terminal state
    const after = msgCli(homeA, ctx.alice.privateKey, ["outbox"]);
    expect(after.match(/confirmed/g)?.length).toBe(8);
  });

  it("memo rides a transfer atomically — success case", { timeout: 120_000 }, async () => {
    const before = await erc20Balance(ctx.provider, ETH, ctx.bob.address);
    const payOut = msgCli(homeA, ctx.alice.privateKey, [
      "pay", "--to", "bob-pay", "--token", ETH, "--amount", "12345", "--memo", "invoice #1",
    ]);
    expect(payOut).toContain("confirmed 0x");

    const after = await erc20Balance(ctx.provider, ETH, ctx.bob.address);
    expect(after - before).toBe(12345n);

    const readOut = msgCli(homeB, ctx.bob.privateKey, ["read"]);
    expect(readOut).toContain('"invoice #1"');
  });

  it("reverting the transfer also reverts the memo — on-chain revert", { timeout: 120_000 }, async () => {
    const ck = BigInt(CK_REVERT);
    const sealed = seal({
      channelKey: ck,
      index: 0,
      sender: BigInt(ctx.alice.address),
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
      body: new TextEncoder().encode("memo that must not land"),
    });
    const absurd = 10n ** 30n; // far beyond alice's balance: transfer reverts
    const account = new Account({
      provider: ctx.provider,
      address: ctx.alice.address,
      signer: ctx.alice.privateKey,
    });

    // Explicit resource bounds skip fee estimation, so the revert happens
    // ON-CHAIN rather than client-side — the stronger form of the criterion.
    const tx = await account.execute(
      [
        {
          contractAddress: ETH,
          entrypoint: "transfer",
          calldata: [ctx.bob.address, "0x" + (absurd & ((1n << 128n) - 1n)).toString(16), "0x" + (absurd >> 128n).toString(16)],
        },
        {
          contractAddress: ctx.helperAddress,
          entrypoint: "privacy_invoke",
          calldata: privacyInvokeCalldata([sealed]),
        },
      ],
      {
        tip: 0n,
        resourceBounds: {
          // High enough to pass the minimal-fee check, low enough that the
          // worst-case fee (sum of amount x price) stays within the account's
          // 1000-token devnet balance.
          l2_gas: { max_amount: 500_000_000n, max_price_per_unit: 1_000_000_000_000n },
          l1_gas: { max_amount: 1_000n, max_price_per_unit: 100_000_000_000_000n },
          l1_data_gas: { max_amount: 10_000n, max_price_per_unit: 1_000_000_000_000n },
        },
      }
    );
    const receipt = await ctx.provider.waitForTransaction(tx.transaction_hash);
    expect((receipt as { isSuccess(): boolean }).isSuccess()).toBe(false); // reverted, on-chain

    // the memo slot must be empty: the transfer's revert took the memo with it
    const lenRes = await ctx.provider.callContract({
      contractAddress: ctx.helperAddress,
      entrypoint: "slot_len",
      calldata: ["0x" + msgId(ck, 0).toString(16)],
    });
    expect(BigInt(lenRes[0]!)).toBe(0n);
  });
});
