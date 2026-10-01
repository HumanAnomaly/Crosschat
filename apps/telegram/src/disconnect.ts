import type { IncomingMessage, ServerResponse } from "node:http";
import type { Bot, Context } from "grammy";
import { telegramConfig } from "./config.js";
import { translate } from "./i18n.js";
import { fetchLinkStatus, markUnwired, markWired, wiredKeyboard } from "./wired.js";

function t(key: string, vars?: Record<string, string | number>): string {
  return translate(telegramConfig.locale, key, vars);
}

export async function handleDisconnect(ctx: Context): Promise<void> {
  const chatId = ctx.chat ? String(ctx.chat.id) : "";
  if (!chatId) return;

  let confirmed = false;
  try {
    const res = await fetch(`${telegramConfig.realtimeUrl}/api/pair/disconnect`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bot-secret": telegramConfig.webhookSecret,
      },
      body: JSON.stringify({ telegramChatId: chatId }),
    });
    confirmed = res.ok || res.status === 404;
  } catch {
    confirmed = false;
  }
  if (!confirmed) {
    await ctx.reply(t("disconnect.incomplete"), { reply_markup: wiredKeyboard(true) });
    return;
  }
  markUnwired(chatId);
  await ctx.reply(t("disconnect.done"), { reply_markup: wiredKeyboard(false) });
}

export async function notifyWebDisconnect(bot: Bot, chatId: string): Promise<void> {
  markUnwired(chatId);
  await bot.api.sendMessage(chatId, t("disconnect.fromWeb"), {
    reply_markup: wiredKeyboard(false),
  });
}

export async function notifyWebClaim(bot: Bot, chatId: string): Promise<void> {
  const status = await fetchLinkStatus(chatId);
  if (!status?.wired) return;
  markWired(chatId);
  const name = status.user?.name?.trim();
  const email = status.user?.email?.trim();
  const account = name && email ? `${name} (${email})` : (name || email || t("wired.unknownAccount"));
  await bot.api.sendMessage(chatId, t("wired.linked", { account }), {
    reply_markup: wiredKeyboard(true),
  });
}

export function createNotifyHandler(bot: Bot) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const secret = telegramConfig.webhookSecret;
    if (!secret || req.headers["x-bot-secret"] !== secret) {
      res.writeHead(401);
      res.end("unauthorized");
      return;
    }
    let body = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += (chunk as Buffer).length ?? String(chunk).length;
      if (size > 16_384) {
        res.writeHead(413);
        res.end("payload too large");
        req.destroy();
        return;
      }
      body += String(chunk);
    });
    await new Promise<void>((resolve, reject) => {
      req.on("end", () => resolve());
      req.on("error", reject);
    });
    try {
      const data = JSON.parse(body) as { chatId?: unknown };
      if (typeof data.chatId !== "string" || data.chatId.length === 0) {
        throw new Error("bad chatId");
      }
      await notifyWebDisconnect(bot, data.chatId);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400);
      res.end("bad request");
    }
  };
}

export function createLinkedHandler(bot: Bot) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const secret = telegramConfig.webhookSecret;
    if (!secret || req.headers["x-bot-secret"] !== secret) {
      res.writeHead(401);
      res.end("unauthorized");
      return;
    }
    let body = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += (chunk as Buffer).length ?? String(chunk).length;
      if (size > 16_384) {
        res.writeHead(413);
        res.end("payload too large");
        req.destroy();
        return;
      }
      body += String(chunk);
    });
    await new Promise<void>((resolve, reject) => {
      req.on("end", () => resolve());
      req.on("error", reject);
    });
    try {
      const data = JSON.parse(body) as { chatId?: unknown };
      if (typeof data.chatId !== "string" || data.chatId.length === 0) {
        throw new Error("bad chatId");
      }
      await notifyWebClaim(bot, data.chatId);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400);
      res.end("bad request");
    }
  };
}
