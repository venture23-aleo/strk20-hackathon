import { describe, expect, it, vi } from "vitest";
import { discoveryOptions } from "../src/channels.js";

describe("discoveryOptions — OHTTP is the default, not an option", () => {
  it("enables ohttp when unspecified", () => {
    expect(discoveryOptions({ discoveryUrl: "https://d.example" })).toEqual({
      url: "https://d.example",
      ohttp: true,
    });
  });

  it("passes through an ohttp relay config", () => {
    expect(
      discoveryOptions({ discoveryUrl: "https://d.example", ohttp: { relayUrl: "https://r" } })
    ).toEqual({ url: "https://d.example", ohttp: { relayUrl: "https://r" } });
  });

  it("honors an explicit opt-out, loudly", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(discoveryOptions({ discoveryUrl: "https://d.example", ohttp: false }).ohttp).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/OHTTP disabled/));
    warn.mockRestore();
  });
});
