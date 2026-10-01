import type { IncomingMessage, ServerResponse } from "node:http";
import type { Client, Message } from "discord.js";
import { discordConfig } from "./config.js";
import { translate } from "./i18n.js";
import { fetchLinkStatus, markUnwired, markWired } from "./wired.js";

function t(key: string, vars?: Record<string, string | number>): string {
  return translate(discordConfig.locale, key, vars);
}

export async function handleDisconnect(userId: string, reply: (text: string) => Promise<void>): Promise<void> {
  if (!userId) return;
  let confirmed = false;
  try {
    const res = await fetch(`${discordConfig.realtimeUrl}/api/pair/disconnect`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bot-secret": discordConfig.webhookSecret,
      },
      body: JSON.stringify({ discordChatId: userId, platformId: "discord" }),
    });
    confirmed = res.ok || res.status === 404;
  } catch {
    confirmed = false;
  }
  if (!confirmed) {
    await reply(t("disconnect.incomplete"));
    return;
  }
  markUnwired(userId);
  await reply(t("disconnect.done"));
}

export async function notifyWebDisconnect(client: Client, chatId: string): Promise<void> {
  markUnwired(chatId);
  try {
    const user = await client.users.fetch(chatId);
    await user.send(t("disconnect.fromWeb"));
  } catch {

  }
}

export async function notifyWebClaim(client: Client, chatId: string): Promise<void> {
  const status = await fetchLinkStatus(chatId);
  if (!status?.wired) return;
  markWired(chatId);
  const name = status.user?.name?.trim();
  const email = status.user?.email?.trim();
  const account = name && email ? `${name} (${email})` : (name || email || t("wired.unknownAccount"));
  try {
    const user = await client.users.fetch(chatId);
    await user.send(t("wired.linked", { account }));
  } catch {

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

async function handleNotify(
  client: Client,
  req: IncomingMessage,
  res: ServerResponse,
  kind: "disconnect" | "linked",
): Promise<void> {
  const secret = discordConfig.webhookSecret;
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

export function createNotifyHandler(client: Client) {
  return (req: IncomingMessage, res: ServerResponse): Promise<void> =>
    handleNotify(client, req, res, "disconnect");
}

export function createLinkedHandler(client: Client) {
  return (req: IncomingMessage, res: ServerResponse): Promise<void> =>
    handleNotify(client, req, res, "linked");
}

/** Legacy `!name` prefix check. Slash commands are primary now; this only
 * detects old-style input so the bot can nudge users toward `/help`. */
export function isCommand(message: Message, name: string): boolean {
  const text = message.content.trim().toLowerCase();
  return text === `!${name}` || text.startsWith(`!${name} `);
}
