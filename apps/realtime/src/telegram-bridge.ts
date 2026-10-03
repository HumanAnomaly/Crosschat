import fs from "node:fs";
import type { ChatMessage } from "@crosschat/core";
import { findConnectionById } from "./db.js";
import { config } from "./env.js";
import { originalFilename, storedFileFor } from "./bridge-files.js";

/** Bot API ceiling for uploads we forward, not a tunable. */
const MAX_FORWARD_BYTES = 50 * 1024 * 1024;

function botApiUrl(method: string): string {
  return `https://api.telegram.org/bot${config.telegramBotToken}/${method}`;
}

function extractTelegramMessageId(body: unknown): string | null {
  const r = body as { ok?: boolean; result?: { message_id?: unknown } } | null;
  if (r && typeof r === "object" && r.result && typeof r.result.message_id !== "undefined") {
    return String(r.result.message_id);
  }
  return null;
}

export async function notifyTelegram(
  connectionId: string,
  message: ChatMessage,
): Promise<{ telegramMessageId: string | null }> {
  if (!config.telegramBotToken) return { telegramMessageId: null };
  const connection = findConnectionById(connectionId);
  if (!connection) return { telegramMessageId: null };
  const chatId = connection.telegram_chat_id;
  try {
    if (message.kind === "text" || !message.mediaPath) {
      const res = await fetch(botApiUrl("sendMessage"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: message.text ?? "(media)" }),
      });
      if (!res.ok) return { telegramMessageId: null };
      const id = extractTelegramMessageId(await res.json().catch(() => null));
      return { telegramMessageId: id };
    }
    const stored = storedFileFor(connectionId, message);
    if (!stored || !fs.existsSync(stored)) {
      await fetch(botApiUrl("sendMessage"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: message.text ?? "(media unavailable)" }),
      });
      return { telegramMessageId: null };
    }
    const stat = await fs.promises.stat(stored);
    if (stat.size > MAX_FORWARD_BYTES) {
      console.error(`notifyTelegram: file too large to forward (${stat.size} bytes)`);
      return { telegramMessageId: null };
    }

    const blob = await fs.openAsBlob(stored, { type: message.mime ?? "application/octet-stream" });
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("caption", (message.text ?? "").slice(0, 1024));
    let method =
      message.kind === "photo" ? "sendPhoto" : message.kind === "video" ? "sendVideo" : "sendDocument";
    let field =
      message.kind === "photo" ? "photo" : message.kind === "video" ? "video" : "document";
    if (message.kind === "sticker") {
      method = "sendSticker";
      field = "sticker";
    }
    form.append(field, blob, originalFilename(message));
    let res = await fetch(botApiUrl(method), { method: "POST", body: form });
    if (!res.ok && method === "sendSticker") {
      const retry = new FormData();
      retry.append("chat_id", chatId);
      retry.append("caption", (message.text ?? "").slice(0, 1024));
      retry.append("document", blob, originalFilename(message));
      res = await fetch(botApiUrl("sendDocument"), { method: "POST", body: retry });
      if (!res.ok) {
        console.error(`notifyTelegram: sendSticker/sendDocument failed with ${res.status}`);
        return { telegramMessageId: null };
      }
      return { telegramMessageId: extractTelegramMessageId(await res.json().catch(() => null)) };
    }
    if (!res.ok) {
      console.error(`notifyTelegram: ${method} failed with ${res.status}`);
      return { telegramMessageId: null };
    }
    return { telegramMessageId: extractTelegramMessageId(await res.json().catch(() => null)) };
  } catch (err) {
    console.error("notifyTelegram failed", err);
    return { telegramMessageId: null };
  }
}

/** Best-effort removal of a previously forwarded web message on Telegram. */
export async function deleteTelegramMessage(chatId: string, telegramMessageId: string): Promise<boolean> {
  if (!config.telegramBotToken) return false;
  try {
    const res = await fetch(botApiUrl("deleteMessage"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: Number(telegramMessageId) || telegramMessageId }),
    });
    return res.ok;
  } catch (err) {
    console.error("deleteTelegramMessage failed", err);
    return false;
  }
}
