import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import qrcode from "qrcode-terminal";
import { createLogger, printBanner } from "@crosschat/core";
import { whatsappConfig } from "./config.js";
import { translate } from "./i18n.js";
import { createWhatsappClient, type AnyClient } from "./client.js";
import { sessionStatus } from "./session.js";
import { handleInbound, extractText } from "./bridge.js";
import {
  fetchLinkStatus,
  handleCodeInput,
  handleCreateCode,
  handleWiredRequest,
  isWired,
  markUnwired,
  markWired,
  usernameOf,
} from "./wired.js";
import { handleDisconnect, handleNotify } from "./disconnect.js";
import { handleAnon, handleAnonNotify, handleNext, handleStop } from "./anon.js";

const log = createLogger("whatsapp");

function t(key: string, vars?: Record<string, string | number>): string {
  return translate(whatsappConfig.locale, key, vars);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

let waClient: AnyClient | null = null;
let waActive = false;
let waAccount: string | null = null;
let reconnecting = false;
let stopReconnect = false;

// Disconnect reasons zapo classifies as fatal (docs: errors & disconnects).
// These need re-pairing or a zapo upgrade; retrying connect() only spins.
const FATAL_DISCONNECT_REASONS = new Set([
  "stream_error_replaced",
  "stream_error_device_removed",
  "stream_error_force_logout",
  "failure_not_authorized",
  "failure_banned",
  "failure_locked",
  "failure_client_too_old",
  "failure_bad_user_agent",
  "primary_identity_key_change",
]);

function isFatalClose(event: any): boolean {
  return Boolean(event?.isLogout) || FATAL_DISCONNECT_REASONS.has(event?.reason);
}

function describeClose(event: any): string {
  const reason = event?.reason ?? "unknown";
  return event?.code != null ? `${reason} (code ${event.code})` : String(reason);
}

function readBody(req: IncomingMessage, limit = 35_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = "";
    req.on("data", (chunk) => {
      size += (chunk as Buffer).length ?? String(chunk).length;
      if (size > limit) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      body += String(chunk);
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function checkSecret(req: IncomingMessage): boolean {
  const secret = whatsappConfig.webhookSecret;
  if (!secret) return false;
  return req.headers["x-bot-secret"] === secret;
}

async function handleSend(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!checkSecret(req)) {
    res.writeHead(401);
    res.end("unauthorized");
    return;
  }
  if (!waClient || !waActive) {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "whatsapp session inactive" }));
    return;
  }
  try {
    const body = JSON.parse(await readBody(req)) as {
      chatId?: unknown;
      kind?: unknown;
      text?: unknown;
      mime?: unknown;
      filename?: unknown;
      fileBase64?: unknown;
    };
    const chatId = typeof body.chatId === "string" ? body.chatId : "";
    if (!chatId) throw new Error("bad chatId");
    const kind = typeof body.kind === "string" ? body.kind : "text";
    const text = typeof body.text === "string" ? body.text.slice(0, 4000) : "";
    let result: { id?: unknown } | null = null;
    if (kind === "text" || typeof body.fileBase64 !== "string" || !body.fileBase64) {
      result = await waClient.message.send(chatId, text || "(media)");
    } else {
      const buf = Buffer.from(body.fileBase64, "base64");
      const media = new Uint8Array(buf);
      const mime = typeof body.mime === "string" && body.mime ? body.mime : "application/octet-stream";
      const filename = typeof body.filename === "string" && body.filename ? body.filename : "file";
      if (kind === "photo") {
        result = await waClient.message.send(chatId, { type: "image", media, mimetype: mime, caption: text });
      } else if (kind === "video") {
        result = await waClient.message.send(chatId, { type: "video", media, mimetype: mime, caption: text });
      } else if (kind === "voice") {
        result = await waClient.message.send(chatId, { type: "audio", media, mimetype: mime, ptt: true });
      } else if (kind === "sticker") {
        result = await waClient.message.send(chatId, { type: "sticker", media, mimetype: mime });
      } else {
        result = await waClient.message.send(chatId, { type: "document", media, mimetype: mime, fileName: filename, caption: text });
      }
    }
    const id = result && typeof result.id === "string" ? result.id : null;    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, whatsappMessageId: id, id }));
  } catch (err) {
    log.error("send failed", err);
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "send failed" }));
  }
}

async function handleDelete(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!checkSecret(req)) {
    res.writeHead(401);
    res.end("unauthorized");
    return;
  }
  try {
    const body = JSON.parse(await readBody(req, 64_000)) as { chatId?: unknown; whatsappMessageId?: unknown; platformMsgId?: unknown };
    const chatId = typeof body.chatId === "string" ? body.chatId : "";
    const msgId =
      typeof body.whatsappMessageId === "string"
        ? body.whatsappMessageId
        : typeof body.platformMsgId === "string"
          ? body.platformMsgId
          : "";
    if (!chatId || !msgId) throw new Error("bad payload");
    if (waClient && waActive) {
      try {
        await waClient.message.send(chatId, {
          type: "revoke",
          target: { remoteJid: chatId, id: msgId, fromMe: true },
        });
      } catch (err) {
        log.error("revoke failed", err);
      }
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } catch {
    res.writeHead(400);
    res.end("bad request");
  }
}

async function handleTextCommand(chatId: string, raw: string): Promise<boolean> {
  const username = usernameOf(chatId);
  const target = {
    chatId,
    username,
    reply: async (text: string) => {
      if (waClient && waActive) await waClient.message.send(chatId, text);
    },
  };
  const text = raw.trim();
  // Commands need a prefix (/, ! or .) so normal chat is never hijacked.
  // Pairing codes (XXXX-XXXX) stay prefix-free while a claim is pending.
  const cmd = text.replace(/^[/!.]/, "").trim().toLowerCase();
  const prefixed = /^[/!.]/.test(text);
  if (!prefixed) {
    if (await handleCodeInput(target, raw)) return true;
    return false;
  }
  if (cmd === "wired") {
    await handleWiredRequest(target);
    return true;
  }
  if (cmd === "newcode" || cmd === "new code" || cmd === "new-code") {
    await handleCreateCode(target);
    return true;
  }
  if (cmd === "status") {
    const status = await fetchLinkStatus(chatId);
    if (!status) {
      await target.reply(t(isWired(chatId) ? "status.offlineWired" : "status.offlineUnwired"));
      return true;
    }
    if (!status.wired) {
      if (isWired(chatId)) markUnwired(chatId);
      await target.reply(t("status.unwired"));
      return true;
    }
    markWired(chatId);
    const account = status.user?.name || status.user?.email || t("wired.unknownAccount");
    await target.reply(
      t("status.wired", {
        account,
        since: fmtDate(status.connection?.createdAt),
        total: status.stats?.total ?? 0,
        fromWeb: status.stats?.fromWeb ?? 0,
        fromWhatsapp: status.stats?.fromWhatsapp ?? status.stats?.fromTelegram ?? 0,
        last: fmtDate(status.stats?.lastMessageAt),
      }),
    );
    return true;
  }
  if (cmd === "help" || cmd === "menu" || cmd === "start") {
    await target.reply(t("help.text"));
    return true;
  }
  if (cmd === "disconnect" || cmd === "unwire") {
    await handleDisconnect(waClient, chatId, target.reply);
    return true;
  }
  if (cmd === "anon") {
    await handleAnon(chatId, username, target.reply);
    return true;
  }
  if (cmd === "next") {
    await handleNext(chatId, username, target.reply);
    return true;
  }
  if (cmd === "stop") {
    await handleStop(chatId, username, target.reply);
    return true;
  }
  if (cmd === "delete") {
    await target.reply(t("delete.notFound"));
    return true;
  }
  if (await handleCodeInput(target, raw)) return true;
  return false;
}

async function startClient(): Promise<void> {
  stopReconnect = false;
  const status = sessionStatus(whatsappConfig.session);
  if (!status.active) {
    waActive = false;
    if (status.exists && status.looksValid && !status.paired) {
      log.warn(
        `session '${whatsappConfig.session}' exists but was never paired (${status.file}). WhatsApp inactive. Run: pnpm --filter @crosschat/whatsapp session:add ${whatsappConfig.session}`,
      );
    } else if (status.exists) {
      log.warn(
        `session '${whatsappConfig.session}' looks broken (${status.file}, ${status.size} bytes). WhatsApp inactive. Run: pnpm --filter @crosschat/whatsapp session:add ${whatsappConfig.session}`,
      );
    } else {
      log.warn(
        `no session '${whatsappConfig.session}' (${status.file}). WhatsApp inactive. Run: pnpm --filter @crosschat/whatsapp session:add ${whatsappConfig.session}`,
      );
    }
    return;
  }
  try {
    const { client } = await createWhatsappClient(whatsappConfig.session);
    waClient = client;

    client.on("auth_qr", ({ qr, ttlMs }: { qr: string; ttlMs: number }) => {
      log.warn(`scan this QR in WhatsApp > Linked devices (valid ~${Math.round(ttlMs / 1000)}s):`);
      try {
        qrcode.generate(qr, { small: true });
      } catch {
        process.stdout.write(`${qr}\n`);
      }
    });
    client.on("auth_pairing_code", ({ code }: { code: string }) => {
      log.success(`pairing code: ${code.slice(0, 4)}-${code.slice(4)} (enter in WhatsApp > Linked devices)`);
    });
    client.on("auth_paired", ({ credentials }: any) => {
      waAccount = credentials?.meJid ?? credentials?.me ?? "paired";
      log.success(`paired as ${waAccount}`);
    });
    client.on("connection", (event: any) => {
      if (event?.status === "open") {
        waActive = true;
        log.success(`connected${event?.isNewLogin ? " (new login)" : ""}`);
        return;
      }
      if (event?.status === "close") {
        waActive = false;
        if (event?.reason === "client_disconnected") return;
        if (isFatalClose(event)) {
          stopReconnect = true;
          waClient = null;
          if (event?.isLogout) log.error("logged out on WhatsApp. Re-pair required: session:add");
          else log.error(`fatal disconnect (${describeClose(event)}). Not reconnecting; fix and restart (re-pair or upgrade zapo).`);
          return;
        }
        log.warn(`disconnected (${describeClose(event)}). Reconnecting with backoff.`);
        void connectWithBackoff(client, "session");
      }
    });
    client.on("stream_failure", (event: any) => {
      const code = event?.failureCode != null ? `, code ${event.failureCode}` : "";
      log.warn(`stream failure (${event?.failureReason ?? "unknown"}${code})`);
    });
    client.on("stanza_error", (event: any) => {
      log.warn(`stanza error ${event?.code ?? "?"}: ${event?.text ?? "no detail"}`);
    });
    client.on("message", (event: any) => {
      void (async () => {
        try {
          const text = extractText(event?.message).trim();
          const chatId = event?.key?.remoteJid;
          const quoted = event?.message?.extendedTextMessage?.contextInfo;
          if (text && typeof chatId === "string" && !event?.key?.fromMe && !(event?.key?.isGroup || event?.key?.isBroadcast)) {
            if (/^[/!.]delete$/i.test(text) && quoted?.stanzaId) {
              try {
                await fetch(`${whatsappConfig.realtimeUrl}/api/whatsapp/delete`, {
                  method: "POST",
                  headers: { "content-type": "application/json", "x-bot-secret": whatsappConfig.webhookSecret },
                  body: JSON.stringify({ chatId, platformMsgId: String(quoted.stanzaId) }),
                });
                await client.message.send(chatId, t("delete.done"));
              } catch (err) {
                log.error("quote delete failed", err);
                await client.message.send(chatId, t("delete.notFound"));
              }
              return;
            }
            if (await handleTextCommand(chatId, text)) return;
          }
          await handleInbound(client, event);
        } catch (err) {
          log.error("message failed", err);
        }
      })();
    });

    if (await connectWithBackoff(client, "boot")) {
      waActive = true;
    } else {
      waActive = false;
      waClient = null;
      log.warn("WhatsApp inactive (connect failed). Pairing + /health stay up.");
    }
  } catch (err) {
    waActive = false;
    waClient = null;
    log.error("WhatsApp inactive (client init failed). Pair again with session:add.", err);
  }
}

const MAX_CONNECT_ATTEMPTS = 10;

/** Single-flight connect loop with exponential backoff (zapo docs: reconnection guide). */
async function connectWithBackoff(client: AnyClient, phase: "boot" | "session"): Promise<boolean> {
  if (reconnecting) return false;
  reconnecting = true;
  try {
    for (let attempt = 0; attempt < MAX_CONNECT_ATTEMPTS; attempt++) {
      if (!waClient || stopReconnect) return false;
      const delayMs = Math.min(30_000, 1_000 * 2 ** attempt);
      log.warn(`connecting in ${delayMs}ms (attempt ${attempt + 1}/${MAX_CONNECT_ATTEMPTS}, ${phase})`);
      await new Promise((r) => setTimeout(r, delayMs));
      try {
        await client.connect();
        return true;
      } catch (err) {
        log.error("connect failed", err);
      }
    }
    log.error(`giving up connecting after ${MAX_CONNECT_ATTEMPTS} attempts (${phase}). Restart service to retry.`);
    return false;
  } finally {
    reconnecting = false;
  }
}

const server = createServer((req, res) => {
  void (async () => {
    if (req.method === "POST" && req.url === "/api/whatsapp/send") {
      await handleSend(req, res);
      return;
    }
    if (req.method === "POST" && req.url === "/api/whatsapp/delete") {
      await handleDelete(req, res);
      return;
    }
    if (req.method === "POST" && req.url === "/notify/disconnect") {
      await handleNotify(waClient, req, res, "disconnect");
      return;
    }
    if (req.method === "POST" && req.url === "/notify/linked") {
      await handleNotify(waClient, req, res, "linked");
      return;
    }
    if (req.method === "POST" && req.url === "/notify/anon") {
      await handleAnonNotify(waClient, req, res);
      return;
    }
    if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, platform: "whatsapp", active: waActive, account: waAccount }));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  })();
});

server.listen(whatsappConfig.port, () => {
  printBanner("whatsapp", [
    ["port", String(whatsappConfig.port)],
    ["session", whatsappConfig.session],
    ["pairWithCode", String(whatsappConfig.pairWithCode)],
  ]);
  void startClient().then(() => {
    if (!waActive) log.warn("running inactive (no WA socket). Pairing + /health stay up.");
  });
});

async function shutdown(signal: string): Promise<void> {
  log.info(`${signal} received; flushing and closing WhatsApp session`);
  try {
    await waClient?.disconnect?.();
  } catch {
    /* noop */
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
