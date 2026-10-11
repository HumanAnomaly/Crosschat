import type { IncomingMessage, ServerResponse } from "node:http";
import { createLogger } from "@crosschat/core";
import { whatsappConfig } from "./config.js";
import { translate } from "./i18n.js";
import { fetchLinkStatus, markUnwired, markWired } from "./wired.js";
import type { AnyClient } from "./client.js";

const log = createLogger("whatsapp");

function t(key: string, vars?: Record<string, string | number>): string {
  return translate(whatsappConfig.locale, key, vars);
}

export async function handleDisconnect(client: AnyClient | null, chatId: string, reply: (text: string) => Promise<void>): Promise<void> {
  if (!chatId) return;
  let confirmed = false;
  try {
    const res = await fetch(`${whatsappConfig.realtimeUrl}/api/pair/disconnect`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bot-secret": whatsappConfig.webhookSecret },
      body: JSON.stringify({ whatsappChatId: chatId, platformId: "whatsapp" }),
    });
    confirmed = res.ok || res.status === 404;
  } catch {
    confirmed = false;
  }
  if (!confirmed) {
    await reply(t("disconnect.incomplete"));
    return;
  }
  markUnwired(chatId);
  await reply(t("disconnect.done"));
}

export async function notifyWebDisconnect(client: AnyClient | null, chatId: string): Promise<void> {
  markUnwired(chatId);
  if (!client) return;
  try {
    await client.message.send(chatId, t("disconnect.fromWeb"));
  } catch (err) {
    log.error("notify disconnect failed", err);
  }
}

export async function notifyWebClaim(client: AnyClient | null, chatId: string): Promise<void> {
  const status = await fetchLinkStatus(chatId);
  if (!status?.wired) return;
  markWired(chatId);
  if (!client) return;
  const name = status.user?.name?.trim();
  const email = status.user?.email?.trim();
  const account = name && email ? `${name} (${email})` : (name || email || t("wired.unknownAccount"));
  try {
    await client.message.send(chatId, t("wired.linked", { account }));
  } catch (err) {
    log.error("notify claim failed", err);
  }
}

function readBodyLimited(req: IncomingMessage, limit = 16_384): Promise<string> {
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

export async function handleNotify(
  client: AnyClient | null,
  req: IncomingMessage,
  res: ServerResponse,
  kind: "disconnect" | "linked",
): Promise<void> {
  const secret = whatsappConfig.webhookSecret;
  if (!secret || req.headers["x-bot-secret"] !== secret) {
    res.writeHead(401);
    res.end("unauthorized");
    return;
  }
  try {
    const data = JSON.parse(await readBodyLimited(req)) as { chatId?: unknown };
    if (typeof data.chatId !== "string" || data.chatId.length === 0) throw new Error("bad chatId");
    if (kind === "disconnect") await notifyWebDisconnect(client, data.chatId);
    else await notifyWebClaim(client, data.chatId);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } catch {
    res.writeHead(400);
    res.end("bad request");
  }
}
