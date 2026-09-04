import { msgId, open, type Frame } from "@strk20-messaging/sdk";
import type { HelperClient } from "./helper.js";

export interface FoundMessage {
  index: number;
  frame: Frame;
}

/**
 * The slot-walk discovery loop (06-sdk.md): dense sequential indices, stop at
 * the first empty slot. Lengths are fetched in batched windows via `slot_lens`
 * — one RPC round trip per WINDOW indices instead of one per index.
 */
export async function walkChannel(
  helper: HelperClient,
  channelKey: bigint,
  startIndex = 0,
  window = 16
): Promise<{ messages: FoundMessage[]; nextIndex: number }> {
  const messages: FoundMessage[] = [];
  let i = startIndex;
  for (;;) {
    const indices = Array.from({ length: window }, (_, k) => i + k);
    const lens = await helper.slotLens(indices.map((k) => msgId(channelKey, k)));
    let sawEmpty = false;
    for (let k = 0; k < indices.length; k++) {
      if (lens[k] === 0) {
        sawEmpty = true;
        i = indices[k]!;
        break;
      }
      const felts = await helper.slots(msgId(channelKey, indices[k]!));
      messages.push({ index: indices[k]!, frame: open(channelKey, indices[k]!, felts) });
    }
    if (sawEmpty) break;
    i += window;
  }
  return { messages, nextIndex: i };
}

/** First free index on a channel — where the next send lands. */
export async function nextFreeIndex(
  helper: HelperClient,
  channelKey: bigint,
  startIndex = 0
): Promise<number> {
  const { nextIndex } = await walkFree(helper, channelKey, startIndex);
  return nextIndex;
}

async function walkFree(helper: HelperClient, channelKey: bigint, startIndex: number) {
  let i = startIndex;
  for (;;) {
    const indices = Array.from({ length: 16 }, (_, k) => i + k);
    const lens = await helper.slotLens(indices.map((k) => msgId(channelKey, k)));
    const empty = lens.findIndex((l) => l === 0);
    if (empty >= 0) return { nextIndex: i + empty };
    i += 16;
  }
}
