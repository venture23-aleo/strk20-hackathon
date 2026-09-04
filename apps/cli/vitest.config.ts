import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The e2e files each spawn a devnet; running them in parallel makes the
    // spawns race. Sequential files cost little — unit files are sub-second.
    fileParallelism: false,
  },
});
