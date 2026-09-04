# 02 — Threat Model

## Actors

| Actor | Capability |
| --- | --- |
| **Chain observer** | Reads all Starknet state, transactions, events. Unlimited retention and correlation. |
| **Sequencer** | Everything the observer has, plus mempool visibility and ordering power. |
| **Paymaster** | Sees the transaction before it is public, plus the submitter's network origin and timing. |
| **Auditor** | Holds the escrow key that can recover any registered user's private viewing key under lawful process. **See below.** |
| **Recipient** | Holds the channel key; reads the message and identifies the sender. |
| **Global passive network adversary** | Observes traffic to paymasters and RPC endpoints. Out of scope for v1. |

## What is hidden

| Element | Chain observer | Paymaster | Auditor |
| --- | --- | --- | --- |
| Sender identity | Hidden — pool is the helper's caller; submitter is the paymaster | Hidden (sees IP, not pool identity) | **Visible** |
| Recipient identity | Hidden — resolvable only from a viewing key | Hidden | **Visible** |
| Message content | Hidden — AEAD under a per-message key | Hidden | **Visible** |
| Sender↔recipient link | Hidden — slot ids are unlinkable without the channel key | Hidden | **Visible** |
| That a pool transaction occurred | **Visible** | Visible | Visible |
| That the message helper was invoked | **Visible** — the helper's address is public | Visible | Visible |
| Payload size (bucketed) | **Visible** | Visible | Visible |
| Block timestamp | **Visible** | Visible | Visible |

## The escrowed auditor key

At registration, STRK20 encrypts the user's private viewing key `k` to an auditor's public key
and stores that ciphertext on-chain. An auditor under lawful process recovers `k`, and from
`k` derives every channel key that user participates in.

Because this design files messages under those same channel keys, **key recovery yields
message plaintext, not just payment history.**

Three consequences, all of which belong in user-facing copy rather than a footnote:

- The system resists chain observers, sequencers, paymasters, and other pool users. It does
  **not** resist an adversary who can compel the auditor.
- Use cases premised on resisting a state-level adversary — anonymous tips, dissident
  communication, whistleblowing — are **out of scope**, and should be removed from any pitch
  rather than qualified.
- Supported use cases are those where compliance disclosure is acceptable or desirable:
  payment memos, OTC and escrow negotiation, professional and commercial confidentiality.

An alternative exists — encrypt bodies under a key derived from material *outside* the pool's
viewing-key hierarchy, so the auditor recovers metadata but not content. That trades away the
"one key, one backup" property and arguably defeats the pool's compliance design. It is a real
decision, not an obvious one: see [D10](09-open-decisions.md#d10--do-we-inherit-auditability).

## Known leaks and mitigations

**Helper invocation is visible.** Every pool transaction reveals which anonymizer it invoked.
A transaction calling `message_anonymizer` publicly says "this was a message," distinguishing
it from a swap or a plain transfer. *Mitigation:* messages riding along with transfers are
indistinguishable from transfers only if the helper is shared with other functions —
otherwise accept that "a message was sent" is public, as it already was in the original design.

**Payload size.** Slot count is public and fingerprints message length. *Mitigation:* pad to
fixed buckets — 256 B / 1 KiB / 4 KiB — enforced in the SDK.

**Timing.** Block timestamps plus cadence permit correlation. *Mitigation:* batch multiple
messages into one `InvokeExternal`, plus client-side send jitter. Partial only.

**Anonymity set size.** Bounded by STRK20's participant count, not by anything here. This is
inherited, dominant, and unfixable at this layer — but it is now a real deployed number rather
than a hypothetical, which is a large improvement over the previous revision.

**Channel-open linkability.** STRK20 documents this: opening a channel and depositing or
withdrawing in tight succession can link a recipient to public activity. Messaging inherits it.
*Mitigation:* spread channel setup and message traffic over time.

**Deposit screening.** Shielding addresses are screened by FPI and each deposit is signed.
Entry to the anonymity set is permissioned; this does not affect messages but does affect who
can send them.

## Non-goals for v1

- **Forward secrecy.** Channel keys are long-lived by STRK20's design — they are derived from
  registered, immutable viewing keys. A ratchet on top is possible but would break the
  property that discovery needs no extra state.
- **Post-compromise security.** No healing after key compromise.
- **Resistance to auditor compulsion.** See above. This is the headline non-goal.
- **Delivery guarantees or read receipts.** Inclusion is not delivery.
- **Resistance to a global passive network adversary.** Needs mixnet transport.
- **Protection against a malicious recipient.** They can publish plaintext and their key.

## Assumptions

1. STRK20's channel-key derivation and note-id scheme are as documented. **Confirm against
   source.**
2. A helper may be invoked with no token movement (empty `OpenNoteDeposit` span). Documented
   as valid; **confirm against source.**
3. The pool's proof establishes caller authorization, so the helper needs no separate
   membership check beyond `caller == pool`.
4. Paymaster submission genuinely decouples the submitter address, as documented for AVNU.
