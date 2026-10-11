import { Router, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { createLogger } from "@crosschat/core";
import {
  createDirectLink,
  db,
  deleteDirectLinkByChat,
  deleteStaleAnonQueue,
  findAnonQueueEntry,
  findDirectLinkByChat,
  joinAnonQueue,
  leaveAnonQueue,
  peerOf,
  popAnonPartner,
  type DirectLinkRow,
} from "./db.js";
import { resolveJoiner, resolveUsername, anonSessionId } from "./direct.js";
import { config } from "./env.js";
import { isBotRequest } from "./security.js";
import { emitToUser } from "./socket.js";

const log = createLogger("anon");

type Platform = "telegram" | "discord" | "whatsapp" | "web";

interface Who {
  platform: Platform;
  chat: string;
  username: string | null;
}

/** Short public id shown in the "partner found" message. */
export { anonSessionId };

function sessionPayload(link: DirectLinkRow, me: Pick<Who, "platform" | "chat">) {
  const peer = peerOf(link, me.platform, me.chat);
  return { id: anonSessionId(link), partnerPlatform: peer?.platform ?? null };
}

function notifyBase(platform: Platform): { base: string; secret: string | undefined } {
  const base =
    platform === "discord"
      ? config.discordServiceUrl
      : platform === "whatsapp"
        ? config.whatsappServiceUrl
        : config.telegramServiceUrl;
  const secret =
    platform === "discord"
      ? config.discordWebhookSecret || config.telegramWebhookSecret
      : platform === "whatsapp"
        ? config.whatsappWebhookSecret || config.telegramWebhookSecret
        : config.telegramWebhookSecret;
  return { base, secret };
}

/** Wake a waiting peer: bot push for platform chats, socket for web users. */
function wakePeer(
  platform: string,
  chat: string,
  event: "found" | "ended",
  extra?: Record<string, string | null>,
): void {
  if (platform === "web") {
    emitToUser(chat, event === "found" ? "anon:found" : "anon:ended", extra ?? {});
    return;
  }
  void notifyAnon(platform as Platform, chat, event, extra);
}

/** Wake a bot-side chat: partner found / partner left. Fire-and-forget. */
export async function notifyAnon(
  platform: Platform,
  chatId: string,
  event: "found" | "ended",
  extra?: Record<string, string | null>,
): Promise<void> {
  const { base, secret } = notifyBase(platform);
  if (!secret) return;
  try {
    await fetch(`${base}/notify/anon`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bot-secret": secret },
      body: JSON.stringify({ chatId, event, ...extra }),
    });
  } catch (err) {
    log.error("anon notify failed", err);
  }
}

const joinSchema = z.object({
  chatId: z.string().min(1).max(128).optional(),
  telegramChatId: z.string().min(1).max(64).optional(),
  discordChatId: z.string().min(1).max(64).optional(),
  whatsappChatId: z.string().min(1).max(128).optional(),
  platformId: z.enum(["telegram", "discord", "whatsapp"]).optional(),
  telegramUsername: z.string().min(1).max(34).optional(),
  discordUsername: z.string().min(1).max(37).optional(),
  whatsappUsername: z.string().min(1).max(32).optional(),
});

const statusSchema = z.object({
  chatId: z.string().min(1).max(128).optional(),
  telegramChatId: z.string().min(1).max(64).optional(),
  discordChatId: z.string().min(1).max(64).optional(),
  whatsappChatId: z.string().min(1).max(128).optional(),
  platformId: z.string().min(1).optional(),
});

function resolveStatusIdentity(q: z.infer<typeof statusSchema>): Pick<Who, "platform" | "chat"> | null {
  const chatId = q.chatId ?? q.telegramChatId ?? q.discordChatId ?? q.whatsappChatId;
  if (!chatId) return null;
  const platform: Platform = q.telegramChatId
    ? "telegram"
    : q.discordChatId
      ? "discord"
      : q.whatsappChatId
        ? "whatsapp"
        : q.platformId === "discord" || q.platformId === "whatsapp"
          ? q.platformId
          : "telegram";
  return { chat: chatId, platform };
}

const matchTx = db.transaction((me: Who): DirectLinkRow | null => {
  for (;;) {
    const waiter = popAnonPartner(me.platform, me.chat);
    if (!waiter) {
      joinAnonQueue(me.platform, me.chat, me.username);
      return null;
    }
    // Stale row (waiter paired via code claim while queued): drop it and
    // try the next waiter instead of silently double-linking them.
    if (findDirectLinkByChat(waiter.chat, waiter.platform)) {
      leaveAnonQueue(waiter.platform, waiter.chat);
      continue;
    }
    leaveAnonQueue(waiter.platform, waiter.chat);
    leaveAnonQueue(me.platform, me.chat);
    return createDirectLink({
      aPlatform: waiter.platform,
      aChat: waiter.chat,
      aUsername: waiter.username,
      bPlatform: me.platform,
      bChat: me.chat,
      bUsername: me.username,
      mode: "anon",
    });
  }
});

/** One atomic match attempt; wakes both sides when it hits. */
function matchAndNotify(me: Who): DirectLinkRow | null {
  let link: DirectLinkRow | null;
  try {
    link = matchTx(me);
  } catch (err) {
    // Lost a race (partner claimed twice): fall back to queueing.
    log.error("anon match failed", err);
    joinAnonQueue(me.platform, me.chat, me.username);
    return null;
  }
  if (!link) return null;
  const session = sessionPayload(link, me);
  const peer = peerOf(link, me.platform, me.chat);
  // The caller learns the session from the HTTP response; only the waiter
  // (who never polls) gets woken, so nobody receives "found" twice.
  if (peer) {
    wakePeer(peer.platform, peer.chat, "found", {
      sessionId: session.id,
      partnerPlatform: me.platform,
    });
  }
  return link;
}

/** End the session if there is one; the peer gets "ended". */
function endSession(me: Pick<Who, "platform" | "chat">): boolean {
  const link = findDirectLinkByChat(me.chat, me.platform);
  if (!link || link.mode !== "anon") return false;
  deleteDirectLinkByChat(me.chat, me.platform);
  // Mapping rows cascade away with the link; drop the staged media too.
  try {
    fs.rmSync(path.join(config.mediaDir, "direct", link.id), { recursive: true, force: true });
  } catch {
    /* noop */
  }
  const peer = peerOf(link, me.platform, me.chat);
  if (peer) wakePeer(peer.platform, peer.chat, "ended", { sessionId: anonSessionId(link) });
  return true;
}

/**
 * Bots authenticate with x-bot-secret and identify via body; the web app
 * rides its session cookie and is always platform "web", chat = user id.
 */
function resolveWho(req: Request): Who | null {
  // Body identity is only trusted with the bot secret; otherwise anyone
  // could queue as, or tear down the session of, an arbitrary bot chat.
  if (isBotRequest(req)) {
    const parsed = joinSchema.safeParse(req.body ?? {});
    if (parsed.success) {
      const id = resolveJoiner(parsed.data);
      if (id) return { platform: id.platform, chat: id.chatId, username: resolveUsername(parsed.data, id.platform) };
    }
    return null;
  }
  const user = req.user;
  if (!user) return null;
  return { platform: "web", chat: user.id, username: user.name ?? user.email };
}

function requireWho(req: Request, res: Response): Who | null {
  const me = resolveWho(req);
  if (!me) {
    // Bots without identity sent a bad payload; browsers without a session
    // are simply logged out. The status code tells them apart.
    if (isBotRequest(req)) res.status(400).json({ error: "chat id required" });
    else res.status(401).json({ error: "unauthorized" });
    return null;
  }
  return me;
}

export function createAnonRouter(): Router {
  const router = Router();

  // Random matchmaking: pair with the oldest waiter (other platforms
  // first), otherwise park in the queue until someone else joins.
  router.post("/api/anon/join", (req: Request, res: Response) => {
    const me = requireWho(req, res);
    if (!me) return;
    const existing = findDirectLinkByChat(me.chat, me.platform);
    if (existing) {
      if (existing.mode !== "anon") {
        res.status(409).json({ error: "finish your direct chat first" });
        return;
      }
      res.json({ matched: true, session: sessionPayload(existing, me) });
      return;
    }
    const link = matchAndNotify(me);
    res.json(link ? { matched: true, session: sessionPayload(link, me) } : { matched: false, queued: true });
  });

  // Leave the queue, or end the session (chat history already delivered
  // stays on both devices; cross-delete stops working once unpaired).
  router.post("/api/anon/leave", (req: Request, res: Response) => {
    const me = requireWho(req, res);
    if (!me) return;
    const link = findDirectLinkByChat(me.chat, me.platform);
    if (link && link.mode !== "anon") {
      res.status(409).json({ error: "not in an anon chat" });
      return;
    }
    const wasQueued = leaveAnonQueue(me.platform, me.chat);
    res.json({ ok: true, ended: endSession(me), wasQueued });
  });

  // Stop this partner and immediately look for the next one.
  router.post("/api/anon/next", (req: Request, res: Response) => {
    const me = requireWho(req, res);
    if (!me) return;
    const link = findDirectLinkByChat(me.chat, me.platform);
    if (link && link.mode !== "anon") {
      res.status(409).json({ error: "finish your direct chat first" });
      return;
    }
    leaveAnonQueue(me.platform, me.chat);
    endSession(me);
    const next = matchAndNotify(me);
    res.json(next ? { matched: true, session: sessionPayload(next, me) } : { matched: false, queued: true });
  });

  router.get("/api/anon/status", (req: Request, res: Response) => {
    let me: Pick<Who, "platform" | "chat"> | null = null;
    // Query identity is bot-secret-gated like the body: an open query must
    // never resolve to someone else's chat.
    if (isBotRequest(req)) {
      const parsed = statusSchema.safeParse(req.query);
      if (parsed.success) me = resolveStatusIdentity(parsed.data);
    } else if (req.user) {
      // Web callers carry no identity in the query; the session is the id.
      me = { platform: "web", chat: req.user.id };
    }
    if (!me) {
      if (isBotRequest(req)) res.status(400).json({ error: "chat id required" });
      else res.status(401).json({ error: "unauthorized" });
      return;
    }
    const link = findDirectLinkByChat(me.chat, me.platform);
    res.json({
      inQueue: link ? false : Boolean(findAnonQueueEntry(me.platform, me.chat)),
      session: link && link.mode === "anon" ? sessionPayload(link, me) : null,
    });
  });

  return router;
}

export function deleteExpiredAnonQueue(): void {
  try {
    deleteStaleAnonQueue(10 * 60 * 1000);
  } catch (err) {
    log.error("anon queue cleanup failed", err);
  }
}
