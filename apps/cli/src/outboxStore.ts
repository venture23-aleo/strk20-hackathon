import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Outbox, type OutboxEntry, type OutboxStore } from "@strk20-messaging/sdk";
import { configDir } from "./config.js";

class FileStore implements OutboxStore {
  private readonly path = join(configDir(), "outbox.json");

  load(): OutboxEntry[] {
    return existsSync(this.path)
      ? (JSON.parse(readFileSync(this.path, "utf8")) as OutboxEntry[])
      : [];
  }

  save(entries: OutboxEntry[]): void {
    mkdirSync(configDir(), { recursive: true });
    writeFileSync(this.path, JSON.stringify(entries, null, 2) + "\n");
  }
}

export function fileOutbox(): Outbox {
  return new Outbox(new FileStore());
}
