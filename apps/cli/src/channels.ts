import type { CliConfig } from "./config.js";

/**
 * Channel discovery wiring (M5). The Privacy SDK's factory, when handed a
 * discovery CONFIG, constructs IndexerDiscoveryProvider WITHOUT the ohttp
 * option — so we always construct the provider instance ourselves.
 * OHTTP is the default, not an option (07-discovery.md): it hides the
 * client's IP from the discovery service and costs nothing.
 */
export interface DiscoveryOptions {
  url: string;
  ohttp: boolean | { relayUrl?: string };
}

export function discoveryOptions(cfg: {
  discoveryUrl: string;
  ohttp?: boolean | { relayUrl?: string };
}): DiscoveryOptions {
  if (cfg.ohttp === false) {
    // Explicit opt-out is honored but loud: the discovery service sees your IP.
    console.error("warning: OHTTP disabled — the discovery service can see your IP address");
    return { url: cfg.discoveryUrl, ohttp: false };
  }
  return { url: cfg.discoveryUrl, ohttp: cfg.ohttp ?? true };
}

export interface DiscoveredChannel {
  peer: string;
  channelKey: string;
  direction: "in" | "out";
}

/**
 * Wire `transfers.discoverChannels` with cursor pagination. Live only in pool
 * mode with an indexer URL configured; channel discovery is the one half of
 * discovery that needs a service today (ContractDiscoveryProvider is not yet
 * exported from the published SDK).
 */
export async function discoverChannelsFromPool(
  cfg: CliConfig,
  viewingKey: bigint
): Promise<{ channels: DiscoveredChannel[]; timestamp: unknown }> {
  const poolCfg = cfg.pool;
  if (!poolCfg) throw new Error("channel discovery needs config.pool (mode 'pool')");
  const discoveryUrl = (poolCfg as { discoveryUrl?: string }).discoveryUrl;
  if (!discoveryUrl) throw new Error("config.pool.discoveryUrl is required for channel discovery");

  const { pathToFileURL } = await import("node:url");
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const sdk = (await import(pathToFileURL(`${poolCfg.sdkPath}/sdk/dist/index.js`).href)) as any;

  const opts = discoveryOptions({
    discoveryUrl,
    ohttp: (poolCfg as { ohttp?: boolean }).ohttp,
  });
  const provider = new sdk.IndexerDiscoveryProvider(opts.url, poolCfg.poolAddress, {
    ohttp: opts.ohttp,
  });
  const transfers = sdk.createPrivateTransfers({
    poolAddress: poolCfg.poolAddress,
    discoveryProvider: provider,
    viewingKeyProvider: { getViewingKey: async () => viewingKey },
    ...(poolCfg.provingUrl ? { provingUrl: poolCfg.provingUrl } : {}),
  });

  const channels: DiscoveredChannel[] = [];
  let cursor: unknown;
  let timestamp: unknown;
  for (;;) {
    const page = await transfers.discoverChannels("all", cursor ? { cursor } : {});
    timestamp = page.timestamp;
    if (page.channels) {
      for (const [peer, ch] of page.channels.entries?.() ?? Object.entries(page.channels)) {
        channels.push({
          peer: String(peer),
          channelKey: "0x" + BigInt(ch.key ?? ch.channelKey).toString(16),
          direction: ch.direction === "outgoing" ? "out" : "in",
        });
      }
    }
    const next = (page as { cursor?: unknown }).cursor;
    if (!next || (page.channels && Object.keys(page.channels).length === 0)) break;
    cursor = next;
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { channels, timestamp };
}
