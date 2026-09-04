#!/usr/bin/env node
import { formatAge, readMessages, sendMessage } from "./commands.js";
import { configDir, loadConfig, saveConfig, type CliConfig } from "./config.js";
import type { Bucket } from "@strk20-messaging/sdk";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i]!.startsWith("--")) i++;
    else out.push(args[i]!);
  }
  return out;
}

const USAGE = `msg — encrypted messaging over the STRK20 privacy pool

  msg init --rpc <url> --helper <addr> --account <addr> [--mode direct|pool]
  msg channel add --label <name> --peer <addr> --key <channel key hex>
  msg channel list
  msg send --to <label|addr> [--pad 256|1024|4096] "text"
  msg read

Config lives in ${configDir()} (override with STRK20_MSG_HOME).
Private key: env STRK20_MSG_PRIVATE_KEY, or account.privateKey in config.json.`;

async function main(argv: string[]): Promise<number> {
  const [cmd, ...args] = argv;
  switch (cmd) {
    case "init": {
      const rpc = flag(args, "rpc");
      const helper = flag(args, "helper");
      const account = flag(args, "account");
      if (!rpc || !helper || !account) {
        console.error("init needs --rpc, --helper, --account");
        return 2;
      }
      const cfg: CliConfig = {
        rpcUrl: rpc,
        helperAddress: helper,
        mode: (flag(args, "mode") as CliConfig["mode"]) ?? "pool",
        account: { address: account },
        channels: [],
      };
      saveConfig(cfg);
      console.log(`wrote ${configDir()}/config.json (mode: ${cfg.mode})`);
      return 0;
    }

    case "channel": {
      const [sub] = positional(args);
      const cfg = loadConfig();
      if (sub === "add") {
        const label = flag(args, "label");
        const peer = flag(args, "peer");
        const key = flag(args, "key");
        if (!label || !peer || !key) {
          console.error("channel add needs --label, --peer, --key");
          return 2;
        }
        cfg.channels = cfg.channels.filter((c) => c.label !== label);
        cfg.channels.push({ label, peer, channelKey: key });
        saveConfig(cfg);
        console.log(`channel "${label}" -> ${peer} added`);
        return 0;
      }
      if (sub === "list") {
        for (const c of cfg.channels) console.log(`${c.label}\t${c.peer}\tkey: [redacted]`);
        if (cfg.channels.length === 0) console.log("(no channels)");
        return 0;
      }
      console.error("unknown channel subcommand; use add or list");
      return 2;
    }

    case "send": {
      const to = flag(args, "to");
      const pad = flag(args, "pad");
      const [text] = positional(args);
      if (!to || text === undefined) {
        console.error('send needs --to and the message text: msg send --to bob "hello"');
        return 2;
      }
      await sendMessage(to, text, {
        padTo: pad ? (Number(pad) as Bucket) : undefined,
        log: (l) => console.log(l),
      });
      return 0;
    }

    case "read": {
      const results = await readMessages();
      if (results.length === 0) {
        console.log("no new messages");
        return 0;
      }
      let n = 0;
      for (const r of results) {
        for (const m of r.messages) {
          n++;
          const sender = "0x" + m.frame.sender.toString(16);
          const body = new TextDecoder().decode(m.frame.body);
          console.log(`[${n}] from ${sender} · ${formatAge(m.frame.timestamp)} · "${body}"`);
        }
      }
      return 0;
    }

    default:
      console.log(USAGE);
      return cmd === undefined || cmd === "help" || cmd === "--help" ? 0 : 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(`error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
);
