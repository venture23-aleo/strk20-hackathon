# msg — the M3 CLI

Send and read encrypted messages filed under STRK20 channel keys.

```shell
msg init --rpc <url> --helper <addr> --account <addr> [--mode direct|pool]
msg channel add --label bob --peer 0x... --key 0x...
msg send --to bob "hello"        # queued → (proving) → submitted → confirmed
msg read                          # [1] from 0xALICE · 2 min ago · "hello"
```

Config in `~/.strk20-msg` (`STRK20_MSG_HOME` overrides — the e2e test uses two homes as
"machine A" and "machine B"). Private key via `STRK20_MSG_PRIVATE_KEY`. Local state is
`{ channelKey → nextIndex }` and nothing else; deleting it costs a re-walk from index 0.

## Two submission modes

| | `direct` (dev only) | `pool` |
| --- | --- | --- |
| Path | account calls `privacy_invoke` on the helper | STRK20 pool transaction carrying our `InvokeExternal` + a zero-amount carrier note |
| Requires | helper deployed with your account as `pool` | full pool address, registered + funded account, proving service |
| Submitter visible | **yes** | no (further decoupled by a paymaster) |
| Status | **proven end to end on devnet** (`pnpm test:e2e`) | wired per the M0-verified shapes; not yet exercised live |

The submission tail (v3 `tip: 0n`, `proofFacts` omitted-not-empty, proof-nonce-cache
invalidation on failure) is wrapped once in [src/tail.ts](src/tail.ts) and used by both modes.
Discovery is the batched slot walk in [src/walk.ts](src/walk.ts) — `slot_lens` windows of 16,
one RPC round trip per window, stop at the first empty slot.

## e2e

```shell
# needs starknet-devnet v0.8.0-rc.3 on PATH (the pool repo's CI pin; it compiles Sierra 1.8)
RUN_DEVNET_E2E=1 pnpm --filter @strk20-messaging/cli test:e2e
```

Declares + deploys the M2 contract for real, drives the built CLI as child processes from two
separate config homes, and asserts the milestone transcript plus the observer property
(no recipient, no plaintext in calldata).

## What M3-on-Sepolia still needs

1. The full STRK20 Sepolia pool address (docs carry only a truncated form).
2. A funded Sepolia account, registered with `SetViewingKey`, and the proving service URL.
3. Helper deployed via `contracts/deploy/sepolia.sh`.
4. First live pool-mode send: watch the carrier step (`transfer(self, 0n)` compiling to the
   zero-amount `CreateEncNote` the pool sanctions) — verified in pool source, not yet on-chain.
5. Channel keys from the Privacy SDK's channel scan instead of `channel add` provisioning.
