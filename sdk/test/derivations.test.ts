import { describe, expect, it } from "vitest";
import {
  MSG_ID_TAG,
  MSG_KEY_TAG,
  STARK_PRIME,
  feltToBytes32,
  msgId,
  msgKey,
  shortStringToFelt,
} from "../src/index.js";

describe("domain tags", () => {
  it("are distinct from each other and from every pool tag namespace", () => {
    const poolTags = [
      "CHANNEL_KEY_TAG:V1",
      "CHANNEL_MARKER_TAG:V1",
      "NOTE_ID_TAG:V1",
      "NULLIFIER_TAG:V1",
    ].map(shortStringToFelt);
    const all = new Set([MSG_ID_TAG, MSG_KEY_TAG, ...poolTags]);
    expect(all.size).toBe(2 + poolTags.length);
  });

  it("encode as Cairo short strings", () => {
    expect(shortStringToFelt("ab")).toBe(0x6162n);
    expect(() => shortStringToFelt("")).toThrow();
    expect(() => shortStringToFelt("x".repeat(32))).toThrow();
  });
});

describe("msgId / msgKey", () => {
  const ck = 0x29f111f2674fda971bbee26106be4792a4336860bea7f3c4289d9c8dc16a948n;

  it("key_i is unique per (channel, index) — the all-zero nonce depends on this", () => {
    const channels = [ck, ck + 1n, 0x1n];
    const seen = new Set<bigint>();
    for (const c of channels) {
      for (let i = 0; i < 200; i++) {
        seen.add(msgKey(c, i));
      }
    }
    expect(seen.size).toBe(channels.length * 200);
  });

  it("msg_id and msg_key never collide with each other", () => {
    const ids = new Set<bigint>();
    for (let i = 0; i < 200; i++) {
      ids.add(msgId(ck, i));
      ids.add(msgKey(ck, i));
    }
    expect(ids.size).toBe(400);
  });

  it("accepts bigint indices", () => {
    expect(msgId(ck, 5n)).toBe(msgId(ck, 5));
  });

  it("rejects a hex-string channel key — the documented footgun", () => {
    // @ts-expect-error deliberate misuse
    expect(() => msgId("0x123", 0)).toThrow(TypeError);
    // @ts-expect-error deliberate misuse
    expect(() => msgKey("0x123", 0)).toThrow(TypeError);
  });

  it("rejects out-of-range inputs", () => {
    expect(() => msgId(STARK_PRIME, 0)).toThrow(RangeError);
    expect(() => msgId(-1n, 0)).toThrow(RangeError);
    expect(() => msgId(1n, -1)).toThrow(RangeError);
    expect(() => msgId(1n, 1.5)).toThrow(RangeError);
  });
});

describe("feltToBytes32", () => {
  it("is big-endian and 32 bytes", () => {
    const b = feltToBytes32(0x0102n);
    expect(b.length).toBe(32);
    expect(b[30]).toBe(1);
    expect(b[31]).toBe(2);
    expect(b.slice(0, 30).every((x) => x === 0)).toBe(true);
  });
});
