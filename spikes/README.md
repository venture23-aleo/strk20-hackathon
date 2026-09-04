# M0 feasibility spikes

Findings and decisions: [docs/14-m0-decision-record.md](../docs/14-m0-decision-record.md).
Verified against [starkware-libs/starknet-privacy](https://github.com/starkware-libs/starknet-privacy)
at commit `bc75e4ba`.

## Setup (shared)

```shell
git clone https://github.com/starkware-libs/starknet-privacy   # public, no auth needed
cd starknet-privacy/sdk
npm ci && npm run build                                        # works on Node 22+
```

## S4 — derivations (`s4-derivations.mjs`)

Reproduces `channel_key` and `note_id` two ways — via the SDK's built `/testing` exports and
via an independent `@scure/starknet` reimplementation — and checks both against the SDK's
Cairo-generated fixture. Also prints our messaging-namespace `msg_id`/`msg_key` samples.

```shell
cp s4-derivations.mjs <starknet-privacy>/sdk/ && cd <starknet-privacy>/sdk
node s4-derivations.mjs      # expect four MATCHES lines
```

## S2 — Vite bundling (`s2-vite/`)

Minimal Vite app importing the SDK root entry. Expects the SDK checkout at
`../starknet-privacy/sdk` relative to `s2-vite/` (adjust the `file:` path in
`package.json` otherwise).

```shell
cd s2-vite && npm install && npm run build   # succeeds: ~400 kB bundle, 105 kB gzip
```

Importing `@starkware-libs/starknet-privacy-sdk/testing` instead breaks the build
(Node-only devnet imports) — that is the finding, not a bug in the spike.

## S1 / S3

Source-reading and RPC-measurement spikes; no standalone scripts. Evidence with exact
file:line references is in the decision record. S3 gas prices came from
`starknet-sepolia.drpc.org` and `rpc.starknet.lava.build` via `starknet_getBlockWithTxHashes`.
