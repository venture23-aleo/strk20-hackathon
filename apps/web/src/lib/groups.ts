/**
 * Group model for the UI. One shared group key; each member writes on their
 * own derived lane (sdk groupLaneKey) and reads everyone's. The thread view
 * stitches N lanes; attribution comes from the lane (which member's lane a
 * message sits on), which inside a shared-key group is cooperative — any
 * member could write on another's lane, the same trust model as the pairwise
 * shared-secret MAC. Joining via invite reveals the FULL history: lanes are
 * walkable from index 0 and storage is permanent.
 */
import { groupLaneKey, type HistoryRecord } from "@strk20-messaging/sdk";

export interface GroupMember {
  address: string;
  label?: string;
}

export interface Group {
  name: string;
  groupKey: string;
  members: GroupMember[];
}

export interface GroupInvite {
  "strk20msg-group-invite": 1;
  name: string;
  groupKey: string;
  members: GroupMember[];
}

export function makeGroupInvite(group: Group): GroupInvite {
  return { "strk20msg-group-invite": 1, name: group.name, groupKey: group.groupKey, members: group.members };
}

export function parseGroupInvite(text: string): GroupInvite | null {
  try {
    const raw = JSON.parse(text) as Partial<GroupInvite>;
    if (
      raw["strk20msg-group-invite"] === 1 &&
      typeof raw.name === "string" &&
      /^0x[0-9a-fA-F]+$/.test(raw.groupKey ?? "") &&
      Array.isArray(raw.members) &&
      raw.members.length > 0 &&
      raw.members.every((m) => /^0x[0-9a-fA-F]+$/.test(m?.address ?? ""))
    ) {
      return raw as GroupInvite;
    }
  } catch {
    /* not a group invite */
  }
  return null;
}

/** Everyone whose lane must be walked: declared members plus myself. */
export function groupLanes(group: Group, myAddress: string): { laneKey: string; member: GroupMember }[] {
  const all = [...group.members];
  if (!all.some((m) => sameAddr(m.address, myAddress))) {
    all.push({ address: myAddress, label: "you" });
  }
  return all.map((member) => ({
    laneKey: "0x" + groupLaneKey(BigInt(group.groupKey), BigInt(member.address)).toString(16),
    member,
  }));
}

/** My own write lane in the group. */
export function myLane(group: Group, myAddress: string): string {
  return "0x" + groupLaneKey(BigInt(group.groupKey), BigInt(myAddress)).toString(16);
}

export interface GroupThreadMessage {
  direction: "sent" | "received";
  senderAddress: string;
  senderLabel: string;
  body: string;
  timestamp: number;
  index: number;
  channelKey: string;
}

export function stitchGroupThread(
  history: HistoryRecord[],
  group: Group,
  myAddress: string
): GroupThreadMessage[] {
  const lanes = groupLanes(group, myAddress);
  const byLane = new Map(lanes.map((l) => [l.laneKey.toLowerCase(), l.member]));
  return history
    .filter((r) => byLane.has(r.channelKey.toLowerCase()))
    .map((r) => {
      const member = byLane.get(r.channelKey.toLowerCase())!;
      const mine = sameAddr(member.address, myAddress);
      return {
        direction: mine ? ("sent" as const) : ("received" as const),
        senderAddress: member.address,
        senderLabel: mine ? "you" : (member.label ?? shortAddr(member.address)),
        body: decode(r.bodyBase64),
        timestamp: r.timestamp,
        index: r.index,
        channelKey: r.channelKey,
      };
    })
    .sort(
      (a, b) =>
        a.timestamp - b.timestamp ||
        a.channelKey.localeCompare(b.channelKey) ||
        a.index - b.index
    );
}

function sameAddr(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
}

function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 7)}…${addr.slice(-4)}` : addr;
}

function decode(b64: string): string {
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
