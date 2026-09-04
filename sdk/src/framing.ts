/**
 * Plaintext layout before sealing (04-cryptography.md):
 *
 *   | version : 1 B | sender_addr : 32 B | timestamp : 8 B | len : 4 B | body | zero padding |
 *
 * padded to one of the fixed buckets so ciphertext length leaks only the tier.
 * All integers big-endian. `timestamp` is Unix seconds (u64).
 */

import { STARK_PRIME } from "./derivations.js";

export const VERSION = 1;
export const HEADER_LEN = 1 + 32 + 8 + 4;
export const BUCKETS = [256, 1024, 4096] as const;
export type Bucket = (typeof BUCKETS)[number];
export const MAX_BODY = 4096 - HEADER_LEN;

export interface Frame {
  version: number;
  /** Sender's Starknet address; authenticated to the recipient by the shared-key MAC. */
  sender: bigint;
  /** Unix seconds. */
  timestamp: bigint;
  body: Uint8Array;
}

/** Smallest bucket that fits `bodyLen` plus the header, or throws past 4 KiB. */
export function bucketFor(bodyLen: number, padTo?: Bucket): Bucket {
  const need = bodyLen + HEADER_LEN;
  if (padTo !== undefined) {
    if (!BUCKETS.includes(padTo)) throw new RangeError(`invalid bucket ${padTo}`);
    if (need > padTo) throw new RangeError(`body needs ${need} B, exceeds requested ${padTo} B bucket`);
    return padTo;
  }
  const bucket = BUCKETS.find((b) => need <= b);
  if (!bucket) {
    throw new RangeError(
      `message exceeds 4 KiB bucket (${bodyLen} B body); chunk it or store off-chain`
    );
  }
  return bucket;
}

export function frame(sender: bigint, timestamp: bigint, body: Uint8Array, padTo?: Bucket): Uint8Array {
  if (typeof sender !== "bigint" || sender < 0n || sender >= STARK_PRIME) {
    throw new RangeError("sender must be a felt252 bigint");
  }
  if (timestamp < 0n || timestamp >= 1n << 64n) {
    throw new RangeError("timestamp must fit u64");
  }
  const bucket = bucketFor(body.length, padTo);
  const out = new Uint8Array(bucket); // zero padding comes free
  const view = new DataView(out.buffer);
  out[0] = VERSION;
  let s = sender;
  for (let i = 32; i >= 1; i--) {
    out[i] = Number(s & 0xffn);
    s >>= 8n;
  }
  view.setBigUint64(33, timestamp);
  view.setUint32(41, body.length);
  out.set(body, HEADER_LEN);
  return out;
}

export function unframe(padded: Uint8Array): Frame {
  if (!(BUCKETS as readonly number[]).includes(padded.length)) {
    throw new RangeError(`padded frame length ${padded.length} is not a bucket size`);
  }
  const version = padded[0]!;
  if (version !== VERSION) {
    throw new RangeError(`unsupported frame version ${version}`);
  }
  let sender = 0n;
  for (let i = 1; i <= 32; i++) sender = (sender << 8n) | BigInt(padded[i]!);
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  const timestamp = view.getBigUint64(33);
  const len = view.getUint32(41);
  if (HEADER_LEN + len > padded.length) {
    throw new RangeError(`frame len ${len} exceeds bucket ${padded.length}`);
  }
  // Zero padding is authenticated by the AEAD tag; a nonzero byte here means an
  // encoding bug on the sender side, not tampering. Reject it loudly either way.
  for (let i = HEADER_LEN + len; i < padded.length; i++) {
    if (padded[i] !== 0) throw new RangeError("nonzero padding byte");
  }
  return { version, sender, timestamp, body: padded.slice(HEADER_LEN, HEADER_LEN + len) };
}
