import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Bot } from "grammy";
import { telegramConfig } from "./config.js";
import { translate } from "./i18n.js";
import {
  fetchLinkStatus,
  handleCodeInput,
  handleCreateCode,
  handleWiredRequest,
  isWired,
  markUnwired,
  markWired,
  wiredKeyboard,
  type LinkStatus,
} from "./wired.js";
import { handleDeleteCommand, handleInbound } from "./bridge.js";
import { createNotifyHandler, createLinkedHandler, handleDisconnect } from "./disconnect.js";

if (!telegramConfig.token) {
  console.error("TELEGRAM_BOT_TOKEN is empty. Fill in the env file and restart.");
  process.exit(1);
}

const bot = new Bot(telegramConfig.token);

function t(key: string, vars?: Record<string, string | number>): string {
  return translate(telegramConfig.locale, key, vars);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function accountOf(status: LinkStatus): string {
  const name = status.user?.name?.trim();
  const email = status.user?.email?.trim();
  if (name && email) return `${name} (${email})`;
  return name || email || "—";
}

function statusText(status: LinkStatus): string {
  return t("status.wired", {
    account: accountOf(status),
    since: fmtDate(status.connection?.createdAt),
    total: status.stats?.total ?? 0,
    fromWeb: status.stats?.fromWeb ?? 0,
    fromTelegram: status.stats?.fromTelegram ?? 0,
    last: fmtDate(status.stats?.lastMessageAt),
    mode: telegramConfig.mode,
  });
}

bot.command("start", async (ctx) => {
  const chatId = String(ctx.chat.id);
  const status = await fetchLinkStatus(chatId);
  const wired = status ? status.wired : isWired(chatId);
  if (status && status.wired) markWired(chatId);
  if (status && !status.wired && isWired(chatId)) markUnwired(chatId);
  if (wired && status?.wired) {
    await ctx.reply(statusText(status), { reply_markup: wiredKeyboard(true) });
  } else {
    await ctx.reply(t(wired ? "start.connected" : "start.hello"), {
      reply_markup: wiredKeyboard(wired),
    });
  }
});

bot.command("status", async (ctx) => {
  const chatId = String(ctx.chat.id);
  const status = await fetchLinkStatus(chatId);
  if (!status) {
    const wired = isWired(chatId);
    await ctx.reply(t(wired ? "status.offlineWired" : "status.offlineUnwired"), {
      reply_markup: wiredKeyboard(wired),
    });
    return;
  }
  if (!status.wired) {
    if (isWired(chatId)) markUnwired(chatId);
    await ctx.reply(t("status.unwired"), { reply_markup: wiredKeyboard(false) });
    return;
  }
  markWired(chatId);
  await ctx.reply(statusText(status), { reply_markup: wiredKeyboard(true) });
});

bot.command("help", async (ctx) => {
  await ctx.reply(t("help.text"), { reply_markup: wiredKeyboard(isWired(String(ctx.chat.id))) });
});

bot.callbackQuery("wire", async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleWiredRequest(ctx);
});

bot.callbackQuery("unwire", async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleDisconnect(ctx);
});

bot.callbackQuery("newcode", async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleCreateCode(ctx);
});

bot.command("delete", async (ctx) => {
  try {
    await handleDeleteCommand(ctx);
  } catch (err) {
    console.error("delete failed:", err);
  }
});

bot.on("message", async (ctx) => {
  try {
    if (await handleDeleteCommand(ctx)) return;
    const msg = ctx.msg;
    if ("text" in msg && typeof msg.text === "string") {
      if (await handleCodeInput(ctx, msg.text)) return;
    }
    await handleInbound(ctx);
  } catch (err) {
    console.error("update failed:", err);
  }
});

bot.catch((err) => console.error("bot error:", err.message));

const notifyHandler = createNotifyHandler(bot);
const linkedHandler = createLinkedHandler(bot);

function readBody(req: IncomingMessage, limit = 1_000_000): Promise<string> {
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

async function handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (telegramConfig.webhookSecret && req.headers["x-telegram-bot-api-secret-token"] !== telegramConfig.webhookSecret) {
    res.writeHead(401);
    res.end("unauthorized");
    return;
  }
  try {
    const update = JSON.parse(await readBody(req));
    await bot.handleUpdate(update);
    res.writeHead(200);
    res.end("ok");
  } catch (err) {
    console.error("webhook failed:", err);
    res.writeHead(400);
    res.end("bad request");
  }
}

const server = createServer((req, res) => {
  void (async () => {
    if (req.method === "POST" && req.url === "/api/telegram/webhook") {
      if (telegramConfig.mode !== "webhook") {
        res.writeHead(404);
        res.end("polling mode");
        return;
      }
      await handleWebhook(req, res);
      return;
    }
    if (req.method === "POST" && req.url === "/notify/disconnect") {
      await notifyHandler(req, res);
      return;
    }
    if (req.method === "POST" && req.url === "/notify/linked") {
      await linkedHandler(req, res);
      return;
    }
    if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, mode: telegramConfig.mode }));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  })();
});

server.listen(telegramConfig.port, () => {
  void (async () => {
    process.stdout.write(`telegram service on :${telegramConfig.port} mode=${telegramConfig.mode}\n`);
    if (telegramConfig.mode === "webhook") {
      try {
        const extra: { secret_token?: string; drop_pending_updates?: boolean } = {
          drop_pending_updates: true,
        };
        if (telegramConfig.webhookSecret) extra.secret_token = telegramConfig.webhookSecret;
        await bot.api.setWebhook(`${telegramConfig.appUrlProd}/api/telegram/webhook`, extra);
        process.stdout.write(`webhook registered: ${telegramConfig.appUrlProd}/api/telegram/webhook\n`);
      } catch (err) {
        console.error("setWebhook failed:", err);
      }
    } else {
      try {
        await bot.api.deleteWebhook({ drop_pending_updates: true });
      } catch (err) {
        console.error("deleteWebhook failed:", err);
      }
      void bot.start();
      process.stdout.write("polling started.\n");
    }
  })();
});
