import fs from "node:fs";
import path from "node:path";
import type { ChatMessage } from "@crosschat/core";
import { findConnectionById, findMessageById } from "./db.js";
import { config } from "./env.js";
import { resolveStoredMediaPath } from "./security.js";

/** Bot API ceiling for uploads we forward, not a tunable. */
const MAX_FORWARD_BYTES = 50 * 1024 * 1024;

function botApiUrl(method: string): string {
  return `https://api.telegram.org/bot${config.telegramBotToken}/${method}`;
}

/**
 * Resolve the on-disk file for a chat message. `connectionId` comes from the
 * trusted caller (the DB row we just inserted), never from the payload. The
 * payload's own connectionId is client-influenced and must not be trusted for
 * authorization.
 */
function storedFileFor(connectionId: string, message: ChatMessage): string | null {
  if (!message.mediaPath) return null;
  if (message.mediaPath.startsWith("/media/")) {
    const id = message.mediaPath.slice("/media/".length).split("/")[0];
    if (!id) return null;
    const meta = findMessageById(id);
    if (!meta?.media_path || meta.connection_id !== connectionId) return null;
    return resolveStoredMediaPath(meta.media_path);
  }
  const abs = resolveStoredMediaPath(message.mediaPath);
  if (!abs) return null;

  const rel = abs.slice(path.resolve(config.mediaDir).length + 1).replace(/\\/g, "/");
  return rel.startsWith(`${connectionId}/`) ? abs : null;
}

function originalFilename(connectionId: string, message: ChatMessage): string {
  if (message.mediaPath?.startsWith("/media/")) {
    const id = message.mediaPath.slice("/media/".length).split("/")[0];
    const meta = id ? findMessageById(id) : undefined;
    if (meta?.media_path) {
      const base = meta.media_path.replace(/\\/g, "/").split("/").pop() ?? "file";

      const dash = base.indexOf("-");
      const name = dash >= 0 ? base.slice(dash + 1) : base;
      if (name) return name;
    }
  }
  return "file";
}

function extractTelegramMessageId(body: unknown): string | null {
  try {
    const r = body as { ok?: boolean; result?: { message_id?: unknown } };
    if (r && typeof r === "object" && r.result && typeof r.result.message_id !== "undefined") {
      return String(r.result.message_id);
    }
  } catch (err) {
    console.error("telegram message id parse failed", err);
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
    const mimeBase = (message.mime ?? "").split(";")[0].trim().toLowerCase();
    void mimeBase;
    let method =
      message.kind === "photo" ? "sendPhoto" : message.kind === "video" ? "sendVideo" : "sendDocument";
    let field =
      message.kind === "photo" ? "photo" : message.kind === "video" ? "video" : "document";
    if (message.kind === "sticker") {
      method = "sendSticker";
      field = "sticker";
    }
    form.append(field, blob, originalFilename(connectionId, message) || "file");
    let res = await fetch(botApiUrl(method), { method: "POST", body: form });
    if (!res.ok && method === "sendSticker") {
      const retry = new FormData();
      retry.append("chat_id", chatId);
      retry.append("caption", (message.text ?? "").slice(0, 1024));
      retry.append("document", blob, originalFilename(connectionId, message) || "file");
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
