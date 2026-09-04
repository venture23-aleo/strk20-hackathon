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

### A1 ☐ Create or pick a Sepolia account

Either export from a wallet (Argent / Braavos → address + private key), or:

```shell
sncast account create --name deployer --network sepolia
```

A fresh account must also be **deployed** — `sncast account deploy` after funding, or a
wallet's first transaction does it.

### A2 ☐ Fund it with Sepolia STRK

- https://faucet.starknet.io (or the Alchemy faucet)
- 1–2 STRK is plenty; fees per message are fractions of a cent.

### A3 ☐ Pick an RPC endpoint

- Works today, no key: `https://starknet-sepolia.drpc.org` (the deploy script's default)
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
Record the deployed helper address here: `helper = 0x____________`

### A5 ☐ Configure the CLI and run the M3 transcript

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

### A6 ☐ Bank the real cost numbers (closes M0/S3's residual)

The M0 decision record priced storage from a **model**; the send receipts now give the
real figure. For one 256 B-tier and one 4 KiB-tier message (`--pad 4096`), pull the
receipt and record actual fee + gas split:

```shell
curl -s <rpc> -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,
  "method":"starknet_getTransactionReceipt","params":["<tx hash>"]}'
```

Write the numbers into [14-m0-decision-record.md](14-m0-decision-record.md) § S3.

| Tier | tx hash | actual fee (STRK) |
| --- | --- | --- |
| 256 B | | |
| 4 KiB | | |

---

## Phase B — pool mode (the real anonymous path)

### B1 ☐ Obtain the full Sepolia pool address — **the hard blocker**

Our docs carry only the truncated `0x0254a6b2…e0d91`; the full address is not in the
`starknet-privacy` repo or any public page we could reach. Sources to try: the STRK20
team / Discord, the strk20.starknet.io docs, or an explorer search once any known pool
transaction is in hand. Record it here: `pool = 0x____________`

### B2 ☐ Obtain the proving service URL (Sepolia)

Remote proving is mandatory (`ProvingServiceProofProvider`); there is no local prover.
Note: **a hosted prover sees the witness** — fine for testnet, a real decision for
production (self-host; see [10-tech-stack.md](10-tech-stack.md)).

### B3 ☐ Obtain the discovery indexer URL

Needed for channel discovery. `ContractDiscoveryProvider` (plain-RPC discovery) is still
unexported upstream — **re-check the repo before building around this**, it moves fast.
OHTTP stays on by default in our wiring; leave it that way.

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

| Item | Value |
| --- | --- |
| RPC (Sepolia) | `https://starknet-sepolia.drpc.org` |
| Toolchain | scarb 2.17.0 · snforge/sncast 0.63.0 · matches `starknet-privacy@bc75e4ba` |
| Helper (Phase A) | *fill in at A4* |
| Pool (full address) | *fill in at B1* |
| Helper (Phase B) | *fill in at B6* |
| Private key handling | `STRK20_MSG_PRIVATE_KEY` env only — never in config files or the repo |
