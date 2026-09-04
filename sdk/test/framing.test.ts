import { describe, expect, it } from "vitest";
import { BUCKETS, HEADER_LEN, VERSION, bucketFor, frame, unframe } from "../src/index.js";

const sender = 0xa11cen;
const ts = 1756944000n;
const body = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i % 251) + 1);

describe("bucketFor", () => {
  it("picks the smallest bucket, with exact boundaries at bucket - header", () => {
    expect(bucketFor(0)).toBe(256);
    expect(bucketFor(256 - HEADER_LEN)).toBe(256);
    expect(bucketFor(256 - HEADER_LEN + 1)).toBe(1024);
    expect(bucketFor(1024 - HEADER_LEN)).toBe(1024);
    expect(bucketFor(1024 - HEADER_LEN + 1)).toBe(4096);
    expect(bucketFor(4096 - HEADER_LEN)).toBe(4096);
    expect(() => bucketFor(4096 - HEADER_LEN + 1)).toThrow(/4 KiB/);
  });

  it("honors padTo and rejects one that is too small or not a bucket", () => {
    expect(bucketFor(0, 4096)).toBe(4096);
    expect(() => bucketFor(300, 256)).toThrow(RangeError);
    // @ts-expect-error deliberate misuse
    expect(() => bucketFor(0, 512)).toThrow(RangeError);
  });
});

describe("frame / unframe", () => {
  it("round-trips at every bucket boundary", () => {
    for (const n of [0, 1, 211, 212, 979, 980, 4051]) {
      const f = frame(sender, ts, body(n));
      expect((BUCKETS as readonly number[]).includes(f.length)).toBe(true);
      const parsed = unframe(f);
      expect(parsed.version).toBe(VERSION);
      expect(parsed.sender).toBe(sender);
      expect(parsed.timestamp).toBe(ts);
      expect(parsed.body).toEqual(body(n));
    }
  });

  it("rejects a wrong version, oversize len field, nonzero padding, and non-bucket lengths", () => {
    const f = frame(sender, ts, body(5));
    const wrongVersion = f.slice();
    wrongVersion[0] = 2;
    expect(() => unframe(wrongVersion)).toThrow(/version/);

    const badLen = f.slice();
    new DataView(badLen.buffer).setUint32(41, 5000);
    expect(() => unframe(badLen)).toThrow(/exceeds bucket/);

    const dirtyPad = f.slice();
    dirtyPad[dirtyPad.length - 1] = 1;
    expect(() => unframe(dirtyPad)).toThrow(/padding/);

    expect(() => unframe(f.slice(0, 200))).toThrow(/bucket size/);
  });

  it("rejects out-of-range sender and timestamp", () => {
    expect(() => frame(-1n, ts, body(1))).toThrow(RangeError);
    expect(() => frame(sender, 1n << 64n, body(1))).toThrow(RangeError);
    expect(() => frame(sender, -1n, body(1))).toThrow(RangeError);
  });
});
