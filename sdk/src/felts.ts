/**
 * Byte <-> felt252 packing: 31 bytes per felt, little-endian within each chunk.
 * The convention is shared with the Cairo side via vectors/derivations.json.
 */

const CHUNK = 31;

export function packFelts(bytes: Uint8Array): bigint[] {
  const out: bigint[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    let v = 0n;
    for (let j = chunk.length - 1; j >= 0; j--) {
      v = (v << 8n) | BigInt(chunk[j]!);
    }
    out.push(v);
  }
  return out;
}

export function unpackFelts(felts: readonly bigint[], byteLength: number): Uint8Array {
  const expected = Math.ceil(byteLength / CHUNK);
  if (felts.length !== expected) {
    throw new RangeError(
      `felt count ${felts.length} does not match byte length ${byteLength} (expected ${expected} felts)`
    );
  }
  const out = new Uint8Array(byteLength);
  for (let i = 0; i < felts.length; i++) {
    const chunkLen = Math.min(CHUNK, byteLength - i * CHUNK);
    let v = felts[i]!;
    if (v < 0n || v >= 1n << (8n * BigInt(chunkLen))) {
      throw new RangeError(`felt ${i} does not fit its ${chunkLen}-byte chunk`);
    }
    for (let j = 0; j < chunkLen; j++) {
      out[i * CHUNK + j] = Number(v & 0xffn);
      v >>= 8n;
    }
  }
  return out;
}
