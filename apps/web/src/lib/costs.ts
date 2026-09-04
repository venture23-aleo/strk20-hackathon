/**
 * Padding-tier preview and cost estimate (12-client-and-ui.md): the tier is
 * visible in the price, so show it — and warn near a boundary, otherwise
 * message length is an invisible cost cliff users discover by paying for it.
 */
import { BUCKETS, HEADER_LEN, type Bucket } from "@strk20-messaging/sdk";

export const MAX_BODY_BYTES = 4096 - HEADER_LEN;

/** Slots a message writes: ciphertext felts + length slot + carrier overhead (M0/S3 model). */
export function slotsFor(tier: Bucket): number {
  return Math.ceil((tier + 16) / 31) + 1 + 3;
}

/** Cost model inputs are configurable; defaults are the M0 mainnet measurements. */
export interface CostParams {
  strkPerSlot: number;
  usdPerStrk: number;
}
export const DEFAULT_COSTS: CostParams = { strkPerSlot: 0.0000042, usdPerStrk: 0.027 };

export interface TierPreview {
  bytes: number;
  tier: Bucket | null;
  usd: number | null;
  /** Set when within `warnWithin` bytes of the next tier boundary. */
  boundary?: { bytesLeft: number; nextTier: Bucket; extraUsd: number };
  /** Set when the body exceeds the 4 KiB ceiling. */
  overBy?: number;
}

export function tierPreview(
  text: string,
  costs: CostParams = DEFAULT_COSTS,
  warnWithin = 32
): TierPreview {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_BODY_BYTES) {
    return { bytes, tier: null, usd: null, overBy: bytes - MAX_BODY_BYTES };
  }
  const need = bytes + HEADER_LEN;
  const tier = BUCKETS.find((b) => need <= b)!;
  const usd = slotsFor(tier) * costs.strkPerSlot * costs.usdPerStrk;

  const next = BUCKETS[BUCKETS.indexOf(tier) + 1];
  const bytesLeft = tier - need;
  if (next !== undefined && bytesLeft < warnWithin) {
    const extraUsd = (slotsFor(next) - slotsFor(tier)) * costs.strkPerSlot * costs.usdPerStrk;
    return { bytes, tier, usd, boundary: { bytesLeft, nextTier: next, extraUsd } };
  }
  return { bytes, tier, usd };
}

/** The batch control line: count, time, cost, one transaction. */
export function batchPreview(
  tiers: Bucket[],
  provingSeconds: number,
  costs: CostParams = DEFAULT_COSTS
): { count: number; seconds: number; usd: number } {
  const usd = tiers.reduce((s, t) => s + slotsFor(t) * costs.strkPerSlot * costs.usdPerStrk, 0);
  return { count: tiers.length, seconds: provingSeconds, usd };
}

export function fmtUsd(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `<$0.01`;
  return `$${usd.toFixed(2)}`;
}
