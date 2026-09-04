/**
 * M3 exit-criteria scenario, on a local devnet in direct (dev) mode:
 *
 *   machine A:  msg send --to bob "hello"   → submitted… confirmed 0x…
 *   machine B:  msg read                    → [1] from 0xALICE · … · "hello"
 *
 * Two separate STRK20_MSG_HOME dirs play the two machines; the M2 contract is
 * declared and deployed for real; the CLI binary runs as a child process. The
 * observer property is asserted on calldata (no recipient, no plaintext);
 * submitter anonymity is pool mode's job and is out of scope for direct mode.
 *
 * Gated: RUN_DEVNET_E2E=1 pnpm test:e2e  (downloads a devnet binary on first run)
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Account, RpcProvider } from "starknet";
import { Devnet } from "starknet-devnet";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { packFelts } from "@strk20-messaging/sdk";

const RUN = process.env.RUN_DEVNET_E2E === "1";
const CHANNEL_KEY = "0x29f111f2674fda971bbee26106be4792a4336860bea7f3c4289d9c8dc16a948";
const CLI = join(import.meta.dirname, "../dist/index.js");
const CONTRACTS = join(import.meta.dirname, "../../../contracts/target/dev");

let devnet: Devnet | undefined;
let provider: RpcProvider;
let alice: { address: string; privateKey: string };
let bob: { address: string; privateKey: string };
let helperAddress: string;
let sendTxHash = "";

function msgCli(home: string, pk: string, args: string[]): string {
  return execFileSync("node", [CLI, ...args], {
    env: { ...process.env, STRK20_MSG_HOME: home, STRK20_MSG_PRIVATE_KEY: pk },
    encoding: "utf8",
  });
}

describe.skipIf(!RUN)("M3 first message end to end (devnet, direct mode)", () => {
  beforeAll(async () => {
    // Version must match the pool repo's CI pin (v0.8.0-rc.3): it is the one
    // known to compile Sierra 1.8 (Cairo 2.17) classes. `spawnInstalled` uses
    // the starknet-devnet binary on PATH.
    devnet = await Devnet.spawnInstalled({ keepAlive: false });
    const url = devnet.provider.url;
    provider = new RpcProvider({ nodeUrl: url });

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "devnet_getPredeployedAccounts" }),
    });
    const accounts = (await res.json()).result as { address: string; private_key: string }[];
    alice = { address: accounts[0].address, privateKey: accounts[0].private_key };
    bob = { address: accounts[1].address, privateKey: accounts[1].private_key };

    // Declare + deploy the M2 contract with pool = alice (direct dev mode).
    const deployer = new Account({ provider, address: alice.address, signer: alice.privateKey });
    const contract = JSON.parse(
      readFileSync(join(CONTRACTS, "message_anonymizer_MessageAnonymizer.contract_class.json"), "utf8")
    );
    const casm = JSON.parse(
      readFileSync(
        join(CONTRACTS, "message_anonymizer_MessageAnonymizer.compiled_contract_class.json"),
        "utf8"
      )
    );
    const declared = await deployer.declareAndDeploy(
      { contract, casm, constructorCalldata: [alice.address] },
      { tip: 0n }
    );
    helperAddress = declared.deploy.contract_address;
  }, 300_000);

  afterAll(async () => {
    devnet?.kill();
  });

  it("machine A sends, machine B reads", { timeout: 120_000 }, () => {
    const homeA = mkdtempSync(join(tmpdir(), "msg-a-"));
    const homeB = mkdtempSync(join(tmpdir(), "msg-b-"));
    const url = devnet!.provider.url;

    // machine A (alice)
    msgCli(homeA, alice.privateKey, [
      "init", "--rpc", url, "--helper", helperAddress, "--account", alice.address, "--mode", "direct",
    ]);
    msgCli(homeA, alice.privateKey, [
      "channel", "add", "--label", "bob", "--peer", bob.address, "--key", CHANNEL_KEY,
    ]);
    const sendOut = msgCli(homeA, alice.privateKey, ["send", "--to", "bob", "hello"]);
    expect(sendOut).toContain("submitted 0x");
    expect(sendOut).toContain("confirmed 0x");
    sendTxHash = sendOut.match(/confirmed (0x[0-9a-f]+)/)![1]!;

    // machine B (bob) — no shared local state beyond the provisioned channel key
    msgCli(homeB, bob.privateKey, [
      "init", "--rpc", url, "--helper", helperAddress, "--account", bob.address, "--mode", "direct",
    ]);
    msgCli(homeB, bob.privateKey, [
      "channel", "add", "--label", "alice", "--peer", alice.address, "--key", CHANNEL_KEY,
    ]);
    const readOut = msgCli(homeB, bob.privateKey, ["read"]);
    expect(readOut).toMatch(/\[1\] from 0x[0-9a-f]+ · \d+ (s|min) ago · "hello"/);
    expect(readOut).toContain(`from ${normalize(alice.address)}`);

    // idempotence: the cursor advanced, a second read finds nothing new
    expect(msgCli(homeB, bob.privateKey, ["read"])).toContain("no new messages");
  });

  it("observer sees no recipient and no plaintext in the transaction", { timeout: 30_000 }, async () => {
    const tx = (await provider.getTransaction(sendTxHash)) as { calldata?: string[] };
    const calldata = (tx.calldata ?? []).map((c) => BigInt(c));

    // the plaintext "hello" never appears, packed or raw
    const helloFelt = packFelts(new TextEncoder().encode("hello"))[0]!;
    expect(calldata).not.toContain(helloFelt);
    // the recipient's address never appears
    expect(calldata).not.toContain(BigInt(bob.address));
    // the helper address does (that much is public by design)
    expect(calldata).toContain(BigInt(helperAddress));
  });
});

function normalize(addr: string): string {
  return "0x" + BigInt(addr).toString(16);
}
