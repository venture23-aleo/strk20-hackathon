/**
 * Group messaging lanes. A group is one shared secret (the group key); every
 * member writes on their OWN lane, derived from the group key and their
 * address — single-writer lanes, so concurrent members never race for slots —
 * and reads everyone else's. Each lane is an ordinary channel key: seal/open,
 * the slot walk, and the helper are all unchanged.
 *
 * Trust model (state it, don't hide it): all members share the group key, so
 * lane keys are computable by every member — sender attribution is cooperative
 * within the group, exactly like the pairwise scheme's shared-secret MAC. A
 * member who leaves keeps the key: removing someone means a new group.
 */
import { poseidonHashMany } from "@scure/starknet";
import { STARK_PRIME, shortStringToFelt } from "./derivations.js";

export const GROUP_LANE_TAG = shortStringToFelt("STRK20_GROUP_LANE:V1");

/** The channel key of `member`'s write lane in the group. */
export function groupLaneKey(groupKey: bigint, member: bigint): bigint {
  if (typeof groupKey !== "bigint" || typeof member !== "bigint") {
    throw new TypeError("groupKey and member must be bigints");
  }
  if (groupKey <= 0n || groupKey >= STARK_PRIME || member <= 0n || member >= STARK_PRIME) {
    throw new RangeError("groupKey and member must be nonzero felt252 values");
  }
  return poseidonHashMany([GROUP_LANE_TAG, groupKey, member]);
}
