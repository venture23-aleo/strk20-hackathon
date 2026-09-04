/**
 * Every frozen vector reproduces byte-for-byte. channel_key/note_id vectors were
 * generated FROM the Privacy SDK (commit in _meta.source); reproducing them here
 * proves our Poseidon + short-string-tag machinery matches the pool's, which is
 * the silent-divergence risk called out in 04-cryptography.md §6.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { poseidonHashMany } from "@scure/starknet";
import { msgId, msgKey, packFelts, seal, open, shortStringToFelt } from "../src/index.js";

const vectors = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../vectors/derivations.json"), "utf8")
);
const b64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

describe("frozen vectors", () => {
  it("channel_key — our primitives reproduce the Privacy SDK's derivation", () => {
    for (const v of vectors.channel_key) {
      const got = poseidonHashMany([
        shortStringToFelt("CHANNEL_KEY_TAG:V1"),
        BigInt(v.sender),
        BigInt(v.sender_sk),
        BigInt(v.recipient),
        BigInt(v.recipient_pk),
      ]);
      expect("0x" + got.toString(16)).toBe(v.expected);
    }
  });

  it("note_id — our primitives reproduce the Privacy SDK's derivation", () => {
    for (const v of vectors.note_id) {
      const got = poseidonHashMany([
        shortStringToFelt("NOTE_ID_TAG:V1"),
        BigInt(v.channel_key),
        BigInt(v.token),
        BigInt(v.index),
        0n,
      ]);
      expect("0x" + got.toString(16)).toBe(v.expected);
    }
  });

  it("msg_id", () => {
    for (const v of vectors.msg_id) {
      expect("0x" + msgId(BigInt(v.channel_key), v.index).toString(16)).toBe(v.expected);
    }
  });

  it("msg_key", () => {
    for (const v of vectors.msg_key) {
      expect("0x" + msgKey(BigInt(v.channel_key), v.index).toString(16)).toBe(v.expected);
    }
  });

  it("packing", () => {
    for (const v of vectors.packing) {
      expect(packFelts(b64(v.bytes_base64)).map((f) => "0x" + f.toString(16))).toEqual(
        v.expected_felts
      );
    }
  });

  it("sealed — seal reproduces the frozen ciphertext felts, and open recovers the body", () => {
    for (const v of vectors.sealed) {
      const s = seal({
        channelKey: BigInt(v.channel_key),
        index: v.index,
        sender: BigInt(v.sender),
        timestamp: BigInt(v.timestamp),
        body: b64(v.body_base64),
      });
      expect(s.bucket).toBe(v.bucket);
      expect("0x" + s.msgId.toString(16)).toBe(v.msg_id);
      expect(s.felts.map((f) => "0x" + f.toString(16))).toEqual(v.felts);

      const opened = open(BigInt(v.channel_key), v.index, v.felts.map(BigInt));
      expect(Buffer.from(opened.body).toString("base64")).toBe(v.body_base64);
      expect(opened.sender).toBe(BigInt(v.sender));
      expect(opened.timestamp).toBe(BigInt(v.timestamp));
    }
  });
});
