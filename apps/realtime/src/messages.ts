import { Router, type Request, type Response } from "express";
import fs from "node:fs";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import {
  connectionStats,
  deleteMessageById,
  findConnectionById,
  findConnectionByUser,
  findMessageById,
  findMessageByPlatformId,
  findMessagesByPlatformId,
} from "./db.js";
import { isBotRequest, resolveStoredMediaPath } from "./security.js";
import { emitToConnection } from "./socket.js";
import { deleteTelegramMessage } from "./telegram-bridge.js";
import { deleteDiscordMessage } from "./discord-bridge.js";
import { deleteWhatsappMessage } from "./whatsapp-bridge.js";

const botDeleteSchema = z.object({
  chatId: z.string().min(1).max(64).optional(),
  telegramChatId: z.string().min(1).max(64).optional(),
  discordChatId: z.string().min(1).max(64).optional(),
  whatsappChatId: z.string().min(1).max(128).optional(),
  platformMsgId: z.string().min(1).max(128).optional(),
  telegramMessageId: z.string().min(1).max(64).optional(),
  discordMessageId: z.string().min(1).max(64).optional(),
  whatsappMessageId: z.string().min(1).max(128).optional(),
  platformId: z.enum(["telegram", "discord", "whatsapp"]).optional(),
});

function removeMediaFile(mediaPath: string | null): void {
  if (!mediaPath) return;
  const abs = resolveStoredMediaPath(mediaPath);
  if (!abs) return;
  try {
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch (err) {
    console.error("remove media failed", err);
  }
}

export async function eraseMessageCompletely(row: {
  id: string;
  connection_id: string;
  media_path: string | null;
  telegram_msg_id: string | null;
  discord_msg_id: string | null;
  whatsapp_msg_id?: string | null;
}): Promise<void> {
  const connection = findConnectionById(row.connection_id);
  if (connection && row.telegram_msg_id) {
    try {
      await deleteTelegramMessage(connection.telegram_chat_id, row.telegram_msg_id);
    } catch (err) {
      console.error("erase: telegram delete failed", err);
    }
  }
  if (connection && row.discord_msg_id && (connection.platform_id ?? "telegram") === "discord") {
    try {
      await deleteDiscordMessage(connection.telegram_chat_id, row.discord_msg_id);
    } catch (err) {
      console.error("erase: discord delete failed", err);
    }
  }
  if (connection && row.whatsapp_msg_id && (connection.platform_id ?? "telegram") === "whatsapp") {
    try {
      await deleteWhatsappMessage(connection.telegram_chat_id, row.whatsapp_msg_id);
    } catch (err) {
      console.error("erase: whatsapp delete failed", err);
    }
  }
  deleteMessageById(row.id);
  removeMediaFile(row.media_path);
  emitToConnection(row.connection_id, "message:deleted", { id: row.id, connectionId: row.connection_id });
}

export function createMessagesRouter(): Router {
  const router = Router();
  router.delete("/api/messages/:id", requireAuth, (req: Request, res: Response) => {
    const raw = req.params.id;
    const id = Array.isArray(raw) ? raw[0] : raw;
    if (!id) {
      res.status(400).json({ error: "message id required" });
      return;
    }
    const meta = findMessageById(id);
    if (!meta) {
      console.error(`delete message: not found ${id}`);
      res.status(404).json({ error: "message not found" });
      return;
    }
    const connection = findConnectionById(meta.connection_id);
    if (!connection || connection.user_id !== req.user!.id) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    if (meta.sender !== "web") {
      res.status(403).json({ error: "you can only delete your own messages" });
      return;
    }
    void eraseMessageCompletely(meta).then(
      () => {
        if (!res.headersSent) res.json({ ok: true, id });
      },
      (err) => {
        console.error("delete message failed", err);
        if (!res.headersSent) res.status(500).json({ error: "delete failed" });
      },
    );
  });

  const handleBotDelete = (platform: "telegram" | "discord" | "whatsapp") => (req: Request, res: Response) => {
    if (!isBotRequest(req)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const parsed = botDeleteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid payload" });
      return;
    }
    const platformMsgId =
      parsed.data.platformMsgId ??
      (platform === "telegram" ? parsed.data.telegramMessageId : platform === "discord" ? parsed.data.discordMessageId : parsed.data.whatsappMessageId);
    if (!platformMsgId) {
      res.status(400).json({ error: "platform message id required" });
      return;
    }
    const chatId = parsed.data.chatId ?? parsed.data.telegramChatId ?? parsed.data.discordChatId ?? parsed.data.whatsappChatId;
    const candidates = findMessagesByPlatformId(platformMsgId, platform);
    if (candidates.length === 0) {
      // No web copy — still try the P2P mapping so direct deletes work
      // even for chats that never linked the web.
      void import("./direct.js").then(
        ({ eraseDirectCopy }) =>
          eraseDirectCopy(platform, platformMsgId, chatId).then(
            (r) => {
              if (!res.headersSent) res.json({ ok: true, deleted: r.deleted, id: r.id });
            },
            (err) => {
              console.error("bot delete (direct) failed", err);
              if (!res.headersSent) res.status(500).json({ error: "delete failed" });
            },
          ),
        () => {
          if (!res.headersSent) res.json({ ok: true, deleted: false });
        },
      );
      return;
    }
    let scoped = candidates;
    if (chatId) {
      const inChat = candidates.filter((r) => {
        const connection = findConnectionById(r.connection_id);
        return connection?.telegram_chat_id === chatId;
      });
      if (inChat.length === 0) {
        res.status(404).json({ error: "connection not found" });
        return;
      }
      scoped = inChat;
    }

    const expectedSender = platform === "telegram" ? "telegram" : platform === "discord" ? "discord" : "whatsapp";
    const own = scoped.filter((r) => r.sender === expectedSender);
    if (own.length === 0) {
      res.status(403).json({ error: "you can only delete your own messages" });
      return;
    }
    let lastId: string | null = null;
    for (const r of own) {
      const full = findMessageById(r.id);
      if (!full) continue;
      deleteMessageById(full.id);
      removeMediaFile(full.media_path);
      emitToConnection(full.connection_id, "message:deleted", { id: full.id, connectionId: full.connection_id });
      lastId = full.id;
    }
    // Best-effort: the same native message may also have a P2P copy.
    void import("./direct.js").then(({ eraseDirectCopy }) =>
      eraseDirectCopy(platform, platformMsgId, chatId).catch((err) =>
        console.error("bot delete (direct fan-out) failed", err),
      ),
    );
    res.json({ ok: true, deleted: true, id: lastId });
  };

  router.post("/api/telegram/delete", handleBotDelete("telegram"));
  router.post("/api/discord/delete", handleBotDelete("discord"));
  router.post("/api/whatsapp/delete", handleBotDelete("whatsapp"));
  router.get("/api/connection/stats", requireAuth, (req: Request, res: Response) => {
    const q = typeof req.query.connectionId === "string" ? req.query.connectionId : "";
    const row = q ? findConnectionById(q) : findConnectionByUser(req.user!.id);
    if (!row || row.user_id !== req.user!.id) {
      res.status(404).json({ error: "connection not found" });
      return;
    }
    const stats = connectionStats(row.id);
    res.json({
      connectionId: row.id,
      platformId: row.platform_id ?? "telegram",
      username: row.telegram_username ?? null,
      createdAt: new Date(row.created_at).toISOString(),
      stats: {
        total: stats.total,
        fromWeb: stats.fromWeb,
        fromTelegram: stats.fromTelegram,
        fromDiscord: stats.fromDiscord ?? 0,
        fromWhatsapp: stats.fromWhatsapp ?? 0,
        lastMessageAt: stats.lastMessageAt ? new Date(stats.lastMessageAt).toISOString() : null,
      },
    });
  });

  router.get("/api/messages/by-platform", (req: Request, res: Response) => {
    if (!isBotRequest(req)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const platform = req.query.platform === "discord" ? "discord" : req.query.platform === "whatsapp" ? "whatsapp" : "telegram";
    const platformMsgId = typeof req.query.platformMsgId === "string" ? req.query.platformMsgId : "";
    if (!platformMsgId) {
      res.status(400).json({ error: "platformMsgId required" });
      return;
    }
    const row = findMessageByPlatformId(platformMsgId, platform);
    if (!row) {
      res.status(404).json({ error: "message not found" });
      return;
    }
    res.json({ id: row.id, connectionId: row.connection_id });
  });

  return router;
}
