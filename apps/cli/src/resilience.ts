import { splitBatch } from "@strk20-messaging/sdk";

/**
 * The M4 resilience loop, batch-generic and effect-injected so it is fully
 * unit-testable:
 *
 *   - `provingBlockId` (head − 10) is re-fetched on EVERY attempt — and since
 *     leftover halves are flushed as chained transactions through this same
 *     loop, also between chained transactions.
 *   - every failure invalidates the proof-nonce cache before anything is
 *     rebuilt; without it the retry loops on proofs the chain keeps rejecting.
 *   - a proof-size failure halves the batch instead of failing the send; the
 *     cut-off half is returned as `remaining` for the next transaction.
 *   - a slot conflict (concurrent writer took our index) re-seals via the
 *     caller-provided hook rather than resubmitting a doomed payload.
 */

export type FailureKind = "proof-size" | "slot-conflict" | "nonce" | "other";

export function classifyFailure(err: unknown): FailureKind {
  const msg = err instanceof Error ? err.message : String(err);
  if (/proof.{0,20}(size|too\s+large)|too\s+many\s+steps|exceeds.{0,20}(limit|size)/i.test(msg)) {
    return "proof-size";
  }
  if (/SLOT_OCCUPIED/.test(msg)) return "slot-conflict";
  if (/invalid.{0,5}nonce|nonce/i.test(msg)) return "nonce";
  return "other";
}

export interface ResilienceHooks<T> {
  fetchHead(): Promise<number>;
  submit(batch: T[], provingBlockId: number): Promise<{ txHash: string }>;
  invalidateProofNonceCache(): void;
  /** Re-derive indices/ciphertexts after a slot conflict. */
  reseal?(batch: T[]): Promise<T[]>;
  onRetry?(reason: FailureKind, attempt: number, batchSize: number): void;
}

export interface FlushOutcome<T> {
  txHash: string;
  sent: T[];
  /** Cut off by proof-size fallback — flush again as a chained transaction. */
  remaining: T[];
}

export async function submitWithResilience<T>(
  batch: T[],
  hooks: ResilienceHooks<T>,
  opts: { maxAttempts?: number; minBatch?: number } = {}
): Promise<FlushOutcome<T>> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const minBatch = opts.minBatch ?? 1;
  let current = batch;
  let remaining: T[] = [];

  for (let attempt = 1; ; attempt++) {
    // Prove at head − 10, freshly per attempt: notes mature 10 blocks, and a
    // stale block id causes intermittent failures and worse prover cache hits.
    const provingBlockId = (await hooks.fetchHead()) - 10;
    try {
      const { txHash } = await hooks.submit(current, provingBlockId);
      return { txHash, sent: current, remaining };
    } catch (err) {
      hooks.invalidateProofNonceCache();
      const kind = classifyFailure(err);
      if (attempt >= maxAttempts) throw err;
      hooks.onRetry?.(kind, attempt, current.length);

      if (kind === "proof-size" && current.length > minBatch) {
        const [head, tail] = splitBatch(current);
        current = head;
        remaining = [...tail, ...remaining];
      } else if (kind === "slot-conflict" && hooks.reseal) {
        current = await hooks.reseal(current);
      }
      // "nonce" and "other": the invalidation above is the fix; plain retry.
    }
  }
}
