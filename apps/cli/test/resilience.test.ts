/**
 * M4 exit criterion: "a forced submission failure recovers cleanly instead of
 * looping on a rejected proof." Every scenario forces failures through mocked
 * hooks and asserts the recovery discipline:
 *   - proof-nonce cache invalidated after EVERY failure
 *   - provingBlockId re-fetched (head − 10) on EVERY attempt
 *   - proof-size failures shrink the batch instead of retrying it verbatim
 *   - slot conflicts re-seal instead of resubmitting a doomed payload
 *   - a persistent failure throws after maxAttempts — no infinite loop
 */
import { describe, expect, it, vi } from "vitest";
import { classifyFailure, submitWithResilience } from "../src/resilience.js";

const batch8 = Array.from({ length: 8 }, (_, i) => `m${i}`);

function hooks(overrides: Partial<Parameters<typeof submitWithResilience>[1]> = {}) {
  let head = 100;
  return {
    fetchHead: vi.fn(async () => ++head),
    submit: vi.fn(async () => ({ txHash: "0x1" })),
    invalidateProofNonceCache: vi.fn(),
    ...overrides,
  };
}

describe("classifyFailure", () => {
  it("recognizes the failure families", () => {
    expect(classifyFailure(new Error("proof size exceeds limit"))).toBe("proof-size");
    expect(classifyFailure(new Error("Proof too large for batch"))).toBe("proof-size");
    expect(classifyFailure(new Error("execution reverted: SLOT_OCCUPIED"))).toBe("slot-conflict");
    expect(classifyFailure(new Error("Invalid transaction nonce"))).toBe("nonce");
    expect(classifyFailure(new Error("connection reset"))).toBe("other");
  });
});

describe("submitWithResilience", () => {
  it("succeeds first try: one submit, fresh provingBlockId, no invalidation", async () => {
    const h = hooks();
    const out = await submitWithResilience(batch8, h);
    expect(out.sent).toEqual(batch8);
    expect(out.remaining).toEqual([]);
    expect(h.submit).toHaveBeenCalledTimes(1);
    expect(h.submit).toHaveBeenCalledWith(batch8, 101 - 10);
    expect(h.invalidateProofNonceCache).not.toHaveBeenCalled();
  });

  it("proof-size failure halves the batch and returns the rest as remaining", async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new Error("proof size exceeds limit"))
      .mockResolvedValue({ txHash: "0x2" });
    const h = hooks({ submit });
    const out = await submitWithResilience(batch8, h);
    expect(out.sent).toEqual(batch8.slice(0, 4));
    expect(out.remaining).toEqual(batch8.slice(4));
    expect(h.invalidateProofNonceCache).toHaveBeenCalledTimes(1);
    // provingBlockId re-fetched per attempt: two different values
    expect(submit.mock.calls[0]![1]).toBe(91);
    expect(submit.mock.calls[1]![1]).toBe(92);
  });

  it("keeps halving under repeated proof-size failures down to minBatch", async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new Error("proof too large"))
      .mockRejectedValueOnce(new Error("proof too large"))
      .mockResolvedValue({ txHash: "0x3" });
    const h = hooks({ submit });
    const out = await submitWithResilience(batch8, h);
    expect(out.sent).toEqual(batch8.slice(0, 2));
    expect(out.remaining).toEqual(batch8.slice(2));
    expect(h.invalidateProofNonceCache).toHaveBeenCalledTimes(2);
  });

  it("nonce failure invalidates and retries the SAME batch — and stops at maxAttempts", async () => {
    const submit = vi.fn().mockRejectedValue(new Error("Invalid transaction nonce"));
    const h = hooks({ submit });
    await expect(submitWithResilience(batch8, h, { maxAttempts: 3 })).rejects.toThrow(/nonce/i);
    expect(submit).toHaveBeenCalledTimes(3); // bounded — no loop on rejected proofs
    expect(h.invalidateProofNonceCache).toHaveBeenCalledTimes(3);
    // same batch each time, fresh provingBlockId each time
    for (const call of submit.mock.calls) expect(call[0]).toEqual(batch8);
    expect(new Set(submit.mock.calls.map((c) => c[1])).size).toBe(3);
  });

  it("slot conflict re-seals through the hook instead of resubmitting", async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new Error("execution reverted: SLOT_OCCUPIED"))
      .mockResolvedValue({ txHash: "0x4" });
    const reseal = vi.fn(async (b: string[]) => b.map((x) => `${x}'`));
    const h = hooks({ submit, reseal });
    const out = await submitWithResilience(batch8, h);
    expect(reseal).toHaveBeenCalledOnce();
    expect(out.sent).toEqual(batch8.map((x) => `${x}'`));
  });
});
