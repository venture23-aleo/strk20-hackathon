import type { Sealed } from "@strk20-messaging/sdk";
import { CallData, type Account, type RpcProvider } from "starknet";
import type { CliConfig } from "./config.js";
import { privacyInvokeCalldata } from "./helper.js";
import { submitPool, type TailEvents } from "./tail.js";

/**
 * Pool-mode send: one proven STRK20 transaction carrying our InvokeExternal.
 *
 * Verified requirements (M0, from pool source):
 *   - an invoke-only action list is rejected with NO_REPLAY_PROTECTION; the
 *     transaction must carry one WriteOnce action. A zero-amount encrypted
 *     note is the sanctioned free carrier — here as transfer(self, 0n).
 *   - prove at head − 10 (notes mature 10 blocks)
 *   - at most one invoke-phase action per transaction
 *
 * NOT yet exercised against a live pool (needs the deployed pool address and a
 * funded, registered account) — first live run should watch the carrier step.
 */
export async function poolSend(
  cfg: CliConfig,
  account: Account,
  provider: RpcProvider,
  sealed: Sealed[],
  events: TailEvents & { onProving?: () => void } = {}
) {
  const poolCfg = cfg.pool;
  if (!poolCfg) throw new Error("mode is 'pool' but config.pool is missing");
  const { pathToFileURL } = await import("node:url");
  const sdk = (await import(
    pathToFileURL(`${poolCfg.sdkPath}/sdk/dist/index.js`).href
  )) as {
    createPrivateTransfers: (opts: Record<string, unknown>) => {
      build: (opts?: Record<string, unknown>) => unknown;
      invalidateProofNonceCache: () => void;
    };
  };

  const transfers = sdk.createPrivateTransfers({
    provider,
    account,
    poolAddress: poolCfg.poolAddress,
    ...(poolCfg.provingUrl ? { provingUrl: poolCfg.provingUrl } : {}),
  });

  const carrierToken = poolCfg.carrierToken;
  if (!carrierToken) throw new Error("config.pool.carrierToken is required for the carrier note");

  // Prove at head − 10: notes mature 10 blocks; proving at head risks reorgs.
  const provingBlockId = (await provider.getBlockNumber()) - 10;

  events.onProving?.();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const builder = (transfers.build({ autoSetup: true }) as any)
    // Replay-protection carrier: zero-amount enc note to self (free, unspendable).
    .with(carrierToken, (t: any) => t.transfer({ recipient: account.address, amount: 0n }))
    .invoke(() => ({
      contractAddress: cfg.helperAddress,
      calldata: CallData.compile(privacyInvokeCalldata(sealed)),
    }));
  const { callAndProof } = await builder.execute({ provingBlockId });
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return submitPool(account, provider, callAndProof, () => transfers.invalidateProofNonceCache(), events);
}
