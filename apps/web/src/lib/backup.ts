/**
 * Key backup and restore. The viewing key IS the account: everything else
 * (history, cursors) is reconstructable from chain state (M5), so the backup
 * is deliberately small — key, address, contacts.
 */
import type { Contact } from "./contacts.js";

export interface Backup {
  version: 1;
  viewingKey: string;
  accountAddress: string;
  contacts: Contact[];
}

export function exportBackup(data: Omit<Backup, "version">): string {
  return JSON.stringify({ version: 1, ...data }, null, 2);
}

export function parseBackup(json: string): Backup {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("not valid JSON");
  }
  const b = raw as Partial<Backup>;
  if (b.version !== 1) throw new Error("unsupported backup version");
  if (typeof b.viewingKey !== "string" || !/^0x[0-9a-fA-F]+$/.test(b.viewingKey)) {
    throw new Error("backup has no valid viewing key");
  }
  if (typeof b.accountAddress !== "string") throw new Error("backup has no account address");
  const contacts = Array.isArray(b.contacts) ? b.contacts : [];
  for (const c of contacts) {
    if (!c.label || !c.peer || !c.outKey || !c.inKey) throw new Error("malformed contact in backup");
  }
  return { version: 1, viewingKey: b.viewingKey, accountAddress: b.accountAddress, contacts };
}
