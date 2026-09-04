# contracts — message_anonymizer

The single on-chain component: WriteOnce message-payload storage, writable only via the
STRK20 pool's `InvokeExternal` dispatch. Design: [docs/05-contracts.md](../docs/05-contracts.md);
the implemented `privacy_invoke` takes only `messages` and returns an empty deposits span —
the M2-verified interface (deposits are a return value in the pool protocol, never an input).

## Toolchain

Versions match the pool repo's workspace (`starknet-privacy` @ `bc75e4ba`):

| Tool | Version |
| --- | --- |
| scarb / Cairo | 2.17.0 |
| snforge / sncast | 0.63.0 |
| universal-sierra-compiler | any recent (2.10.0 used) |

The `privacy` crate is a git dependency pinned to the same commit as the frozen vectors.
`openzeppelin_utils`/`openzeppelin_interfaces` are pinned `=2.1.0` because 2.2.x requires
Cairo ≥2.18 while the pool's toolchain is 2.17.

## Test

```shell
snforge test
```

12 tests, including the four required negative cases (`CALLER_NOT_POOL`, `SLOT_OCCUPIED`,
`EMPTY_PAYLOAD`, empty-deposits return), in-batch duplicate rejection, batch atomicity, and a
write/read round trip of the frozen `vectors/derivations.json` sealed vectors.
`tests/vectors_gen.cairo` is generated — regenerate with `node vectors/to-cairo.mjs` after any
deliberate vector change.

## Deploy (Sepolia)

```shell
POOL_ADDRESS=0x...   # FULL pool address — the truncated 0x0254a6b2…e0d91 is not enough
ACCOUNT=deployer     # funded sncast account
./deploy/sepolia.sh
```

The script declares, deploys with the pool address as the only constructor arg, sanity-checks
`pool()`, and attempts Voyager verification. Record the resulting address in the docs.
