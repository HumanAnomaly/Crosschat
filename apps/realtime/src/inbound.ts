import { Router, type Request, type Response } from "express";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { safeFilename } from "@crosschat/core";
import { findAnonQueueEntry, findConnectionByPlatformChat, findDirectLinkByChat, insertMessage, updateConnectionUsername } from "./db.js";
import { config } from "./env.js";
import { isBotRequest } from "./security.js";
import { emitToConnection, toChatMessage } from "./socket.js";
import { notifyUserPush } from "./push.js";
import { forwardToDirectPeer } from "./direct.js";

type Platform = "telegram" | "discord" | "whatsapp";
type Sender = Platform;

const inboundSchema = z.object({
  chatId: z.string().min(1).max(64),
  kind: z.enum(["text", "photo", "video", "document", "voice", "sticker"]),
  text: z.string().max(4000).optional(),
  fileBase64: z.string().max(35 * 1024 * 1024).optional(),
  filename: z.string().max(160).optional(),
  mime: z.string().max(120).optional(),
  size: z.number().max(50 * 1024 * 1024).optional(),
  telegramUsername: z.string().max(33).optional(),
  discordUsername: z.string().max(37).optional(),
  whatsappUsername: z.string().max(32).optional(),
  platformMsgId: z.string().max(128).optional(),
  discordMessageId: z.string().max(64).optional(),
  whatsappMessageId: z.string().max(128).optional(),
});

type InboundBody = z.infer<typeof inboundSchema>;

interface InboundPlatform {
  sender: Sender;
  /** Ordered fallback chain for the display handle. */
  username: (data: InboundBody) => string | undefined;
  /** Platform message id to persist, in fallback order. */
  msgId: (data: InboundBody) => string | undefined;
  /** messages_meta column receiving `msgId`. */
  msgIdColumn: "telegramMsgId" | "discordMsgId" | "whatsappMsgId";
}

const INBOUND_PLATFORMS: Record<Platform, InboundPlatform> = {
  telegram: {
    sender: "telegram",
    username: (d) => d.telegramUsername,
    msgId: (d) => d.platformMsgId,
    msgIdColumn: "telegramMsgId",
  },
  discord: {
    sender: "discord",
    username: (d) => d.discordUsername ?? d.telegramUsername,
    msgId: (d) => d.platformMsgId ?? d.discordMessageId,
    msgIdColumn: "discordMsgId",
  },
  whatsapp: {
    sender: "whatsapp",
    username: (d) => d.whatsappUsername ?? d.telegramUsername,
    msgId: (d) => d.platformMsgId ?? d.whatsappMessageId,
    msgIdColumn: "whatsappMsgId",
  },
};

export function createInboundRouters(): Router {
  const router = Router();

  for (const [platform, p] of Object.entries(INBOUND_PLATFORMS) as [Platform, InboundPlatform][]) {
    router.post(`/api/${platform}/inbound`, express.json({ limit: "30mb" }), (req: Request, res: Response) => {
      if (!isBotRequest(req)) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const parsed = inboundSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "invalid payload" });
        return;
      }
      const data = parsed.data;
      const connection = findConnectionByPlatformChat(data.chatId, platform);
      const directLink = findDirectLinkByChat(data.chatId, platform);
      if (!connection && !directLink) {
        // Still looking for an anon partner: ack silently so the bot
        // doesn't nag on every message while waiting.
        if (findAnonQueueEntry(platform, data.chatId)) {
          res.status(202).json({ ok: true, anon: "waiting" });
          return;
        }
        res.status(404).json({ error: "connection not found" });
        return;
      }
      if (connection) {
        const username = p.username(data);
        if (username && username !== connection.telegram_username) {
          try {
            updateConnectionUsername(data.chatId, username, platform);
          } catch (err) {
            console.error(`${platform} username sync failed`, err);
          }
        }
      }
      let mediaPath: string | null = null;
      let size = data.size ?? null;
      if (data.fileBase64 && data.kind !== "text") {
        try {
          const buf = Buffer.from(data.fileBase64, "base64");
          if (buf.length > config.mediaMaxBytes) {
            res.status(413).json({ error: "file too large for bot api" });
            return;
          }
          const id = randomUUID();
          const filename = `${id}-${safeFilename(data.filename ?? "file")}`;
          // Web-linked chats keep files under their connection dir; P2P-only
          // chats have no connection row, so stage under direct/<linkId>.
          const baseDir = connection ? connection.id : `direct/${directLink!.id}`;
          const dir = path.join(config.mediaDir, baseDir);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, filename), buf);
          mediaPath = path.join(baseDir, filename);
          size = buf.length;
        } catch {
          res.status(400).json({ error: "invalid file payload" });
          return;
        }
      }
      // Fan-out to the P2P peer (fire-and-forget; never blocks the web room).
      if (directLink) {
        void forwardToDirectPeer({
          sourcePlatform: platform,
          sourceChat: data.chatId,
          kind: data.kind,
          text: data.text?.slice(0, 4000) ?? null,
          mime: data.mime ?? null,
          filename: data.filename ?? "file",
          fileBase64: data.fileBase64 ?? null,
          size,
          platformMsgId: p.msgId(data) ?? null,
        }).catch((err) => console.error("direct forward failed", err));
      }
      if (!connection) {
        // P2P-only chat: accepted + forwarded above, no web room to emit to.
        res.status(201).json({ ok: true, direct: true });
        return;
      }
      const id = randomUUID();
      let saved: ReturnType<typeof insertMessage>;
      try {
        saved = insertMessage({
          id,
          connectionId: connection.id,
          sender: p.sender,
          kind: data.kind,
          text: data.text?.slice(0, 4000) ?? null,
          mediaPath,
          mime: data.mime ?? null,
          size,
          createdAt: Date.now(),
          [p.msgIdColumn]: p.msgId(data) ?? null,
        });
      } catch (err) {
        const code = (err as { code?: unknown })?.code;
        if (typeof code === "string" && code.includes("FOREIGN")) {
          res.status(404).json({ error: "connection not found" });
          return;
        }
        throw err;
      }
      const message = toChatMessage(saved);
      emitToConnection(connection.id, "message:new", message);
      // Payload-less ping; skipped when the user already watches via socket.
      void notifyUserPush(connection.user_id);
      res.status(201).json({ message });
    });
  }

  return router;
}
