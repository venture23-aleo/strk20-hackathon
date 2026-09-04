/**
 * Regenerates vectors/derivations.json.
 *
 * channel_key and note_id come FROM THE PRIVACY SDK (the shipped code is the
 * ground truth, not the documented formula — 09-open-decisions.md, item 1).
 * msg_id / msg_key / packing / sealed come from our sdk package and freeze the
 * TS <-> Cairo interface.
 *
 * Usage:
 *   git clone https://github.com/starkware-libs/starknet-privacy
 *   cd starknet-privacy/sdk && npm ci && npm run build
 *   STARKNET_PRIVACY=/path/to/starknet-privacy node vectors/generate.mjs
 *
 * The output is FROZEN: regenerate only for a deliberate, reviewed format bump.
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const privacyRepo = process.env.STARKNET_PRIVACY;
if (!privacyRepo) {
  console.error("Set STARKNET_PRIVACY to a built starknet-privacy checkout.");
  process.exit(1);
}

const sdkTesting = await import(join(privacyRepo, "sdk/dist/testing/index.js"));
const ours = await import(join(here, "../sdk/dist/index.js"));

const hex = (v) => "0x" + v.toString(16);
const commit = execSync("git log -1 --format=%h", { cwd: privacyRepo }).toString().trim();

// --- channel_key / note_id: ground truth from the Privacy SDK -------------
const ckCases = [
  // The SDK's own Cairo-reference fixture inputs, for cross-checking against their suite.
  { sender: 0x123n, sender_sk: 0x789n, recipient: 0x456n, recipient_pk: 0xabcn },
  { sender: 0xa11cen, sender_sk: 0x5ec4e7n, recipient: 0xb0bn, recipient_pk: 0x9abcdefn },
];
const channel_key = ckCases.map((c) => ({
  sender: hex(c.sender),
  sender_sk: hex(c.sender_sk),
  recipient: hex(c.recipient),
  recipient_pk: hex(c.recipient_pk),
  expected: hex(sdkTesting.compute_channel_key(c.sender, c.sender_sk, c.recipient, c.recipient_pk)),
}));

const nidCases = [
  { channel_key: 0xdefn, token: 0x1234n, index: 5 },
  { channel_key: BigInt(channel_key[0].expected), token: 0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7n, index: 0 },
];
const note_id = nidCases.map((c) => ({
  channel_key: hex(c.channel_key),
  token: hex(c.token),
  index: c.index,
  expected: hex(sdkTesting.compute_note_id(c.channel_key, c.token, c.index)),
}));

// --- messaging namespace: frozen from our implementation ------------------
const ck0 = BigInt(channel_key[0].expected);
const indices = [0, 1, 2, 7, 100];
const msg_id = indices.map((i) => ({ channel_key: hex(ck0), index: i, expected: hex(ours.msgId(ck0, i)) }));
const msg_key = indices.map((i) => ({ channel_key: hex(ck0), index: i, expected: hex(ours.msgKey(ck0, i)) }));

const patterned = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 0xff);
const packing = [0, 1, 31, 32, 62, 63].filter((n) => n > 0).map((n) => {
  const bytes = patterned(n);
  return {
    bytes_base64: Buffer.from(bytes).toString("base64"),
    expected_felts: ours.packFelts(bytes).map(hex),
  };
});

const sealedCases = [
  { index: 0, body: new TextEncoder().encode("hello"), label: "256 B tier" },
  { index: 3, body: patterned(300), label: "1 KiB tier" },
];
const sender = 0xa11cen;
const timestamp = 1756944000n; // 2025-09-04T00:00:00Z, fixed
const sealed = sealedCases.map((c) => {
  const s = ours.seal({ channelKey: ck0, index: c.index, sender, timestamp, body: c.body });
  return {
    label: c.label,
    channel_key: hex(ck0),
    index: c.index,
    sender: hex(sender),
    timestamp: timestamp.toString(),
    body_base64: Buffer.from(c.body).toString("base64"),
    bucket: s.bucket,
    msg_id: hex(s.msgId),
    felts: s.felts.map(hex),
  };
});

const out = {
  _meta: {
    source: `starkware-libs/starknet-privacy@${commit} (channel_key, note_id) + @strk20-messaging/sdk (msg_id, msg_key, packing, sealed)`,
    generated: new Date().toISOString().slice(0, 10),
    script: "vectors/generate.mjs",
  },
  channel_key,
  note_id,
  msg_id,
  msg_key,
  packing,
  sealed,
};
writeFileSync(join(here, "derivations.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`wrote vectors/derivations.json (source commit ${commit})`);
