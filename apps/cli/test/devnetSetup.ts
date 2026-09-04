import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Account, RpcProvider } from "starknet";
import { Devnet } from "starknet-devnet";

export interface DevnetCtx {
  devnet: Devnet;
  provider: RpcProvider;
  alice: { address: string; privateKey: string };
  bob: { address: string; privateKey: string };
  helperAddress: string;
}

const CONTRACTS = join(import.meta.dirname, "../../../contracts/target/dev");
/** Devnet's predeployed ETH ERC-20. */
export const ETH = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

/** Spawn devnet (binary from PATH, CI pin v0.8.0-rc.3) and deploy the M2 helper with pool = alice. */
export async function setupDevnet(): Promise<DevnetCtx> {
  const devnet = await Devnet.spawnInstalled({ keepAlive: false });
  const url = devnet.provider.url;
  const provider = new RpcProvider({ nodeUrl: url });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "devnet_getPredeployedAccounts" }),
  });
  const accounts = (await res.json()).result as { address: string; private_key: string }[];
  const alice = { address: accounts[0]!.address, privateKey: accounts[0]!.private_key };
  const bob = { address: accounts[1]!.address, privateKey: accounts[1]!.private_key };

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
  return { devnet, provider, alice, bob, helperAddress: declared.deploy.contract_address };
}

export async function erc20Balance(provider: RpcProvider, token: string, owner: string): Promise<bigint> {
  const res = await provider.callContract({
    contractAddress: token,
    entrypoint: "balanceOf",
    calldata: [owner],
  });
  return BigInt(res[0]!) + (BigInt(res[1] ?? "0x0") << 128n);
}
