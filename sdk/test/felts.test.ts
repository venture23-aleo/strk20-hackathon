import { describe, expect, it } from "vitest";
import { packFelts, unpackFelts } from "../src/index.js";

const patterned = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 13 + 1) & 0xff);

describe("packFelts / unpackFelts", () => {
  it("round-trips every length through the boundaries and all ciphertext sizes", () => {
    const lengths = [
      ...Array.from({ length: 65 }, (_, i) => i), // 0..64 covers 31/32/62/63
      271, 272, 273, 1040, 4112,
    ];
    for (const n of lengths) {
      const bytes = patterned(n);
      const felts = packFelts(bytes);
      expect(felts.length).toBe(Math.ceil(n / 31));
      expect(unpackFelts(felts, n)).toEqual(bytes);
    }
  });

  it("every packed felt fits felt252 (< 2^248)", () => {
    for (const f of packFelts(Uint8Array.from({ length: 62 }, () => 0xff))) {
      expect(f < 1n << 248n).toBe(true);
    }
  });

  it("rejects a felt count that does not match the byte length", () => {
    expect(() => unpackFelts([1n, 2n], 31)).toThrow(RangeError);
    expect(() => unpackFelts([1n], 32)).toThrow(RangeError);
  });

  it("rejects a felt too large for its chunk", () => {
    // last chunk of a 32-byte payload is 1 byte; 256 does not fit
    expect(() => unpackFelts([0n, 256n], 32)).toThrow(RangeError);
    expect(() => unpackFelts([1n << 248n], 31)).toThrow(RangeError);
    expect(() => unpackFelts([-1n], 31)).toThrow(RangeError);
  });
});
