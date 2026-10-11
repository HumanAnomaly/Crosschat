import type { ChatMessage } from "@crosschat/core";
import { createLogger } from "@crosschat/core";
import { findConnectionById, updateMessagePlatformIds } from "./db.js";
import { emitToConnection } from "./socket.js";
import { notifyDiscord } from "./discord-bridge.js";
import { notifyTelegram } from "./telegram-bridge.js";
import { notifyWhatsapp } from "./whatsapp-bridge.js";

const log = createLogger("realtime");

type NotifyResult = {
  telegramMessageId?: string | null;
  discordMessageId?: string | null;
  whatsappMessageId?: string | null;
};

/** Forward a web message to its connection's platform and persist the platform id. */
export function forwardWebMessage(connectionId: string, message: ChatMessage): void {
  const connection = findConnectionById(connectionId);
  const platform = connection?.platform_id ?? "telegram";
  const dispatch: Promise<NotifyResult> =
    platform === "discord"
      ? notifyDiscord(connectionId, message)
      : platform === "whatsapp"
        ? notifyWhatsapp(connectionId, message)
        : notifyTelegram(connectionId, message);
  const idField =
    platform === "discord" ? "discordMsgId" : platform === "whatsapp" ? "whatsappMsgId" : "telegramMsgId";
  const resultField =
    platform === "discord"
      ? "discordMessageId"
      : platform === "whatsapp"
        ? "whatsappMessageId"
        : "telegramMessageId";
  dispatch
    .then((r) => {
      const platformMsgId = r?.[resultField];
      // A resolved forward without a platform id is a soft failure (bad token,
      // platform 4xx); reporting ok:true would print a false ✓✓.
      emitToConnection(connectionId, "message:delivered", { id: message.id, ok: !!platformMsgId });
      if (!platformMsgId) return;
      try {
        updateMessagePlatformIds(message.id, { [idField]: platformMsgId });
      } catch (err) {
        log.error(`${platform} id persist failed`, err);
      }
    })
    .catch((err) => {
      log.error(`forward to ${platform} failed`, err);
      emitToConnection(connectionId, "message:delivered", { id: message.id, ok: false });
    });
}
