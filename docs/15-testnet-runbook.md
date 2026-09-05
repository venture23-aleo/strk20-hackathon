# 15 — Testnet Runbook

How to take everything built in M0–M6 onto **Sepolia**. Two phases: Phase A is a
direct-mode run achievable today with nothing but faucet funds; Phase B is the real
pool-mode path, blocked on information only the STRK20 side can provide.

Status legend: ☐ open · ☑ done. Update this file as items close.

---

## Phase A — direct (dev) mode on Sepolia

The M3 devnet scenario on a public network: real chain, real contract, real messages.
**The submitter is visible** — direct mode has no pool anonymity; it exists to prove the
pipeline and to measure real costs.

### A1 ☑ Create or pick a Sepolia account

> Done 2026-09-04: sncast account `deployer` created at
> `0x03ab7fda95f39c9b5be0572bd2a115db1bff1db87c88fbcff872473f1f2afac4`
> (est. deployment fee 0.0829 STRK). Network deploy pending faucet funds (A2).

Either export from a wallet (Argent / Braavos → address + private key), or:

```shell
sncast account create --name deployer --network sepolia
```

A fresh account must also be **deployed** — `sncast account deploy` after funding, or a
wallet's first transaction does it.

### A2 ☑ Fund it with Sepolia STRK

> Done 2026-09-04: faucet delivered 100 STRK; account deployed —
> tx `0x0482173cabf4cb0586dae3046112072a8b5f652176430070094a600f2ad04971`.

- https://faucet.starknet.io (or the Alchemy faucet)
- 1–2 STRK is plenty; fees per message are fractions of a cent.

### A3 ☑ Pick an RPC endpoint

- **In use:** `https://api.cartridge.gg/x/starknet/sepolia` (spec 0.9.0; sncast 0.63 warns
  it wants 0.10 but works)
- `https://starknet-sepolia.drpc.org` worked early on, then began refusing
  `starknet_getBlockWithTxHashes` mid-session — its load balancer is inconsistent; keep as
  fallback only
- More reliable for sustained use: a free keyed endpoint (e.g. Alchemy)
- **Dead — do not use:** BlastAPI (`*.blastapi.io` returns a shutdown notice)

### A4 ☐ Deploy the helper (pool = your own account)

For direct mode, the constructor's `pool` is **your account address** — the same trick the
devnet e2e uses, so `privacy_invoke` accepts your direct calls:

```shell
POOL_ADDRESS=<your account address> \
ACCOUNT=deployer \
./contracts/deploy/sepolia.sh
```

The script declares, deploys, sanity-checks `pool()`, and attempts Voyager verification.

> ☑ Done 2026-09-04. class hash
> `0x0096558250259ea6ed253261f660a81e2041f98b2151dc54177cf8a854b08612`, helper deployed at
> **`0x06409a4a8c1962bbfd6b04ea9ab1f745be8e7bceddc61f4e322dcbc7781ae032`**
> (tx `0x06b8a04196f3538b6ce5c89003ff4f921f9909e48c545ba23769588f4e4a88fe`);
> `pool()` echoes the deployer address.

### A5 ☑ Configure the CLI and run the M3 transcript

> Done 2026-09-04, on Sepolia: machine A `send --to bob "hello from Sepolia"` →
> confirmed `0x2224a360cd80384332d0ead9d7f801e1d4142f40fd98e0814fb7a5302ff395`;
> machine B (fresh home, channel key only) `read` →
> `[1] from 0x3ab7… · 21 s ago · "hello from Sepolia"`, and
> `sync --full` reconstructed it: `synced to block 14,544,448 · 1 message(s) known`.

```shell
export STRK20_MSG_PRIVATE_KEY=<key>          # never in config files or the repo

msg init --rpc https://starknet-sepolia.drpc.org \
         --helper <helper addr> --account <your addr> --mode direct
msg channel add --label bob --peer <peer addr> --key <shared channel key hex>

# machine A
msg send --to bob "hello"          # → submitted 0x… → confirmed 0x…

# machine B (second config home or a genuinely different machine;
# needs only the RPC URL, helper address and the channel key)
msg read                           # → [1] from 0xALICE · 2 min ago · "hello"
msg sync --full && msg history     # M5: full reconstruction from chain state
```

Batching and memo work identically: `msg queue` ×N + `msg flush`, `msg pay`.

### A6 ☑ Bank the real cost numbers (closes M0/S3's residual)

The M0 decision record priced storage from a **model**; the send receipts now give the
real figure. For one 256 B-tier and one 4 KiB-tier message (`--pad 4096`), pull the
receipt and record actual fee + gas split:

```shell
curl -s <rpc> -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,
  "method":"starknet_getTransactionReceipt","params":["<tx hash>"]}'
```

Write the numbers into [14-m0-decision-record.md](14-m0-decision-record.md) § S3.

| Tier | tx hash | actual fee (STRK) | l1_data_gas | l2_gas |
| --- | --- | --- | --- | --- |
| 256 B | `0x2224a360cd80384332d0ead9d7f801e1d4142f40fd98e0814fb7a5302ff395` | **0.2076** | 1,152 | 6,032,160 |
| 4 KiB | `0x32a7b35d2ebe87d12cb7c53110963e6c9cb89f3e5ae100f91b52292969afe91` | **2.3185** | 13,056 | 67,595,040 |

> Measured 2026-09-04, Sepolia gas prices, direct mode (no pool wrapper, no proving fee).
> **The M0 model's conclusion was right but its emphasis was wrong**: DA is indeed
> negligible, but **L2 execution gas dominates** — ~93% of the fee is the per-felt storage
> writes, scaling linearly with payload felts (4 KiB ≈ 11× the 256 B fee). At $0.027/STRK:
> ~$0.006 per 256 B message, ~$0.063 per 4 KiB message, before pool/proving overhead.
> Written back into [14-m0-decision-record.md](14-m0-decision-record.md) § S3.

---

## Phase B — pool mode (the real anonymous path)

### B1 ☑ Obtain the full Sepolia pool address

> **Closed 2026-09-05.** Recovered without any external party:
> `pool = 0x254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91`
> Method: pulled the full **mainnet** address from AVNU's production frontend bundle,
> took its class hash, confirmed the pool class is declared on Sepolia, then scanned
> Sepolia for the pool's `ViewingKeySet` events — one emitter, matching the truncated
> form. The pool is active. (Sepolia runs an older pool class than mainnet —
> re-verify SDK compatibility at first contact.)

### B2 ☐ Obtain the proving service URL (Sepolia) — **now the only hard blocker**

Remote proving is mandatory (`ProvingServiceProofProvider`); there is no local prover.
Searched 2026-09-05: no public endpoint exists in the `starknet-privacy` repo, AVNU's
frontend bundle, or reachable docs — AVNU appears to proxy proving through its own
backend. Source: the STRK20 team directly. Note: **a hosted prover sees the witness** —
fine for testnet, a real decision for production.

Also blocked behind this: registration itself. The pool is an account contract
(`__execute__`/`__validate__`) — `SetViewingKey` rides *inside* proven transactions, so
there is no proof-free on-ramp.

### B3 ◐ Discovery — self-hostable, no external URL needed

Two findings (2026-09-05): `ContractDiscoveryProvider` (plain-RPC discovery, no indexer)
**exists in the SDK's testing surface** and is what the harness uses — worth requesting
as a public export. And the indexer itself is open source and self-hostable
(`deploy/discovery-service/` in the pool repo, Rust, needs only an RPC URL). Either path
avoids depending on a hosted indexer. OHTTP stays the default if a hosted one is used.

### B-proof ☑ Pool-mode mechanics proven against the real pool contract

> **2026-09-05** — `apps/cli/test/e2e-pool.test.ts` (gated `RUN_POOL_E2E=1` +
> `STARKNET_PRIVACY=<built clone>`): our helper deployed with **pool = the real pool
> contract**; alice registers + shields; the message rides a pool transaction built by
> the `pool.ts` shapes; the **pool calls `privacy_invoke`** (the helper's
> `CALLER_NOT_POOL` guard proves the caller); submission via **outside execution** —
> asserted: the sender's address appears **nowhere in the transaction envelope**, not
> as `sender_address`, not in calldata; the recipient decrypts normally. Sender
> anonymity is functional; Sepolia needs only the B2 endpoint swapped in.
>
> Execution finding on the carrier: the pool sanctions zero-amount enc notes (M0/S1)
> but the shipped SDK rejects them client-side ("Created note amount must be
> positive") — the working carrier is a **1-wei enc-note self-transfer** (private
> churn, nothing leaves the pool). Pinned in the test; revisit on SDK updates.

### B4 ☐ Register viewing keys — both parties

`SetViewingKey` on the pool for sender **and** recipient (unregistered recipients cannot
receive — the app's compose-time stop is not theoretical). The SDK's `autoRegister: true`
bundles registration into the first real operation.

### B5 ☐ Shield tokens and pick the carrier token

At least one deposit into the pool per account, and set `config.pool.carrierToken` (the
zero-amount carrier note's token — the deposited token is the natural choice).

### B6 ☐ Redeploy the helper with the real pool address

The constructor pins `pool` **forever** — the Phase-A helper cannot be reused:

```shell
POOL_ADDRESS=<full pool address> ACCOUNT=deployer ./contracts/deploy/sepolia.sh
```

### B7 ☐ Build the Privacy SDK locally and point the CLI at it

```shell
git clone https://github.com/starkware-libs/starknet-privacy   # public, no auth
cd starknet-privacy/sdk && npm ci && npm run build             # Node 22+ works
```

Then `msg init --mode pool` and fill `config.pool`:
`{ sdkPath, poolAddress, provingUrl, discoveryUrl, carrierToken }`.

### B8 ☐ First live pool send — watch the carrier step

The first live send doubles as the last unverified M0 claim's on-chain test: the carrier
(`transfer(self, 0n)` compiling to the pool-sanctioned zero-amount `CreateEncNote`) is
verified in pool source but has never run on-chain. If it is rejected, the fallback is a
dust self-transfer — a one-line change in `apps/cli/src/pool.ts`, plus a cost/threat-model
note. Also empirically find the real batch-size ceiling (M4's known unknown): flush 8,
then larger, until the prover pushes back — the halving fallback handles the failure.

### B9 ☐ Verify the observer property — the full M3 exit criterion

Open the confirmed transaction on an explorer (e.g. sepolia.voyager.online). An observer
must see: the pool and helper addresses, a payload size, a timestamp — and **neither
party's address, no recipient, no content**. Screenshot it for the record.

### B10 ☐ Optional: paymaster

AVNU API key (held server-side) decouples the submitting address — the D3′ v1
recommendation. Direct submission stays available as the liveness fallback.

---

## Quick reference

> Canonical address registry: [DEPLOYMENTS.md](../DEPLOYMENTS.md) — update it in the same
> commit as any deployment. The table below is a convenience snapshot.

| Item | Value |
| --- | --- |
| RPC (Sepolia) | `https://api.cartridge.gg/x/starknet/sepolia` (drpc = flaky fallback) |
| Toolchain | scarb 2.17.0 · snforge/sncast 0.63.0 · matches `starknet-privacy@bc75e4ba` |
| Deployer account | `0x03ab7fda95f39c9b5be0572bd2a115db1bff1db87c88fbcff872473f1f2afac4` (sncast name: `deployer`) |
| Class hash | `0x0096558250259ea6ed253261f660a81e2041f98b2151dc54177cf8a854b08612` |
| Helper (Phase A) | `0x06409a4a8c1962bbfd6b04ea9ab1f745be8e7bceddc61f4e322dcbc7781ae032` (pool = deployer, dev only) |
| Pool (full address) | *fill in at B1* |
| Helper (Phase B) | *fill in at B6* |
| Private key handling | `STRK20_MSG_PRIVATE_KEY` env only — never in config files or the repo |
