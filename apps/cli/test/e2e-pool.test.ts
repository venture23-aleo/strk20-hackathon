/**
 * POOL MODE, against the real privacy pool contract — the sender-anonymity
 * mechanics, end to end:
 *
 *   - our helper is deployed with pool = the actual pool contract
 *   - the message rides a pool transaction (carrier + InvokeExternal), built
 *     by the same shapes as apps/cli/src/pool.ts
 *   - the pool — not the user — calls privacy_invoke (CALLER_NOT_POOL proves it)
 *   - the transaction is submitted via outside execution: the SENDER'S ACCOUNT
 *     APPEARS NOWHERE in the transaction envelope
 *
 * Runs on devnet via the Privacy SDK's own test harness (real pool contract,
 * mock proving). On Sepolia the identical path needs only the production
 * proving-service URL — the one credential that is not public.
 *
 * Gated: RUN_POOL_E2E=1 STARKNET_PRIVACY=<built starknet-privacy checkout>
 *        + starknet-devnet v0.8.0-rc.3 on PATH.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { msgId, open, privacyInvokeCalldata, seal } from "@strk20-messaging/sdk";
import { CallData } from "starknet";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HelperClient } from "../src/helper.js";

const RUN = process.env.RUN_POOL_E2E === "1" && !!process.env.STARKNET_PRIVACY;
const CONTRACTS = join(import.meta.dirname, "../../../contracts/target/dev");
const CK = 0x29f111f2674fda971bbee26106be4792a4336860bea7f3c4289d9c8dc16a948n;

/* eslint-disable @typescript-eslint/no-explicit-any */
let devnet: any;
let env: any;
let transfers: any;
let helperAddress: string;
let messageTxHash = "";
let carrierUsed = "";

describe.skipIf(!RUN)("pool mode: sender anonymity through the real pool", () => {
  beforeAll(async () => {
    const harness: any = await import(
      pathToFileURL(`${process.env.STARKNET_PRIVACY}/sdk/dist/testing/index.js`).href
    );
    devnet = new harness.Devnet();
    ({ env, transfers } = await harness.createDevnetTestEnv(devnet));

    // Our M2 helper, pinned to the REAL pool contract as its pool.
    const contract = JSON.parse(
      readFileSync(join(CONTRACTS, "message_anonymizer_MessageAnonymizer.contract_class.json"), "utf8")
    );
    const casm = JSON.parse(
      readFileSync(
        join(CONTRACTS, "message_anonymizer_MessageAnonymizer.compiled_contract_class.json"),
        "utf8"
      )
    );
    const declared = await env.alice.declareAndDeploy(
      { contract, casm, constructorCalldata: [env.privacy.address] },
      { tip: 0n }
    );
    helperAddress = declared.deploy.contract_address;
  }, 300_000);

  afterAll(async () => {
    await devnet?.cleanup?.();
  });

  it("a message rides a pool transaction; the sender never appears", { timeout: 300_000 }, async () => {
    // 1. Alice enters the pool: approve, then shield 100 of the STRK-like token.
    await env.alice.execute({
      contractAddress: env.strk,
      entrypoint: "approve",
      calldata: [env.privacy.address, 100n, 0n],
    });
    const dep = await transfers.alice
      .build({
        autoRegister: true,
        autoSetup: true,
        autoDiscover: { notes: "refresh", channels: "refresh" },
      })
      .with(env.strk)
      .deposit({ amount: 100n })
      .surplusTo(env.alice.address)
      .execute();
    const depReceipt = await devnet.executeOutside(dep.callAndProof);
    expect(depReceipt.isReverted()).toBe(false);

    // 2. Seal the message — same crypto as every other mode.
    const sealed = seal({
      channelKey: CK,
      index: 0,
      sender: BigInt(env.alice.address),
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
      body: new TextEncoder().encode("hello through the pool"),
    });

    // 3. The pool.ts shape: replay-protection carrier + one InvokeExternal.
    //    Preferred carrier is the zero-amount enc note (M0/S1); fall back to a
    //    1-wei self-transfer if the SDK's client-side validation refuses zero.
    const buildMsgTx = (carrierAmount: bigint) =>
      transfers.alice
        .build({ autoSetup: true, autoSelectNotes: "all", autoDiscover: { notes: "refresh", channels: "refresh" } })
        .with(env.strk, (t: any) => {
          t.transfer({ recipient: env.alice.address, amount: carrierAmount });
          t.surplusTo(env.alice.address); // change note back to self
        })
        .invoke(() => ({
          contractAddress: helperAddress,
          calldata: CallData.compile(privacyInvokeCalldata([sealed])),
        }))
        .execute();

    // Execution finding on M0/S1: the POOL sanctions zero-amount notes, but the
    // shipped SDK refuses them client-side — pin that restriction here so an
    // SDK release that lifts it is noticed (then the carrier gets cheaper).
    await expect(buildMsgTx(0n)).rejects.toThrow(/must be positive/);
    // Working carrier today: 1-wei enc-note churn to self — never leaves the pool.
    const msgCall = await buildMsgTx(1n);
    carrierUsed = "1-wei self-transfer (SDK refuses zero client-side; pool would allow it)";
    const receipt = await devnet.executeOutside(msgCall.callAndProof);
    expect(receipt.isReverted()).toBe(false);
    messageTxHash = receipt.transaction_hash;

    // 4. The helper stored it — and the helper only accepts calls from the
    //    pool contract, so the pool WAS the caller.
    const helper = new HelperClient(env.node, helperAddress);
    const felts = await helper.slots(msgId(CK, 0));
    expect(felts.length).toBe(9);
    const frame = open(CK, 0, felts);
    expect(new TextDecoder().decode(frame.body)).toBe("hello through the pool");
    expect(frame.sender).toBe(BigInt(env.alice.address)); // authenticated INSIDE the ciphertext

    // 5. Sender anonymity, on the wire: alice's address appears NOWHERE in the
    //    transaction envelope — not as sender, not in calldata.
    const tx: any = await env.node.getTransaction(messageTxHash);
    const alice = BigInt(env.alice.address);
    expect(BigInt(tx.sender_address)).not.toBe(alice); // submitter is the outside executor
    const calldata: bigint[] = (tx.calldata ?? []).map((c: string) => BigInt(c));
    expect(calldata).not.toContain(alice);
    // the visible parties are the pool and the helper — by design
    expect(calldata).toContain(BigInt(helperAddress));

    console.log(
      `carrier: ${carrierUsed} · tx sender: ${tx.sender_address} (admin/outside executor) · alice absent from envelope`
    );
  });
});
