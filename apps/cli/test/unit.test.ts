import { seal } from "@strk20-messaging/sdk";
import { describe, expect, it } from "vitest";
import { formatAge } from "../src/commands.js";
import { privacyInvokeCalldata } from "../src/helper.js";

describe("privacyInvokeCalldata", () => {
  it("serializes Span<EncryptedMessage> as [count, (id, len, felts)*]", () => {
    const s = seal({
      channelKey: 0x123n,
      index: 0,
      sender: 0xa11cen,
      timestamp: 0n,
      body: new TextEncoder().encode("hi"),
    });
    const calldata = privacyInvokeCalldata([s, s]);
    expect(calldata[0]).toBe("0x2");
    expect(calldata[1]).toBe("0x" + s.msgId.toString(16));
    expect(calldata[2]).toBe("0x" + BigInt(s.felts.length).toString(16));
    expect(calldata.length).toBe(1 + 2 * (2 + s.felts.length));
  });
});

describe("formatAge", () => {
  it("renders human ages", () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    expect(formatAge(now)).toMatch(/^\d+ s ago$/);
    expect(formatAge(now - 120n)).toBe("2 min ago");
    expect(formatAge(now - 7200n)).toBe("2 h ago");
  });
});
