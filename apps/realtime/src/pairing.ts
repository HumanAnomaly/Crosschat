import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  makePairingCode,
  normalizeDiscordUsername,
  normalizeTelegramUsername,
  normalizeWhatsappUsername,
  parsePairingCode,
} from "@crosschat/core";
import { requireAuth } from "./auth.js";
import {
  claimPairingCodeAtomic,
  claimPairingCodeAtomicBot,
  connectionStats,
  deleteConnectionByTelegramChat,
  deleteConnectionByUser,
  deleteExpiredCodes,
  findConnectionByPlatformChat,
  findConnectionByUser,
  findPairingCode,
  findUserById,
  insertPairingCode,
  listMessagesPage,
} from "./db.js";
import { config } from "./env.js";
import { isBotRequest } from "./security.js";
import { emitToConnection, emitToUser, toChatMessage } from "./socket.js";
import fs from "node:fs";
import path from "node:path";

const CODE_TTL_MS = config.pairCodeTtlMs;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = config.pairRateMax;

const recentGenerations = new Map<string, number[]>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of recentGenerations) {
    const kept = v.filter((t) => now - t < RATE_WINDOW_MS);
    if (kept.length === 0) recentGenerations.delete(k);
    else recentGenerations.set(k, kept);
  }
}, RATE_WINDOW_MS).unref?.();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const stamps = (recentGenerations.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (stamps.length >= RATE_MAX) {
    recentGenerations.set(key, stamps);
    return false;
  }
  stamps.push(now);
  recentGenerations.set(key, stamps);
  return true;
}

const claimSchema = z.object({
  code: z.string().min(1).max(16),
  telegramChatId: z.string().min(1).max(64).optional(),
  discordChatId: z.string().min(1).max(64).optional(),
  whatsappChatId: z.string().min(1).max(64).optional(),
  chatId: z.string().min(1).max(64).optional(),
  platformId: z.enum(["telegram", "discord", "whatsapp"]).optional(),
  telegramUsername: z.string().min(1).max(34).optional(),
  discordUsername: z.string().min(1).max(37).optional(),
  whatsappUsername: z.string().min(1).max(32).optional(),
});

const createSchema = z.object({
  code: z.string().min(1).max(16),
  telegramChatId: z.string().min(1).max(64).optional(),
  discordChatId: z.string().min(1).max(64).optional(),
  whatsappChatId: z.string().min(1).max(64).optional(),
  chatId: z.string().min(1).max(64).optional(),
  platformId: z.enum(["telegram", "discord", "whatsapp"]).optional(),
  telegramUsername: z.string().min(1).max(34).optional(),
  discordUsername: z.string().min(1).max(37).optional(),
  whatsappUsername: z.string().min(1).max(32).optional(),
  ttlSec: z.number().min(60).max(600).optional(),
});

function resolveChat(data: {
  telegramChatId?: string;
  discordChatId?: string;
  whatsappChatId?: string;
  chatId?: string;
  platformId?: string;
}): { chatId: string; platformId: string } | null {
  if (data.telegramChatId) return { chatId: data.telegramChatId, platformId: "telegram" };
  if (data.discordChatId) return { chatId: data.discordChatId, platformId: "discord" };
  if (data.whatsappChatId) return { chatId: data.whatsappChatId, platformId: "whatsapp" };
  if (data.chatId) return { chatId: data.chatId, platformId: data.platformId ?? "telegram" };
  return null;
}

function resolveUsername(data: { telegramUsername?: string; discordUsername?: string; whatsappUsername?: string }, platformId: string): string | null {
  if (platformId === "discord") {
    return (
      normalizeDiscordUsername(data.discordUsername) ??
      normalizeTelegramUsername(data.telegramUsername) ??
      (typeof data.discordUsername === "string" ? data.discordUsername.slice(0, 32) : null)
    );
  }
  if (platformId === "whatsapp") {
    return (
      normalizeWhatsappUsername(data.whatsappUsername) ??
      normalizeWhatsappUsername(data.telegramUsername) ??
      (typeof data.whatsappUsername === "string" ? data.whatsappUsername.slice(0, 32) : null)
    );
  }
  return normalizeTelegramUsername(data.telegramUsername) ?? normalizeDiscordUsername(data.discordUsername);
}

function connectionPayload(row: {
  id: string;
  user_id: string;
  platform_id: string | null;
  telegram_chat_id: string;
  telegram_username: string | null;
  created_at: number;
}) {
  return {
    id: row.id,
    userId: row.user_id,
    platformId: row.platform_id ?? "telegram",
    telegramChatId: row.telegram_chat_id,
    telegramUsername: row.telegram_username ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

async function notifyBot(linked: boolean, telegramChatId: string, platformId = "telegram"): Promise<void> {
  const isDiscord = platformId === "discord";
  const isWhatsapp = platformId === "whatsapp";
  const base = isDiscord
    ? config.discordServiceUrl
    : isWhatsapp
      ? config.whatsappServiceUrl
      : config.telegramServiceUrl;
  const secret = isDiscord
    ? config.discordWebhookSecret || config.telegramWebhookSecret
    : isWhatsapp
      ? config.whatsappWebhookSecret || config.telegramWebhookSecret
      : config.telegramWebhookSecret;
  if (!secret) return;
  try {
    await fetch(`${base}/notify/${linked ? "linked" : "disconnect"}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bot-secret": secret },
      body: JSON.stringify({ chatId: telegramChatId }),
    });
  } catch (err) {
    console.error("notify bot failed", err);
  }
}

function removeMediaFiles(connectionId: string): void {
  try {
    fs.rmSync(path.join(config.mediaDir, connectionId), { recursive: true, force: true });
  } catch (err) {
    console.error("remove media failed", err);
  }
}

function mapClaimError(e: unknown, res: Response): void {
  const code = e instanceof Error ? e.message : "";
  if (code === "CODE_INVALID") { res.status(404).json({ error: "code expired or not found" }); return; }
  if (code === "CODE_FOREIGN") { res.status(403).json({ error: "code belongs to another user" }); return; }
  if (code === "CODE_TG_INITIATED") { res.status(400).json({ error: "code must be claimed from web" }); return; }
  if (code === "CONFLICT_USER") { res.status(409).json({ error: "user already connected" }); return; }
  if (code === "CONFLICT_CHAT") { res.status(409).json({ error: "chat already connected" }); return; }
  if (code === "CODE_NO_OWNER") { res.status(410).json({ error: "code has no owner" }); return; }
  res.status(500).json({ error: "claim failed" });
}

export function createPairingRouter(): Router {
  const router = Router();

  router.post("/api/pair/generate", requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    if (!checkRateLimit(`user:${userId}`)) {
      res.status(429).json({ error: "too many requests, try again later" });
      return;
    }
    deleteExpiredCodes();
    let code = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = makePairingCode();
      if (!findPairingCode(candidate)) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      res.status(500).json({ error: "failed to generate code" });
      return;
    }
    const expiresAt = Date.now() + CODE_TTL_MS;
    try {
      insertPairingCode(code, userId, expiresAt, "web-initiated", null);
    } catch {
      res.status(409).json({ error: "code already exists" });
      return;
    }
    res.status(201).json({ code, expiresAt: new Date(expiresAt).toISOString() });
  });

  router.post("/api/pair/create", (req: Request, res: Response) => {
    if (!isBotRequest(req)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid payload" });
      return;
    }
    const code = parsePairingCode(parsed.data.code);
    if (!code) {
      res.status(400).json({ error: "invalid code format" });
      return;
    }
    const resolved = resolveChat(parsed.data);
    if (!resolved) {
      res.status(400).json({ error: "chat id required" });
      return;
    }
    if (!checkRateLimit(`${resolved.platformId}:${resolved.chatId}`)) {
      res.status(429).json({ error: "too many requests" });
      return;
    }
    deleteExpiredCodes();
    if (findPairingCode(code)) {
      res.status(409).json({ error: "code already exists" });
      return;
    }
    const ttl = (parsed.data.ttlSec ?? 300) * 1000;
    try {
      insertPairingCode(
        code,
        null,
        Date.now() + ttl,
        "tg-initiated",
        resolved.chatId,
        resolveUsername(parsed.data, resolved.platformId),
        resolved.platformId,
      );
    } catch {
      res.status(409).json({ error: "code already exists" });
      return;
    }
    res.status(201).json({ ok: true, platformId: resolved.platformId });
  });

  router.post("/api/pair/claim", async (req: Request, res: Response) => {
    const fromBot = isBotRequest(req);
    if (!fromBot && !req.user) {
      res.status(401).json({ error: "login required" });
      return;
    }
    if (!fromBot && req.user && !checkRateLimit(`claim:${req.user.id}`)) {
      res.status(429).json({ error: "too many requests" });
      return;
    }
    const parsed = claimSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid payload" });
      return;
    }
    const code = parsePairingCode(parsed.data.code);
    if (!code) {
      res.status(400).json({ error: "invalid code format" });
      return;
    }

    if (fromBot && !req.user) {
      const resolved = resolveChat(parsed.data);
      if (!resolved) {
        res.status(400).json({ error: "chat id required" });
        return;
      }
      try {
        const { connection, ownerId } = claimPairingCodeAtomicBot({
          code,
          telegramChatId: resolved.chatId,
          telegramUsername: resolveUsername(parsed.data, resolved.platformId),
          platformId: resolved.platformId,
        });
        const payload = connectionPayload(connection);
        emitToUser(ownerId, "connection:created", payload);
        res.status(201).json({ connection: payload });
      } catch (e) {
        mapClaimError(e, res);
      }
      return;
    }

    const userId = req.user!.id;
    try {
      const row = findPairingCode(code);
      if (!row || row.used === 1 || row.expires_at < Date.now()) {
        res.status(404).json({ error: "code expired or not found" });
        return;
      }
      const requested = resolveChat(parsed.data);
      let chatId = requested?.chatId;
      let username = requested ? resolveUsername(parsed.data, requested.platformId) : null;
      let platformId = requested?.platformId ?? "telegram";
      if (row.user_id === null) {
        if (!row.telegram_chat_id) {
          res.status(410).json({ error: "code has no owner" });
          return;
        }
        chatId = row.telegram_chat_id;
        username ??= row.telegram_username;
        platformId = requested?.platformId ?? row.platform_id ?? "telegram";
      } else if (row.user_id !== userId) {
        res.status(403).json({ error: "code belongs to another user" });
        return;
      }
      if (!chatId) {
        res.status(400).json({ error: "chat id required" });
        return;
      }
      const { connection, tgInitiated } = claimPairingCodeAtomic({
        code,
        userId,
        telegramChatId: chatId,
        telegramUsername: username,
        platformId,
      });
      const payload = connectionPayload(connection);
      emitToUser(userId, "connection:created", payload);
      if (tgInitiated) await notifyBot(true, chatId, platformId);
      res.status(201).json({ connection: payload });
    } catch (e) {
      if (!res.headersSent) mapClaimError(e, res);
    }
  });

  router.get("/api/connection", requireAuth, (req: Request, res: Response) => {
    const row = findConnectionByUser(req.user!.id);
    if (!row) {
      res.json({ connection: null, messages: [] });
      return;
    }
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 100);
    const before = req.query.before != null ? Number(req.query.before) : undefined;
    res.json({
      connection: connectionPayload(row),
      messages: listMessagesPage(row.id, { limit, before: Number.isFinite(before) ? before : undefined }).map(toChatMessage),
    });
  });

  router.get("/api/pair/status", (req: Request, res: Response) => {
    if (!isBotRequest(req)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const rawTelegram = typeof req.query.telegramChatId === "string" ? req.query.telegramChatId : "";
    const rawDiscord = typeof req.query.discordChatId === "string" ? req.query.discordChatId : "";
    const rawWhatsapp = typeof req.query.whatsappChatId === "string" ? req.query.whatsappChatId : "";
    const rawChat = typeof req.query.chatId === "string" ? req.query.chatId : "";
    const rawPlatform = typeof req.query.platformId === "string" ? req.query.platformId : "";
    const chatId = rawTelegram || rawDiscord || rawWhatsapp || rawChat;
    const platformId = rawTelegram ? "telegram" : rawDiscord ? "discord" : rawWhatsapp ? "whatsapp" : rawPlatform || "telegram";
    if (!chatId) {
      res.status(400).json({ error: "chat id required" });
      return;
    }
    const connection = findConnectionByPlatformChat(chatId, platformId);
    if (!connection) {
      res.json({ wired: false });
      return;
    }
    const user = findUserById(connection.user_id);
    const stats = connectionStats(connection.id);
    res.json({
      wired: true,
      platformId: connection.platform_id ?? "telegram",
      connection: {
        id: connection.id,
        telegramUsername: connection.telegram_username ?? undefined,
        createdAt: new Date(connection.created_at).toISOString(),
      },
      user: { email: user?.email ?? null, name: user?.name ?? null },
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

  async function handleWebDisconnect(req: Request, res: Response): Promise<void> {
    const removed = deleteConnectionByUser(req.user!.id);
    if (!removed) {
      res.status(404).json({ error: "no active connection" });
      return;
    }
    removeMediaFiles(removed.id);
    const payload = { connectionId: removed.id };
    emitToConnection(removed.id, "connection:closed", payload);
    emitToUser(req.user!.id, "connection:closed", payload);
    await notifyBot(false, removed.telegram_chat_id, removed.platform_id ?? "telegram");
    res.json({ ok: true });
  }

  router.post("/api/connection/disconnect", requireAuth, (req: Request, res: Response) => {
    void handleWebDisconnect(req, res);
  });

  router.delete("/api/connection", requireAuth, (req: Request, res: Response) => {
    void handleWebDisconnect(req, res);
  });

  router.post("/api/pair/disconnect", (req: Request, res: Response) => {
    if (!isBotRequest(req)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const parsed = z
      .object({
        telegramChatId: z.string().min(1).optional(),
        discordChatId: z.string().min(1).optional(),
        whatsappChatId: z.string().min(1).optional(),
        chatId: z.string().min(1).optional(),
        platformId: z.string().min(1).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid payload" });
      return;
    }
    const chatId =
      parsed.data.telegramChatId ?? parsed.data.discordChatId ?? parsed.data.whatsappChatId ?? parsed.data.chatId;
    if (!chatId) {
      res.status(400).json({ error: "chat id required" });
      return;
    }
    const platformId = parsed.data.telegramChatId
      ? "telegram"
      : parsed.data.discordChatId
        ? "discord"
        : parsed.data.whatsappChatId
          ? "whatsapp"
          : parsed.data.platformId === "discord" || parsed.data.platformId === "whatsapp"
            ? parsed.data.platformId
            : "telegram";
    const removed = deleteConnectionByTelegramChat(chatId, platformId);
    if (!removed) {
      res.json({ ok: true });
      return;
    }
    removeMediaFiles(removed.id);
    const payload = { connectionId: removed.id };
    emitToConnection(removed.id, "connection:closed", payload);
    emitToUser(removed.user_id, "connection:closed", payload);
    res.json({ ok: true });
  });

  return router;
}
