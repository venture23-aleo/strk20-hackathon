import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emptySnapshot, type SyncSnapshot, type SyncStore } from "@strk20-messaging/sdk";
import { configDir } from "./config.js";

/**
 * File-backed sync state at <config>/sync.json. Writes go through a temp file
 * + rename so a kill mid-write cannot corrupt the snapshot — the resumability
 * guarantee is only as good as the store's atomicity.
 */
export class FileSyncStore implements SyncStore {
  private readonly path = join(configDir(), "sync.json");

  load(): SyncSnapshot {
    return existsSync(this.path)
      ? (JSON.parse(readFileSync(this.path, "utf8")) as SyncSnapshot)
      : emptySnapshot();
  }

  save(snapshot: SyncSnapshot): void {
    mkdirSync(configDir(), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(snapshot, null, 2) + "\n");
    renameSync(tmp, this.path);
  }
}
