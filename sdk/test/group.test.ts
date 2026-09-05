import { describe, expect, it } from "vitest";
import {
  GROUP_LANE_TAG,
  MSG_ID_TAG,
  MSG_KEY_TAG,
  groupLaneKey,
  msgId,
  open,
  seal,
  shortStringToFelt,
} from "../src/index.js";

const GK = 0x5a0aa03c5d8649895810c86ed63b62d91895734e6d3ab2e80ada6f6fb400c84n;
const ALICE = 0xa11cen;
const BOB = 0xb0bn;
const CAROL = 0xca401n;

describe("devPairLane", () => {
  it("mirrors: A's out-lane to B is exactly B's in-lane from A", async () => {
    const { devPairLane } = await import("../src/index.js");
    const aOut = devPairLane(ALICE, BOB);
    const bIn = devPairLane(ALICE, BOB); // recomputed independently by B
    const bOut = devPairLane(BOB, ALICE);
    expect(aOut).toBe(bIn);
    expect(aOut).not.toBe(bOut); // directional
  });

  it("is domain-separated and rejects degenerate pairs", async () => {
    const { devPairLane, groupLaneKey } = await import("../src/index.js");
    expect(devPairLane(ALICE, BOB)).not.toBe(groupLaneKey(ALICE, BOB));
    expect(() => devPairLane(ALICE, ALICE)).toThrow(RangeError);
    expect(() => devPairLane(0n, BOB)).toThrow(RangeError);
  });
});

describe("groupLaneKey", () => {
  it("gives every member a distinct, deterministic lane", () => {
    const lanes = [ALICE, BOB, CAROL].map((m) => groupLaneKey(GK, m));
    expect(new Set(lanes).size).toBe(3);
    expect(groupLaneKey(GK, ALICE)).toBe(lanes[0]);
  });

  it("separates groups: same member, different group key, different lane", () => {
    expect(groupLaneKey(GK, ALICE)).not.toBe(groupLaneKey(GK + 1n, ALICE));
  });

  it("is domain-separated from every other tag namespace", () => {
    const tags = new Set([GROUP_LANE_TAG, MSG_ID_TAG, MSG_KEY_TAG, shortStringToFelt("CHANNEL_KEY_TAG:V1")]);
    expect(tags.size).toBe(4);
    // a lane never collides with a pairwise-style msg id on the same inputs
    expect(groupLaneKey(GK, 5n)).not.toBe(msgId(GK, 5));
  });

  it("lanes are full channel keys: seal/open round-trips on them", () => {
    const lane = groupLaneKey(GK, BOB);
    const s = seal({
      channelKey: lane,
      index: 0,
      sender: BOB,
      timestamp: 1000n,
      body: new TextEncoder().encode("from bob's lane"),
    });
    const f = open(lane, 0, s.felts);
    expect(new TextDecoder().decode(f.body)).toBe("from bob's lane");
    // another member's lane cannot open it — key and AAD are lane-bound
    expect(() => open(groupLaneKey(GK, CAROL), 0, s.felts)).toThrow();
  });

  it("rejects invalid inputs", () => {
    expect(() => groupLaneKey(0n, ALICE)).toThrow(RangeError);
    expect(() => groupLaneKey(GK, 0n)).toThrow(RangeError);
    // @ts-expect-error deliberate misuse
    expect(() => groupLaneKey("0x1", ALICE)).toThrow(TypeError);
  });
});
