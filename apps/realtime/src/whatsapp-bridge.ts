import fs from "node:fs";
import type { ChatMessage } from "@crosschat/core";
import { findConnectionById } from "./db.js";
import { config } from "./env.js";
import { storedFileFor } from "./bridge-files.js";

const MAX_FORWARD_BYTES = 20 * 1024 * 1024;

function secret(): string {
  return config.whatsappWebhookSecret || config.telegramWebhookSecret;
}

function serviceBase(): string {
  return config.whatsappServiceUrl;
}

export async function notifyWhatsapp(
  connectionId: string,
  message: ChatMessage,
): Promise<{ whatsappMessageId: string | null }> {
  const connection = findConnectionById(connectionId);
  if (!connection) return { whatsappMessageId: null };
  if ((connection.platform_id ?? "telegram") !== "whatsapp") return { whatsappMessageId: null };
  const chatJid = connection.telegram_chat_id;
  try {
    let fileBase64: string | undefined;
    let filename: string | undefined;
    if (message.kind !== "text" && message.mediaPath) {
      const stored = storedFileFor(connectionId, message);
      if (stored && fs.existsSync(stored)) {
        const stat = await fs.promises.stat(stored);
        if (stat.size > MAX_FORWARD_BYTES) {
          console.error(`notifyWhatsapp: file too large to forward (${stat.size} bytes)`);
        } else {
          const buf = await fs.promises.readFile(stored);
          fileBase64 = buf.toString("base64");
          filename = stored.split(/[\\/]/).pop() ?? "file";
        }
      }
    }
    const res = await fetch(`${serviceBase()}/api/whatsapp/send`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bot-secret": secret() },
      body: JSON.stringify({
        chatId: chatJid,
        kind: message.kind,
        text: (message.text ?? "").slice(0, 4000),
        mime: message.mime,
        filename,
        fileBase64,
      }),
    });
    if (!res.ok) {
      console.error(`notifyWhatsapp: send failed with ${res.status}`);
      return { whatsappMessageId: null };
    }
    const data = (await res.json().catch(() => null)) as { whatsappMessageId?: unknown; id?: unknown } | null;
    const id = data && (typeof data.whatsappMessageId === "string" ? data.whatsappMessageId : typeof data.id === "string" ? data.id : null);
    return { whatsappMessageId: id ?? null };
  } catch (err) {
    console.error("notifyWhatsapp failed", err);
    return { whatsappMessageId: null };
  }
}

export async function deleteWhatsappMessage(chatId: string, whatsappMessageId: string): Promise<boolean> {
  try {
    const res = await fetch(`${serviceBase()}/api/whatsapp/delete`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bot-secret": secret() },
      body: JSON.stringify({ chatId, whatsappMessageId }),
    });
    return res.ok || res.status === 404;
  } catch (err) {
    console.error("deleteWhatsappMessage failed", err);
    return false;
  }
}
