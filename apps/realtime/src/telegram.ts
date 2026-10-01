import { Router, type Request, type Response } from "express";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { safeFilename } from "@crosschat/core";
import { findConnectionByPlatformChat, insertMessage, updateConnectionUsername } from "./db.js";
import { config } from "./env.js";
import { isBotRequest } from "./security.js";
import { emitToConnection, toChatMessage } from "./socket.js";

const inboundSchema = z.object({
  chatId: z.string().min(1).max(64),
  kind: z.enum(["text", "photo", "video", "document", "voice", "sticker"]),
  text: z.string().max(4000).optional(),
  fileBase64: z.string().max(35 * 1024 * 1024).optional(),
  filename: z.string().max(160).optional(),
  mime: z.string().max(120).optional(),
  size: z.number().max(50 * 1024 * 1024).optional(),
  telegramUsername: z.string().max(33).optional(),
  platformMsgId: z.string().max(64).optional(),
});

export function createTelegramRouter(): Router {
  const router = Router();
  router.post(
    "/api/telegram/inbound",
    express.json({ limit: "30mb" }),
    (req: Request, res: Response) => {
      if (!isBotRequest(req)) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      const parsed = inboundSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "invalid payload" });
        return;
      }
      const connection = findConnectionByPlatformChat(parsed.data.chatId, "telegram");
      if (!connection) {
        res.status(404).json({ error: "connection not found" });
        return;
      }
      if (parsed.data.telegramUsername && parsed.data.telegramUsername !== connection.telegram_username) {
        try {
          updateConnectionUsername(parsed.data.chatId, parsed.data.telegramUsername, "telegram");
        } catch (err) {
          console.error("username sync failed", err);
        }
      }
      let mediaPath: string | null = null;
      let size = parsed.data.size ?? null;
      if (parsed.data.fileBase64 && parsed.data.kind !== "text") {
        try {
          const buf = Buffer.from(parsed.data.fileBase64, "base64");
          if (buf.length > config.mediaMaxBytes) {
            res.status(413).json({ error: "file too large for bot api" });
            return;
          }
          const id = randomUUID();
          const filename = `${id}-${safeFilename(parsed.data.filename ?? "file")}`;
          const dir = path.join(config.mediaDir, connection.id);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, filename), buf);
          mediaPath = path.join(connection.id, filename);
          size = buf.length;
        } catch {
          res.status(400).json({ error: "invalid file payload" });
          return;
        }
      }
      const id = randomUUID();
      let saved: ReturnType<typeof insertMessage>;
      try {
        saved = insertMessage({
          id,
          connectionId: connection.id,
          sender: "telegram",
          kind: parsed.data.kind,
          text: parsed.data.text?.slice(0, 4000) ?? null,
          mediaPath,
          mime: parsed.data.mime ?? null,
          size,
          createdAt: Date.now(),
          telegramMsgId: parsed.data.platformMsgId ?? null,
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
      res.status(201).json({ message });
    },
  );

  return router;
}
