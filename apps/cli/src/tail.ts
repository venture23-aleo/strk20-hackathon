import type { Account, Call, RpcProvider } from "starknet";

/**
 * THE submission tail — written once, never hand-written elsewhere
 * (11-implementation.md). Every documented footgun lives here:
 *   - `tip: 0n` is mandatory on v3 transactions
 *   - `proofFacts` must be OMITTED when absent, never passed as []
 *   - on any failure, invalidate the proof-nonce cache before rebuilding,
 *     or the retry loops on proofs the chain keeps rejecting
 */

export interface CallAndProof {
  call: Call | Call[];
  proof: { data?: unknown; proofFacts?: unknown[] };
}

export interface TailEvents {
  onSubmitted?: (txHash: string) => void;
}

export async function submitDirect(
  account: Account,
  provider: RpcProvider,
  calls: Call[],
  events: TailEvents = {}
) {
  const tx = await account.execute(calls, { tip: 0n });
  events.onSubmitted?.(tx.transaction_hash);
  return await awaitSuccess(provider, tx.transaction_hash);
}

export async function submitPool(
  account: Account,
  provider: RpcProvider,
  callAndProof: CallAndProof,
  invalidateProofNonceCache: () => void,
  events: TailEvents = {}
) {
  const proofDetails = callAndProof.proof.proofFacts?.length
    ? { proofFacts: callAndProof.proof.proofFacts, proof: callAndProof.proof.data }
    : {};
  try {
    const tx = await account.execute(callAndProof.call, {
      tip: 0n,
      ...proofDetails,
    } as Parameters<Account["execute"]>[1]);
    events.onSubmitted?.(tx.transaction_hash);
    return await awaitSuccess(provider, tx.transaction_hash);
  } catch (err) {
    invalidateProofNonceCache();
    throw err;
  }
}

async function awaitSuccess(provider: RpcProvider, txHash: string) {
  const receipt = await provider.waitForTransaction(txHash);
  const ok = (receipt as { isSuccess?: () => boolean }).isSuccess?.() ?? true;
  if (!ok) {
    const reason = (receipt as { revert_reason?: string }).revert_reason ?? "unknown";
    throw new Error(`transaction ${txHash} reverted: ${reason}`);
  }
  return { txHash, receipt };
}
