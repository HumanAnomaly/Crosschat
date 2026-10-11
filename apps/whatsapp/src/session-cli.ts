import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import qrcode from "qrcode-terminal";
import { createLogger, printHelp, printTable } from "@crosschat/core";
import { whatsappConfig } from "./config.js";
import { createWhatsappClient } from "./client.js";
import { ensureSessionDir, sessionFilePath, sessionStatus } from "./session.js";

const log = createLogger("whatsapp");

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function fmtCode(code: string): string {
  const compact = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (compact.length === 8) return `${compact.slice(0, 4)}-${compact.slice(4)}`;
  return code;
}

async function cmdAdd(name: string, flags: Set<string>, phoneFlag: string | null): Promise<void> {
  const st = sessionStatus(name);
  if (st.active && !flags.has("--force")) {
    log.warn(`session '${name}' already paired and active (${st.file}). Use --force to re-pair.`);
    process.exit(1);
  }
  if (st.exists && !st.paired) {
    try {
      fs.unlinkSync(st.file);
      log.warn(`removed stale unpaired session ${st.file} (pairing was never finished).`);
    } catch (err) {
      log.error("could not remove stale session", err);
      process.exit(1);
    }
  }
  if (flags.has("--force") && st.exists) {
    try {
      fs.unlinkSync(st.file);
      log.warn(`removed old session ${st.file}`);
    } catch {
      /* noop */
    }
  }
  ensureSessionDir();
  const qrOnly = flags.has("--qr-only");
  const codeOnly = flags.has("--code-only");
  const wantCode = whatsappConfig.pairWithCode && !qrOnly;
  const showQr = qrOnly || (!wantCode && !codeOnly);

  log.info(`pairing session '${name}'. On your phone: WhatsApp > Linked devices > Link a device.`);
  if (showQr) log.info("QR mode: scan the code below.");

  let phone = phoneFlag;
  if (wantCode && !phone) {
    phone = (await ask("Phone number with country code (digits only, e.g. 6281234567890): ")).replace(/\D/g, "");
    if (phone.length < 8 || phone.length > 15) {
      log.error("bad phone number. Pairing code needs 8-15 digits.");
      process.exit(1);
    }
  }

  const { client } = await createWhatsappClient(name);
  let lastRequested: string | null = null;

  client.on("auth_qr", ({ qr, ttlMs }: { qr: string; ttlMs: number }) => {
    if (!showQr) return;
    log.warn(`new QR (valid ~${Math.round(ttlMs / 1000)}s):`);
    try {
      qrcode.generate(qr, { small: true });
    } catch {
      process.stdout.write(`${qr}\n`);
    }
  });
  client.on("auth_pairing_code", ({ code }: { code: string }) => {
    if (code.replace(/[^A-Za-z0-9]/g, "") === (lastRequested ?? "").replace(/[^A-Za-z0-9]/g, "")) return;
    log.success(`enter this code in WhatsApp > Linked devices > Link with phone number: ${fmtCode(code)}`);
  });
  client.on("auth_paired", () => {
    log.success(`session '${name}' paired. Credentials saved to ${sessionFilePath(name)}.`);
  });
  client.on("auth_pairing_required", async () => {
    if (!wantCode || !phone) return;
    try {
      const code = await client.auth.requestPairingCode(phone);
      lastRequested = code;
      log.success(`enter this code in WhatsApp > Linked devices > Link with phone number: ${fmtCode(code)}`);
    } catch (err) {
      log.error("pairing code request failed", err);
    }
  });
  client.on("connection", (event: any) => {
    if (event?.status === "open") {
      log.success(`session '${name}' connected. Done.`);
      void client.disconnect().finally(() => process.exit(0));
    }
    if (event?.status === "close" && event?.isLogout) {
      log.error("logged out during pairing. Try again.");
      process.exit(1);
    }
  });

  process.on("SIGINT", () => {
    void client.disconnect().finally(() => process.exit(130));
  });

  await client.connect();
  if (wantCode && phone) {
    try {
      const code = await client.auth.requestPairingCode(phone);
      lastRequested = code;
      log.success(`enter this code in WhatsApp > Linked devices > Link with phone number: ${fmtCode(code)}`);
    } catch (err) {
      log.error("pairing code request failed (waiting for server prompt instead)", err);
    }
  }
}

function cmdList(): void {
  const dir = path.dirname(sessionFilePath(whatsappConfig.session));
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".sqlite"));
  } catch {
    files = [];
  }
  if (files.length === 0) {
    log.warn(`no sessions in ${dir}. Add one: pnpm --filter @crosschat/whatsapp session:add wa`);
    return;
  }
  const rows = files.map((f) => {
    const name = f.replace(/\.sqlite$/, "");
    const st = sessionStatus(name);
    return [name, st.active ? "active" : "broken", String(st.size), st.file];
  });
  printTable(["session", "status", "bytes", "file"], rows);
}

function cmdStatus(name: string | null): void {
  if (!name) {
    cmdList();
    return;
  }
  const st = sessionStatus(name);
  printTable(["field", "value"], [
    ["session", st.name],
    ["file", st.file],
    ["exists", String(st.exists)],
    ["bytes", String(st.size)],
    ["sqlite", String(st.looksValid)],
    ["paired", String(st.paired)],
    ["active", String(st.active)],
  ]);
  if (!st.active) {
    log.warn(`inactive. Run: pnpm --filter @crosschat/whatsapp session:add ${st.name}`);
  }
}

function cmdRemove(name: string): void {
  const st = sessionStatus(name);
  if (!st.exists) {
    log.warn(`session '${name}' not found (${st.file}).`);
    return;
  }
  fs.unlinkSync(st.file);
  log.success(`removed session '${name}' (${st.file}).`);
}

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith("--")));
const phoneFlag = (() => {
  const idx = rest.findIndex((a) => a === "--phone");
  return idx >= 0 && rest[idx + 1] ? rest[idx + 1].replace(/\D/g, "") : null;
})();
const positional = rest.filter((a) => !a.startsWith("--") && a !== phoneFlag);

if (!cmd || cmd === "--help" || cmd === "-h" || flags.has("--help")) {
  printHelp("whatsapp session", "pnpm --filter @crosschat/whatsapp session:<add|list|status|remove> [name] [flags]", [
    ["session:add [wa] [--phone 628..] [--qr-only] [--code-only] [--force]", "pair a new WA session (pairing code by default, QR only with --qr-only)"],
    ["session:list", "list stored WA sessions"],
    ["session:status [wa]", "check one session (missing/broken = inactive)"],
    ["session:remove <wa>", "delete a stored session"],
  ]);
  process.exit(0);
}

try {
  if (cmd === "add") await cmdAdd(positional[0] ?? whatsappConfig.session, flags, phoneFlag);
  else if (cmd === "list") cmdList();
  else if (cmd === "status") cmdStatus(positional[0] ?? whatsappConfig.session);
  else if (cmd === "remove") {
    const name = positional[0];
    if (!name) {
      log.error("session:remove needs a name");
      process.exit(1);
    }
    cmdRemove(name);
  } else {
    log.error(`unknown command '${cmd}'. Try: add | list | status | remove`);
    process.exit(1);
  }
} catch (err) {
  log.error("session command failed", err);
  process.exit(1);
}
