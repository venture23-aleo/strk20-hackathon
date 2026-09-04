import type { RpcProvider } from "starknet";

export { privacyInvokeCalldata } from "@strk20-messaging/sdk";

/**
 * Read client for the message_anonymizer helper, and the calldata builder for
 * its `privacy_invoke` entry point.
 */
export class HelperClient {
  constructor(
    private readonly provider: RpcProvider,
    readonly address: string
  ) {}

  /** Batched: lengths for many msg_ids in one RPC round trip. */
  async slotLens(msgIds: bigint[]): Promise<number[]> {
    const res = await this.provider.callContract({
      contractAddress: this.address,
      entrypoint: "slot_lens",
      calldata: [toHex(BigInt(msgIds.length)), ...msgIds.map(toHex)],
    });
    return parseSpan(res).map((v) => Number(v));
  }

  /** Whole ciphertext for one msg_id. */
  async slots(msgId: bigint): Promise<bigint[]> {
    const res = await this.provider.callContract({
      contractAddress: this.address,
      entrypoint: "slots",
      calldata: [toHex(msgId)],
    });
    return parseSpan(res);
  }

  async pool(): Promise<bigint> {
    const res = await this.provider.callContract({
      contractAddress: this.address,
      entrypoint: "pool",
      calldata: [],
    });
    return BigInt(res[0]!);
  }
}

function toHex(v: bigint): string {
  return "0x" + v.toString(16);
}

/** Cairo `Span<T>` return data: leading length, then the elements. */
function parseSpan(res: string[]): bigint[] {
  const n = Number(BigInt(res[0]!));
  const out = res.slice(1, 1 + n).map(BigInt);
  if (out.length !== n) throw new Error(`malformed span: declared ${n}, got ${out.length}`);
  return out;
}
