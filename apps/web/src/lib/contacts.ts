/**
 * A contact spans TWO directional channels (04-cryptography.md): me->them
 * (outKey) and them->me (inKey), each with independent dense indices. The
 * thread view stitches both lanes into one conversation, and must stay
 * coherent while the two lanes confirm on different schedules.
 */
import type { HistoryRecord } from "@strk20-messaging/sdk";

export interface Contact {
  label: string;
  peer: string;
  outKey: string;
  inKey: string;
  /** Unregistered peers cannot receive; compose is disabled until this is true. */
  registered: boolean;
}

/**
 * Invites pair two clients onto the same pair of lanes. The invite is written
 * from the RECEIVER's point of view: their outKey is our inKey and vice versa,
 * so pasting it creates the exactly mirrored contact.
 */
export interface Invite {
  "strk20msg-invite": 1;
  /** The inviter's address — becomes the receiver's contact.peer. */
  peer: string;
  /** Lane the receiver sends on (= inviter's inKey). */
  yourOutKey: string;
  /** Lane the receiver reads on (= inviter's outKey). */
  yourInKey: string;
}

export function makeInvite(contact: Contact, myAddress: string): Invite {
  return {
    "strk20msg-invite": 1,
    peer: myAddress,
    yourOutKey: contact.inKey,
    yourInKey: contact.outKey,
  };
}

export function parseInvite(text: string): Invite | null {
  try {
    const raw = JSON.parse(text) as Partial<Invite>;
    if (
      raw["strk20msg-invite"] === 1 &&
      typeof raw.peer === "string" &&
      /^0x[0-9a-fA-F]+$/.test(raw.yourOutKey ?? "") &&
      /^0x[0-9a-fA-F]+$/.test(raw.yourInKey ?? "")
    ) {
      return raw as Invite;
    }
  } catch {
    /* not an invite */
  }
  return null;
}

export interface ThreadMessage {
  direction: "sent" | "received";
  body: string;
  timestamp: number;
  index: number;
  channelKey: string;
}

export function stitchThread(history: HistoryRecord[], contact: Contact): ThreadMessage[] {
  const lane = (records: HistoryRecord[], key: string, direction: "sent" | "received") =>
    records
      .filter((r) => r.channelKey === key)
      .map((r) => ({
        direction,
        body: decode(r.bodyBase64),
        timestamp: r.timestamp,
        index: r.index,
        channelKey: r.channelKey,
      }));

  return [...lane(history, contact.outKey, "sent"), ...lane(history, contact.inKey, "received")].sort(
    (a, b) =>
      // Timestamp first; ties break deterministically (received lane first,
      // then index) so the stitched order never flickers between syncs.
      a.timestamp - b.timestamp ||
      (a.direction === b.direction ? a.index - b.index : a.direction === "received" ? -1 : 1)
  );
}

function decode(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
