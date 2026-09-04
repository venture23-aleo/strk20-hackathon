# STRK20 Messages — the M6 browser client

The client shell: something a non-technical person can use. Browser app, as decided by M0/S2
(the Privacy SDK bundles into Vite; our crypto core is noble/scure-only and browser-safe).

```shell
pnpm --filter @strk20-messaging/web dev      # http://localhost:5173
pnpm --filter @strk20-messaging/web build
pnpm --filter @strk20-messaging/web test
```

## Modes

| Mode | What it is |
| --- | --- |
| **demo** (default) | A simulated pool in localStorage: real encryption, real WriteOnce slot semantics, the real ~29 s proving latency (adjustable in settings, honest by default), a peer registry for the unregistered-recipient flow, and a demo counterparty who replies. This is the walkthrough build for the "watch someone use it" exit test. |
| **direct** | A real helper over RPC — the CLI's dev mode, in the browser ([src/lib/backend.ts](src/lib/backend.ts)). |
| pool | Follows the CLI's gated path; needs the live pool credentials. |

## Where each M6 deliverable lives

- **Outbox interface, batch control** — [OutboxBar.tsx](src/ui/OutboxBar.tsx): "Outbox · N messages
  queued · ~29 s · cost · one transaction · [Send batch]". A control, not a spinner.
- **Explicit send states** — Queued → Proving (~29 s, visible progress) → Submitted → Confirmed
  chips, driven by the sdk Outbox state machine.
- **Tier preview + boundary warnings** — [costs.ts](src/lib/costs.ts) / compose footer:
  "N more bytes moves this to the 1 KiB tier (+$…)".
- **Sync indicator in the chrome** — [Chrome.tsx](src/ui/Chrome.tsx): "synced to block N · Xs ago",
  header not settings; click to sync.
- **Onboarding disclosures** — [Onboarding.tsx](src/ui/Onboarding.tsx): all three (auditor can
  read; messages permanent; "a message was sent" is public), each individually acknowledged,
  gate enforced. At onboarding, not in settings.
- **Thread view stitching** — [contacts.ts](src/lib/contacts.ts): the two directional lanes
  merged by timestamp with deterministic tie-breaks.
- **Unregistered-recipient flow** — [ThreadView.tsx](src/ui/ThreadView.tsx): hard stop at compose
  time with an explanation, an invite to copy, and re-check; demo mode can simulate the peer
  registering.
- **Key backup and restore** — [backup.ts](src/lib/backup.ts) + Settings (download/copy) +
  onboarding restore path. Backups hold keys and contacts only — history is rebuilt by sync
  (M5), which the tests prove.
- **No delete affordance anywhere** — by construction; the permanence disclosure says why.

## Verified by driving it

A Playwright script walked the whole flow headlessly (onboarding gate, contact add,
unregistered flow, tier warning, two-message batch through a real 29 s proving run, demo reply
arriving via sync, no-delete check) with zero console errors; screenshots confirmed each
screen. The human "watch someone who has never seen the CLI" session remains to be run — the
demo mode exists precisely so that session needs nothing but a browser.
