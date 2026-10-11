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

export interface DirectSendInput {
  kind: string;
  text?: string | null;
  mime?: string | null;
  /** Absolute on-disk file, or null for text. */
  fileAbsPath?: string | null;
  filename?: string | null;
}

/** Direct send to a Telegram chat without a web connection (P2P links). */
export async function sendTelegramToChat(
  chatId: string,
  input: DirectSendInput,
): Promise<{ telegramMessageId: string | null }> {
  if (!config.telegramBotToken) return { telegramMessageId: null };
  try {
    if (input.kind === "text" || !input.fileAbsPath) {
      const res = await fetch(botApiUrl("sendMessage"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: input.text ?? "(media)" }),
      });
      if (!res.ok) return { telegramMessageId: null };
      const id = extractTelegramMessageId(await res.json().catch(() => null));
      return { telegramMessageId: id };
    }
    if (!fs.existsSync(input.fileAbsPath)) {
      await fetch(botApiUrl("sendMessage"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: input.text ?? "(media unavailable)" }),
      });
      return { telegramMessageId: null };
    }
    const stat = await fs.promises.stat(input.fileAbsPath);
    if (stat.size > MAX_FORWARD_BYTES) {
      console.error(`sendTelegramToChat: file too large to forward (${stat.size} bytes)`);
      return { telegramMessageId: null };
    }
    const blob = await fs.openAsBlob(input.fileAbsPath, { type: input.mime ?? "application/octet-stream" });
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("caption", (input.text ?? "").slice(0, 1024));
    let method =
      input.kind === "photo" ? "sendPhoto" : input.kind === "video" ? "sendVideo" : "sendDocument";
    let field =
      input.kind === "photo" ? "photo" : input.kind === "video" ? "video" : "document";
    if (input.kind === "sticker") {
      method = "sendSticker";
      field = "sticker";
    }
    form.append(field, blob, input.filename ?? "file");
    let res = await fetch(botApiUrl(method), { method: "POST", body: form });
    if (!res.ok && method === "sendSticker") {
      const retry = new FormData();
      retry.append("chat_id", chatId);
      retry.append("caption", (input.text ?? "").slice(0, 1024));
      retry.append("document", blob, input.filename ?? "file");
      res = await fetch(botApiUrl("sendDocument"), { method: "POST", body: retry });
      if (!res.ok) {
        console.error(`sendTelegramToChat: sendSticker/sendDocument failed with ${res.status}`);
        return { telegramMessageId: null };
      }
      return { telegramMessageId: extractTelegramMessageId(await res.json().catch(() => null)) };
    }
    if (!res.ok) {
      console.error(`sendTelegramToChat: ${method} failed with ${res.status}`);
      return { telegramMessageId: null };
    }
    return { telegramMessageId: extractTelegramMessageId(await res.json().catch(() => null)) };
  } catch (err) {
    console.error("sendTelegramToChat failed", err);
    return { telegramMessageId: null };
  }
}

export async function notifyTelegram(
  connectionId: string,
  message: ChatMessage,
): Promise<{ telegramMessageId: string | null }> {
  if (!config.telegramBotToken) return { telegramMessageId: null };
  const connection = findConnectionById(connectionId);
  if (!connection) return { telegramMessageId: null };
  const chatId = connection.telegram_chat_id;
  const stored = message.kind === "text" || !message.mediaPath ? null : storedFileFor(connectionId, message);
  if (message.kind !== "text" && message.mediaPath && !stored) {
    await fetch(botApiUrl("sendMessage"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message.text ?? "(media unavailable)" }),
    });
    return { telegramMessageId: null };
  }
  return sendTelegramToChat(chatId, {
    kind: message.kind,
    text: message.text ?? undefined,
    mime: message.mime ?? undefined,
    fileAbsPath: stored,
    filename: stored ? originalFilename(message) : undefined,
  });
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
