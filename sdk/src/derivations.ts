import { poseidonHashMany } from "@scure/starknet";

/** The STARK field prime; every input to Poseidon must be below it. */
export const STARK_PRIME =
  0x800000000000011000000000000000000000000000000000000000000000001n;

/**
 * Cairo short-string encoding: UTF-8 bytes read big-endian, max 31 chars.
 * Matches the pool's own tag convention (`"CHANNEL_KEY_TAG:V1"` etc.).
 */
export function shortStringToFelt(s: string): bigint {
  if (s.length === 0 || s.length > 31) {
    throw new Error(`short string must be 1-31 chars, got ${s.length}`);
  }
  let v = 0n;
  for (const byte of new TextEncoder().encode(s)) {
    v = (v << 8n) | BigInt(byte);
  }
  return v;
}

/**
 * Domain tags for the messaging namespace. Distinct from every pool tag
 * (the pool uses `NOTE_ID_TAG:V1`, `CHANNEL_KEY_TAG:V1`, ... — verified in M0),
 * so a message slot can never collide with a note slot.
 */
export const MSG_ID_TAG = shortStringToFelt("STRK20_MSG_ID:V1");
export const MSG_KEY_TAG = shortStringToFelt("STRK20_MSG_KEY:V1");

/**
 * A viewing key or channel key passed as a hex string derives the wrong values
 * silently — the documented footgun. Enforce bigint at the boundary.
 */
function assertFelt(name: string, v: bigint): void {
  if (typeof v !== "bigint") {
    throw new TypeError(`${name} must be a bigint, got ${typeof v}`);
  }
  if (v < 0n || v >= STARK_PRIME) {
    throw new RangeError(`${name} out of felt252 range`);
  }
}

function assertIndex(index: number | bigint): bigint {
  const i = BigInt(index);
  if (i < 0n || (typeof index === "number" && !Number.isInteger(index))) {
    throw new RangeError(`index must be a non-negative integer, got ${index}`);
  }
  return i;
}

/** `msg_id = h(MSG_ID_TAG, channel_key, index)` — the helper storage slot. */
export function msgId(channelKey: bigint, index: number | bigint): bigint {
  assertFelt("channelKey", channelKey);
  return poseidonHashMany([MSG_ID_TAG, channelKey, assertIndex(index)]);
}

/** `key_i = h(MSG_KEY_TAG, channel_key, index)` — the per-message AEAD key. */
export function msgKey(channelKey: bigint, index: number | bigint): bigint {
  assertFelt("channelKey", channelKey);
  return poseidonHashMany([MSG_KEY_TAG, channelKey, assertIndex(index)]);
}

/** Big-endian 32-byte encoding of a felt, for AEAD key and AAD material. */
export function feltToBytes32(v: bigint): Uint8Array {
  assertFelt("felt", v);
  const out = new Uint8Array(32);
  let x = v;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}
