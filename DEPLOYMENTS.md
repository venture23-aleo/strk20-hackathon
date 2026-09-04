# Deployments

Single source of truth for every on-chain address this project uses. Update this file in the
same commit as any deployment. Explorer: prefix addresses/txs with `https://sepolia.voyager.online/contract/` or `/tx/`.

## Sepolia

### MessageAnonymizer (helper)

| | |
| --- | --- |
| **Address** | `0x06409a4a8c1962bbfd6b04ea9ab1f745be8e7bceddc61f4e322dcbc7781ae032` |
| Class hash | `0x0096558250259ea6ed253261f660a81e2041f98b2151dc54177cf8a854b08612` |
| Deploy tx | `0x06b8a04196f3538b6ce5c89003ff4f921f9909e48c545ba23769588f4e4a88fe` |
| Constructor `pool` | `0x03ab7fda…afac4` (the deployer account — **direct/dev mode only**) |
| Source | `contracts/src/message_anonymizer.cairo` @ commit `b39b66e` |
| Deployed | 2026-09-04 |
| ⚠ | Phase B (real pool mode) requires a **new deployment** with the real STRK20 pool address — the constructor pins `pool` forever. Record it below when it happens. |

### Deployer account

| | |
| --- | --- |
| **Address** | `0x03ab7fda95f39c9b5be0572bd2a115db1bff1db87c88fbcff872473f1f2afac4` |
| Type | OpenZeppelin account (sncast name: `deployer`; key in `~/.starknet_accounts/starknet_open_zeppelin_accounts.json` — testnet only, never reuse for value) |
| Deploy tx | `0x0482173cabf4cb0586dae3046112072a8b5f652176430070094a600f2ad04971` |
| Funded | 100 STRK via faucet, 2026-09-04 |

### External (not ours)

| Contract | Address | Note |
| --- | --- | --- |
| STRK20 pool | `0x0254a6b2…e0d91` **(truncated — full address unknown, Phase B blocker B1)** | |
| STRK fee token | `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` | |
| ETH token | `0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7` | |

### RPC endpoints

| Endpoint | Status |
| --- | --- |
| `https://api.cartridge.gg/x/starknet/sepolia` | **in use** (spec 0.9; sncast warns, works) |
| `https://starknet-sepolia.drpc.org` | fallback — flaky (`getBlockWithTxHashes` intermittently missing) |
| `*.blastapi.io` | dead — do not use |

## Mainnet

Nothing deployed. STRK20 pool (external): `0x040337b1…e812a` (truncated — obtain full
address before M7).

## Benchmarks (measured on the deployments above)

| Tier | Tx | Fee |
| --- | --- | --- |
| 256 B message | `0x2224a360cd80384332d0ead9d7f801e1d4142f40fd98e0814fb7a5302ff395` | 0.2076 STRK |
| 4 KiB message | `0x32a7b35d2ebe87d12cb7c53110963e6c9cb89f3e5ae100f91b52292969afe91` | 2.3185 STRK |

Details and the L2-execution-gas finding: [docs/15-testnet-runbook.md](docs/15-testnet-runbook.md) § A6.
