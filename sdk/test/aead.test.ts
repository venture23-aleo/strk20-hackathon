import { describe, expect, it } from "vitest";
import { CT_LEN, HEADER_LEN, open, openCiphertext, seal } from "../src/index.js";

const ck = 0x29f111f2674fda971bbee26106be4792a4336860bea7f3c4289d9c8dc16a948n;
const sender = 0xa11cen;
const ts = 1756944000n;
const body = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 0xff);

describe("seal / open", () => {
  it("open(seal(x)) == x across all buckets and boundary lengths", () => {
    for (const n of [0, 1, 211, 212, 979, 980, 4051]) {
      for (const index of [0, 1, 999]) {
        const s = seal({ channelKey: ck, index, sender, timestamp: ts, body: body(n) });
        expect(s.ciphertext.length).toBe(CT_LEN[s.bucket]);
        const f = open(ck, index, s.felts);
        expect(f.body).toEqual(body(n));
        expect(f.sender).toBe(sender);
        expect(f.timestamp).toBe(ts);
      }
    }
  });

  it("is deterministic — same inputs, same ciphertext", () => {
    const a = seal({ channelKey: ck, index: 4, sender, timestamp: ts, body: body(10) });
    const b = seal({ channelKey: ck, index: 4, sender, timestamp: ts, body: body(10) });
    expect(a.ciphertext).toEqual(b.ciphertext);
    expect(a.felts).toEqual(b.felts);
  });

  it("detects tampering anywhere in the ciphertext", () => {
    const s = seal({ channelKey: ck, index: 0, sender, timestamp: ts, body: body(50) });
    for (const pos of [0, 100, s.ciphertext.length - 1]) {
      const t = s.ciphertext.slice();
      t[pos]! ^= 0x01;
      expect(() => openCiphertext(ck, 0, t)).toThrow();
    }
  });

  it("rejects a ciphertext replayed into another slot — key and AAD are both slot-bound", () => {
    const s = seal({ channelKey: ck, index: 0, sender, timestamp: ts, body: body(20) });
    expect(() => open(ck, 1, s.felts)).toThrow(); // different index
    expect(() => open(ck + 1n, 0, s.felts)).toThrow(); // different channel
  });

  it("rejects felt counts that match no bucket", () => {
    const s = seal({ channelKey: ck, index: 0, sender, timestamp: ts, body: body(5) });
    expect(() => open(ck, 0, s.felts.slice(1))).toThrow(/bucket/);
    expect(() => open(ck, 0, [...s.felts, 0n])).toThrow(/bucket/);
  });

  it("honors padTo for a larger tier", () => {
    const s = seal({ channelKey: ck, index: 0, sender, timestamp: ts, body: body(5), padTo: 1024 });
    expect(s.bucket).toBe(1024);
    expect(s.felts.length).toBe(34);
    expect(open(ck, 0, s.felts).body).toEqual(body(5));
  });

  it("ciphertext length only reveals the tier, not the body length", () => {
    const a = seal({ channelKey: ck, index: 0, sender, timestamp: ts, body: body(0) });
    const b = seal({ channelKey: ck, index: 1, sender, timestamp: ts, body: body(256 - HEADER_LEN) });
    expect(a.ciphertext.length).toBe(b.ciphertext.length);
  });
});
