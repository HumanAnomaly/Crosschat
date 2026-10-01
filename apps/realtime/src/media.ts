import { Router, type Request, type Response } from "express";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { safeFilename, type ChatMessage } from "@crosschat/core";
import { requireAuth } from "./auth.js";
import {
  findConnectionById,
  findMessageById,
  insertMessage,
  updateMessagePlatformIds,
} from "./db.js";
import { config } from "./env.js";
import { emitToConnection } from "./socket.js";
import { notifyTelegram } from "./telegram-bridge.js";
import { notifyDiscord } from "./discord-bridge.js";
import { resolveStoredMediaPath } from "./security.js";

const MAX_BYTES = config.mediaMaxBytes;
const BLOCKED_MIME = new Set([
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-executable",
  "application/x-sh",
  "application/x-mach-binary",
  "application/x-javascript",
  "text/html",
  "image/svg+xml",
]);

function allowedMime(mime: string): boolean {
  const base = mime.split(";")[0].trim().toLowerCase();
  if (base === "image/svg+xml" || base === "text/html") return false;
  if (base.startsWith("image/") || base.startsWith("video/") || base.startsWith("audio/")) {
    return true;
  }
  if (base.startsWith("application/") && !BLOCKED_MIME.has(base)) return true;
  if (base === "text/plain") return true;
  return false;
}

function kindForMime(mime: string): ChatMessage["kind"] {
  const base = mime.split(";")[0].trim().toLowerCase();
  if (base.startsWith("image/")) return "photo";
  if (base.startsWith("video/")) return "video";
  if (base.startsWith("audio/")) return "voice";
  return "document";
}

function decodeHeader(v: string | string[] | undefined): string {
  const s = Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function createMediaRouter(): Router {
  const router = Router();

  router.post(
    "/api/media/upload",
    requireAuth,
    express.raw({ type: "*/*", limit: MAX_BYTES }),
    (req: Request, res: Response) => {
      const connectionId = req.query.connectionId;
      if (typeof connectionId !== "string") {
        res.status(400).json({ error: "connectionId query required" });
        return;
      }
      const connection = findConnectionById(connectionId);
      if (!connection || connection.user_id !== req.user!.id) {
        res.status(403).json({ error: "not a member of this connection" });
        return;
      }
      const mime = (req.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!allowedMime(mime)) {
        res.status(415).json({ error: "unsupported media type" });
        return;
      }
      const body = req.body as Buffer | undefined;
      if (!body || body.length === 0) {
        res.status(400).json({ error: "empty body" });
        return;
      }
      if (body.length > MAX_BYTES) {
        res.status(413).json({ error: "file too large" });
        return;
      }
      const id = randomUUID();
      const dir = path.join(config.mediaDir, connection.id);
      fs.mkdirSync(dir, { recursive: true });
      const filename = `${id}-${safeFilename(decodeHeader(req.get("x-filename")) || "file")}`;
      const absPath = path.resolve(dir, filename);
      const base = path.resolve(config.mediaDir) + path.sep;
      if (!absPath.startsWith(base)) {
        res.status(400).json({ error: "invalid filename" });
        return;
      }
      fs.writeFileSync(absPath, body);
      const relPath = path.join(connection.id, filename);
      const text = decodeHeader(req.get("x-caption")).slice(0, 4000) || undefined;
      const saved = insertMessage({
        id,
        connectionId: connection.id,
        sender: "web",
        kind: kindForMime(mime),
        text: text ?? null,
        mediaPath: relPath,
        mime,
        size: body.length,
        createdAt: Date.now(),
      });
      const message: ChatMessage = {
        id: saved.id,
        connectionId: saved.connection_id,
        sender: "web",
        kind: saved.kind as ChatMessage["kind"],
        text: saved.text ?? undefined,
        mediaPath: `/media/${saved.id}`,
        mime: saved.mime ?? undefined,
        size: saved.size ?? undefined,
        createdAt: new Date(saved.created_at).toISOString(),
      };
      emitToConnection(connection.id, "message:new", message);
      if ((connection.platform_id ?? "telegram") === "discord") {
        notifyDiscord(connection.id, message)
          .then((r) => {
            if (r?.discordMessageId) {
              try {
                updateMessagePlatformIds(saved.id, { discordMsgId: r.discordMessageId });
              } catch {
              }
            }
          })
          .catch((err) => {
            console.error("forward to discord failed", err);
          });
      } else {
        notifyTelegram(connection.id, message)
          .then((r) => {
            if (r?.telegramMessageId) {
              try {
                updateMessagePlatformIds(saved.id, { telegramMsgId: r.telegramMessageId });
              } catch {
              }
            }
          })
          .catch((err) => {
            console.error("forward to telegram failed", err);
          });
      }
      res.status(201).json({ message });
    },
  );

  router.get("/media/:id", requireAuth, (req: Request, res: Response) => {
    const rawId = req.params.id;
    const mediaId = Array.isArray(rawId) ? rawId[0] : rawId;
    const meta = findMessageById(mediaId);
    if (!meta || !meta.media_path) {
      res.status(404).json({ error: "media not found" });
      return;
    }
    const connection = findConnectionById(meta.connection_id);
    if (!connection || connection.user_id !== req.user!.id) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const absPath = resolveStoredMediaPath(meta.media_path);
    if (!absPath || !fs.existsSync(absPath)) {
      res.status(404).json({ error: "media not found" });
      return;
    }
    if (meta.mime) res.type(meta.mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", "attachment");
    res.sendFile(absPath, (err) => {
      if (!err || res.headersSent) return;
      const e = err as NodeJS.ErrnoException & { status?: number };
      if (e.code === "ENOENT" || e.status === 404) {
        res.status(404).json({ error: "media not found" });
        return;
      }
      console.error("media send failed", err);
      res.status(500).json({ error: "media unavailable" });
    });
  });

  return router;
}
