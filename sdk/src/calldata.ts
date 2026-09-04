import type { Sealed } from "./aead.js";

/**
 * Serde for the helper's `privacy_invoke(messages: Span<EncryptedMessage>)`:
 * [count, (msg_id, ct_len, ...ct_felts)*]. The pool passes invoke calldata
 * through verbatim, so direct mode and pool mode share this exactly.
 */
export function privacyInvokeCalldata(messages: Sealed[]): string[] {
  const out: string[] = [toHex(BigInt(messages.length))];
  for (const m of messages) {
    out.push(toHex(m.msgId), toHex(BigInt(m.felts.length)), ...m.felts.map(toHex));
  }
  return out;
}

/** Total calldata felts a batch produces — the proof/calldata size driver. */
export function calldataFeltCount(messages: Sealed[]): number {
  return 1 + messages.reduce((n, m) => n + 2 + m.felts.length, 0);
}

/**
 * Proof-size fallback: halve a batch, first half rounded up. The second half
 * goes back on the queue for the next (chained) transaction.
 */
export function splitBatch<T>(batch: T[]): [T[], T[]] {
  const cut = Math.ceil(batch.length / 2);
  return [batch.slice(0, cut), batch.slice(cut)];
}

function toHex(v: bigint): string {
  return "0x" + v.toString(16);
}
