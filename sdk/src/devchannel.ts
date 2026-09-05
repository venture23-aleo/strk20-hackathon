/**
 * Dev-mode pair lanes: deterministic directional channel keys derived from the
 * two parties' addresses alone, so both sides pair by simply adding each
 * other's address — no invite exchange.
 *
 * NOT confidential against an observer who guesses the pair: anyone knowing
 * both addresses can derive these keys and read the lane. That is an explicit
 * dev/direct-mode trade-off (where the submitter is public anyway). Invites
 * carry random keys and stay confidential; pool mode derives channel keys from
 * the registry's ECDH instead and never uses this.
 */
import { poseidonHashMany } from "@scure/starknet";
import { STARK_PRIME, shortStringToFelt } from "./derivations.js";

export const DEV_CHANNEL_TAG = shortStringToFelt("STRK20_DEV_CHAN:V1");

/** Channel key of the sender→recipient lane. Directional: swap args for the reply lane. */
export function devPairLane(sender: bigint, recipient: bigint): bigint {
  if (typeof sender !== "bigint" || typeof recipient !== "bigint") {
    throw new TypeError("sender and recipient must be bigints");
  }
  for (const v of [sender, recipient]) {
    if (v <= 0n || v >= STARK_PRIME) throw new RangeError("addresses must be nonzero felt252 values");
  }
  if (sender === recipient) throw new RangeError("a pair lane needs two distinct addresses");
  return poseidonHashMany([DEV_CHANNEL_TAG, sender, recipient]);
}
