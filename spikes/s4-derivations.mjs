// M0 / S4 — reproduce channel_key + note_id from the SDK, two independent ways,
// against the Cairo-generated reference fixture.
import { readFileSync } from "node:fs";
import { compute_channel_key, compute_note_id } from "./dist/testing/index.js";
import { poseidonHashMany } from "@scure/starknet";

const fix = JSON.parse(readFileSync("tests/fixtures/cairo-reference-data.json", "utf8"));
const inp = fix.inputs;
const expected = {
  channelKey: BigInt(fix.outputs?.channelKey ?? "0x29f111f2674fda971bbee26106be4792a4336860bea7f3c4289d9c8dc16a948"),
  noteId: BigInt(inp.noteId),
};

// Way 1: the SDK's own exported functions (via /testing subpath)
const sdkCk = compute_channel_key(BigInt(inp.sender), BigInt(inp.senderPrivateKey), BigInt(inp.recipient), BigInt(inp.recipientPublicKey));
const sdkNid = compute_note_id(BigInt(inp.channelKey), BigInt(inp.token), inp.index);

// Way 2: independent reimplementation — single poseidonHashMany over [tag, ...inputs],
// tag = Cairo short string (UTF-8 bytes, big-endian)
const tag = (s) => BigInt("0x" + Buffer.from(s, "utf8").toString("hex"));
const myCk = poseidonHashMany([tag("CHANNEL_KEY_TAG:V1"), BigInt(inp.sender), BigInt(inp.senderPrivateKey), BigInt(inp.recipient), BigInt(inp.recipientPublicKey)]);
const myNid = poseidonHashMany([tag("NOTE_ID_TAG:V1"), BigInt(inp.channelKey), BigInt(inp.token), BigInt(inp.index), 0n]);

const hex = (v) => "0x" + v.toString(16);
console.log("channel_key  SDK :", hex(sdkCk), sdkCk === expected.channelKey ? "MATCHES Cairo fixture" : "MISMATCH vs " + hex(expected.channelKey));
console.log("channel_key  ours:", hex(myCk), myCk === sdkCk ? "MATCHES SDK" : "MISMATCH");
console.log("note_id      SDK :", hex(sdkNid), sdkNid === expected.noteId ? "MATCHES Cairo fixture" : "MISMATCH vs " + hex(expected.noteId));
console.log("note_id      ours:", hex(myNid), myNid === sdkNid ? "MATCHES SDK" : "MISMATCH");

// Our own messaging derivations (domain-separated from every pool tag)
const msgId = (ck, i) => poseidonHashMany([tag("STRK20_MSG_ID:V1"), ck, BigInt(i)]);
const msgKey = (ck, i) => poseidonHashMany([tag("STRK20_MSG_KEY:V1"), ck, BigInt(i)]);
console.log("msg_id(ck,0)     :", hex(msgId(sdkCk, 0)));
console.log("msg_key(ck,0)    :", hex(msgKey(sdkCk, 0)));
console.log("distinct from note_id namespace:", msgId(BigInt(inp.channelKey), inp.index) !== sdkNid);
