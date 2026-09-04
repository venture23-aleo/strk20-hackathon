/**
 * Authenticated encryption for message bodies: ChaCha20-Poly1305.
 *
 *   key   = key_i = h(MSG_KEY_TAG, channel_key, index)   — unique per message
 *   nonce = 12 zero bytes                                 — safe ONLY because key_i is unique;
 *                                                           asserted by tests, not trusted
 *   AAD   = msg_id                                        — a ciphertext cannot be replayed
 *                                                           into another slot
 */

import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { feltToBytes32, msgId, msgKey } from "./derivations.js";
import { packFelts, unpackFelts } from "./felts.js";
import { frame, unframe, bucketFor, type Bucket, type Frame } from "./framing.js";

const NONCE = new Uint8Array(12);
const TAG_LEN = 16;

/** Ciphertext length for each bucket (bucket + Poly1305 tag). */
const CT_LEN: Record<Bucket, number> = { 256: 272, 1024: 1040, 4096: 4112 };
/** Inverse map: felt count -> ciphertext length. Counts are distinct (9/34/133). */
const CT_LEN_BY_FELTS = new Map<number, number>(
  (Object.values(CT_LEN) as number[]).map((n) => [Math.ceil(n / 31), n])
);

export interface SealInput {
  channelKey: bigint;
  index: number | bigint;
  /** Sender's Starknet address, authenticated inside the ciphertext. */
  sender: bigint;
  /** Unix seconds. */
  timestamp: bigint;
  body: Uint8Array;
  /** Force a padding tier; default is the smallest that fits. */
  padTo?: Bucket;
}

export interface Sealed {
  msgId: bigint;
  bucket: Bucket;
  ciphertext: Uint8Array;
  /** 31-byte-packed ciphertext, ready for the helper's calldata. */
  felts: bigint[];
}

export function seal(input: SealInput): Sealed {
  const { channelKey, index, sender, timestamp, body, padTo } = input;
  const bucket = bucketFor(body.length, padTo);
  const id = msgId(channelKey, index);
  const key = feltToBytes32(msgKey(channelKey, index));
  const plaintext = frame(sender, timestamp, body, bucket);
  const ciphertext = chacha20poly1305(key, NONCE, feltToBytes32(id)).encrypt(plaintext);
  key.fill(0);
  return { msgId: id, bucket, ciphertext, felts: packFelts(ciphertext) };
}

/**
 * Decrypt and authenticate the felts read from slot (channel_key, index).
 * Throws on a bad tag — including a valid ciphertext replayed from another slot,
 * since both the key and the AAD are slot-specific.
 */
export function open(channelKey: bigint, index: number | bigint, felts: readonly bigint[]): Frame {
  const ctLen = CT_LEN_BY_FELTS.get(felts.length);
  if (ctLen === undefined) {
    throw new RangeError(`felt count ${felts.length} does not correspond to any padding bucket`);
  }
  const ciphertext = unpackFelts(felts, ctLen);
  return openCiphertext(channelKey, index, ciphertext);
}

export function openCiphertext(
  channelKey: bigint,
  index: number | bigint,
  ciphertext: Uint8Array
): Frame {
  const id = msgId(channelKey, index);
  const key = feltToBytes32(msgKey(channelKey, index));
  try {
    // noble's Poly1305 tag check is constant-time.
    const plaintext = chacha20poly1305(key, NONCE, feltToBytes32(id)).decrypt(ciphertext);
    return unframe(plaintext);
  } finally {
    key.fill(0);
  }
}

export { TAG_LEN, CT_LEN };
