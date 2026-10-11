import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  normalizeDiscordUsername,
  normalizeTelegramUsername,
  normalizeWhatsappUsername,
  parsePairingCode,
  safeFilename,
} from "@crosschat/core";
import {
  countDirectMessagesForLink,
  createDirectLink,
  deleteDirectLinkByChat,
  deleteDirectMessagesForLink,
  findDirectLinkByChat,
  findDirectLinkById,
  findDirectMessagesByPeer,
  findDirectMessagesBySource,
  findPairingCode,
  insertDirectMessage,
  leaveAnonQueue,
  markCodeUsed,
  peerOf,
  type DirectLinkRow,
} from "./db.js";
import { db } from "./db.js";
import { config } from "./env.js";
import { isBotRequest } from "./security.js";
import { sendTelegramToChat, deleteTelegramMessage } from "./telegram-bridge.js";
import { sendDiscordToUser, deleteDiscordMessage } from "./discord-bridge.js";
import { sendWhatsappToChat, deleteWhatsappMessage } from "./whatsapp-bridge.js";
// Cycle with socket.js (it imports forwardDirectMessage below). Both sides
// only call each other inside request handlers, never at module top level,
// so the live bindings are settled by the time anything runs.
import { emitToUser } from "./socket.js";

type Platform = "telegram" | "discord" | "whatsapp" | "web";

const MAX_DIRECT_BYTES = 20 * 1024 * 1024;

const claimSchema = z.object({
  code: z.string().min(1).max(16),
  chatId: z.string().min(1).max(128).optional(),
  telegramChatId: z.string().min(1).max(64).optional(),
  discordChatId: z.string().min(1).max(64).optional(),
  whatsappChatId: z.string().min(1).max(128).optional(),
  platformId: z.enum(["telegram", "discord", "whatsapp"]).optional(),
  telegramUsername: z.string().min(1).max(34).optional(),
  discordUsername: z.string().min(1).max(37).optional(),
  whatsappUsername: z.string().min(1).max(32).optional(),
});

export interface ChatIdentity {
  chatId?: string;
  telegramChatId?: string;
  discordChatId?: string;
  whatsappChatId?: string;
  platformId?: string;
}

export function resolveJoiner(data: ChatIdentity): { chatId: string; platform: Platform } | null {
  if (data.telegramChatId) return { chatId: data.telegramChatId, platform: "telegram" };
  if (data.discordChatId) return { chatId: data.discordChatId, platform: "discord" };
  if (data.whatsappChatId) return { chatId: data.whatsappChatId, platform: "whatsapp" };
  if (data.chatId) {
    const platform: Platform =
      data.platformId === "discord" || data.platformId === "whatsapp" ? data.platformId : "telegram";
    return { chatId: data.chatId, platform };
  }
  return null;
}

export function resolveUsername(
  data: { telegramUsername?: string; discordUsername?: string; whatsappUsername?: string },
  platform: Platform,
): string | null {
  if (platform === "discord") {
    return (
      normalizeDiscordUsername(data.discordUsername) ??
      normalizeTelegramUsername(data.telegramUsername) ??
      (typeof data.discordUsername === "string" ? data.discordUsername.slice(0, 32) : null)
    );
  }
  if (platform === "whatsapp") {
    return (
      normalizeWhatsappUsername(data.whatsappUsername) ??
      normalizeWhatsappUsername(data.telegramUsername) ??
      (typeof data.whatsappUsername === "string" ? data.whatsappUsername.slice(0, 32) : null)
    );
  }
  return normalizeTelegramUsername(data.telegramUsername) ?? normalizeDiscordUsername(data.discordUsername);
}

function linkPayload(link: DirectLinkRow) {
  return {
    id: link.id,
    aPlatform: link.a_platform,
    aChat: link.a_chat,
    bPlatform: link.b_platform,
    bChat: link.b_chat,
    createdAt: new Date(link.created_at).toISOString(),
  };
}

async function notifyPeerLinked(platform: Platform, chatId: string): Promise<void> {
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
  if (!secret) return;
  try {
    await fetch(`${base}/notify/linked`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bot-secret": secret },
      body: JSON.stringify({ chatId }),
    });
  } catch (err) {
    console.error("direct notify linked failed", err);
  }
}

async function notifyPeerUnlinked(platform: Platform, chatId: string): Promise<void> {
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
  if (!secret) return;
  try {
    await fetch(`${base}/notify/disconnect`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bot-secret": secret },
      body: JSON.stringify({ chatId }),
    });
  } catch (err) {
    console.error("direct notify disconnect failed", err);
  }
}

export interface DirectInboundInput {
  kind: string;
  text?: string | null;
  mime?: string | null;
  filename?: string | null;
  fileBase64?: string | null;
  size?: number | null;
  platformMsgId?: string | null;
  /** Prepended to text/caption so the peer sees who sent it (anon mode). */
  prefix?: string | null;
}

/** Store media under data/media/direct/<linkId>/ and forward to the peer. */
export async function forwardDirectMessage(
  linkId: string,
  sourcePlatform: Platform,
  sourceChat: string,
  input: DirectInboundInput,
): Promise<{ peerMessageId: string | null }> {
  const link = findDirectLinkById(linkId);
  if (!link) return { peerMessageId: null };
  const peer = peerOf(link, sourcePlatform, sourceChat);
  if (!peer) return { peerMessageId: null };

  let fileAbsPath: string | null = null;
  let filename = input.filename ?? "file";
  if (input.fileBase64 && input.kind !== "text") {
    try {
      const buf = Buffer.from(input.fileBase64, "base64");
      if (buf.length > MAX_DIRECT_BYTES) {
        console.error(`forwardDirectMessage: file too large (${buf.length} bytes)`);
      } else {
        const dir = path.join(config.mediaDir, "direct", link.id);
        fs.mkdirSync(dir, { recursive: true });
        const safe = safeFilename(filename);
        const stored = path.join(dir, `${randomUUID()}-${safe}`);
        fs.writeFileSync(stored, buf);
        fileAbsPath = stored;
        filename = safe;
      }
    } catch (err) {
      console.error("forwardDirectMessage: save file failed", err);
    }
  }

  const prefix = peer?.platform === "web" ? "" : input.prefix ? `${input.prefix}\n` : "";
  const text = `${prefix}${input.text ?? ""}`.slice(0, 4000);
  try {
    // Web peers have no bot API: wake their open sockets instead. The id
    // doubles as the peer message id for the mapping table.
    if (peer.platform === "web") {
      const id = randomUUID();
      emitToUser(peer.chat, "anon:new", {
        id,
        sender: sourcePlatform,
        kind: input.kind,
        text,
        createdAt: new Date().toISOString(),
        sessionId: anonSessionId(link),
      });
      return { peerMessageId: id };
    }
    if (peer.platform === "telegram") {
      const r = await sendTelegramToChat(peer.chat, {
        kind: input.kind,
        text,
        mime: input.mime ?? undefined,
        fileAbsPath,
        filename,
      });
      return { peerMessageId: r.telegramMessageId };
    }
    if (peer.platform === "discord") {
      const r = await sendDiscordToUser(peer.chat, {
        kind: input.kind,
        text,
        mime: input.mime ?? undefined,
        fileAbsPath,
        filename,
      });
      return { peerMessageId: r.discordMessageId };
    }
    let fileBase64: string | undefined;
    if (fileAbsPath && fs.existsSync(fileAbsPath)) {
      try {
        fileBase64 = (await fs.promises.readFile(fileAbsPath)).toString("base64");
      } catch {
        fileBase64 = input.fileBase64 ?? undefined;
      }
    } else if (input.fileBase64) {
      fileBase64 = input.fileBase64;
    }
    const r = await sendWhatsappToChat(peer.chat, {
      kind: input.kind,
      text,
      mime: input.mime ?? undefined,
      filename,
      fileBase64,
    });
    return { peerMessageId: r.whatsappMessageId };
  } catch (err) {
    console.error("forwardDirectMessage failed", err);
    return { peerMessageId: null };
  }
}

/** Short public id shown in the "partner found" message. */
export function anonSessionId(link: DirectLinkRow): string {
  return link.id.replace(/-/g, "").slice(0, 6).toUpperCase();
}

/** Sender tag the peer sees on every relayed message of an anon session. */
export function anonPrefix(platform: Platform): string {
  const label =
    platform === "discord" ? "Discord" : platform === "whatsapp" ? "WhatsApp" : platform === "web" ? "Web" : "Telegram";
  return `👤 ${label}`;
}

/** Delete a peer copy for a direct message (both directions). */
export async function eraseDirectCopy(
  platform: Platform,
  platformMsgId: string,
  chatId?: string,
): Promise<{ deleted: boolean; id: string | null }> {
  const sources = findDirectMessagesBySource(platformMsgId, platform);
  const asPeer = findDirectMessagesByPeer(platformMsgId, platform);
  const candidates = [...sources, ...asPeer];
  let scoped = candidates;
  if (chatId) {
    scoped = candidates.filter((r) => {
      const link = findDirectLinkById(r.link_id);
      if (!link) return false;
      return link.a_chat === chatId || link.b_chat === chatId;
    });
    if (scoped.length === 0) return { deleted: false, id: null };
  }
  let lastId: string | null = null;
  let deleted = false;
  for (const row of scoped) {
    const link = findDirectLinkById(row.link_id);
    if (!link) continue;
    const isSource = row.source_platform === platform;
    const peerPlatform = (isSource ? row.peer_platform : row.source_platform) as Platform;
    const peerMsgId = isSource ? row.peer_msg_id : row.source_msg_id;
    try {
      db.prepare("DELETE FROM direct_messages WHERE id = ?").run(row.id);
    } catch {
      /* noop */
    }
    lastId = row.id;
    deleted = true;
    if (!peerMsgId) continue;
    const peerChat = peerPlatform === link.a_platform ? link.a_chat : link.b_chat;
    try {
      // Web bubbles live only in the peer's browser: no remote delete
      // possible, the mapping row above is still dropped.
      if (peerPlatform === "web") continue;
      if (peerPlatform === "telegram") await deleteTelegramMessage(peerChat, peerMsgId);
      else if (peerPlatform === "discord") await deleteDiscordMessage(peerChat, peerMsgId);
      else await deleteWhatsappMessage(peerChat, peerMsgId);
    } catch (err) {
      console.error("eraseDirectCopy: peer delete failed", err);
    }
  }
  return { deleted, id: lastId };
}

export function createDirectRouter(): Router {
  const router = Router();

  // Bot-to-bot claim: joiner redeems the initiator's platform code.
  router.post("/api/direct/claim", (req: Request, res: Response) => {
    if (!isBotRequest(req)) {
      res.status(401).json({ error: "unauthorized" });
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
    const joiner = resolveJoiner(parsed.data);
    if (!joiner) {
      res.status(400).json({ error: "chat id required" });
      return;
    }
    const row = findPairingCode(code);
    if (!row || row.used === 1 || row.expires_at < Date.now()) {
      res.status(404).json({ error: "code expired or not found" });
      return;
    }
    // Web-initiated codes belong to the web flow.
    if (row.user_id !== null) {
      res.status(400).json({ error: "code must be claimed from web" });
      return;
    }
    if (!row.telegram_chat_id) {
      res.status(410).json({ error: "code has no owner" });
      return;
    }
    const initiatorPlatform = (row.platform_id ?? "telegram") as Platform;
    const initiatorChat = row.telegram_chat_id;
    const initiatorUsername = row.telegram_username ?? null;
    if (initiatorPlatform === joiner.platform && initiatorChat === joiner.chatId) {
      res.status(400).json({ error: "cannot link to self" });
      return;
    }
    if (findDirectLinkByChat(initiatorChat, initiatorPlatform)) {
      res.status(409).json({ error: "initiator already linked" });
      return;
    }
    if (findDirectLinkByChat(joiner.chatId, joiner.platform)) {
      res.status(409).json({ error: "chat already linked" });
      return;
    }
    const joinerUsername = resolveUsername(parsed.data, joiner.platform);
    let link: DirectLinkRow;
    try {
      link = createDirectLink({
        id: randomUUID(),
        aPlatform: initiatorPlatform,
        aChat: initiatorChat,
        aUsername: initiatorUsername,
        bPlatform: joiner.platform,
        bChat: joiner.chatId,
        bUsername: joinerUsername,
      });
    } catch {
      res.status(409).json({ error: "chat already linked" });
      return;
    }
    markCodeUsed(code);
    // Linked chats can't be anon waiters: drop any stale queue rows so a
    // later joiner never matches a chat that is already paired.
    leaveAnonQueue(initiatorPlatform, initiatorChat);
    leaveAnonQueue(joiner.platform, joiner.chatId);
    void notifyPeerLinked(initiatorPlatform, initiatorChat);
    res.status(201).json({ link: linkPayload(link) });
  });

  // Native delete propagation for P2P copies.
  router.post("/api/direct/delete", (req: Request, res: Response) => {
    if (!isBotRequest(req)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const parsed = z
      .object({
        chatId: z.string().min(1).max(128).optional(),
        telegramChatId: z.string().min(1).max(64).optional(),
        discordChatId: z.string().min(1).max(64).optional(),
        whatsappChatId: z.string().min(1).max(128).optional(),
        platformMsgId: z.string().min(1).max(128).optional(),
        telegramMessageId: z.string().min(1).max(64).optional(),
        discordMessageId: z.string().min(1).max(64).optional(),
        whatsappMessageId: z.string().min(1).max(128).optional(),
        platformId: z.enum(["telegram", "discord", "whatsapp"]).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid payload" });
      return;
    }
    const platform: Platform =
      parsed.data.platformId ??
      (parsed.data.telegramChatId || parsed.data.telegramMessageId
        ? "telegram"
        : parsed.data.discordChatId || parsed.data.discordMessageId
          ? "discord"
          : parsed.data.whatsappChatId || parsed.data.whatsappMessageId
            ? "whatsapp"
            : "telegram");
    const platformMsgId =
      parsed.data.platformMsgId ??
      (platform === "telegram"
        ? parsed.data.telegramMessageId
        : platform === "discord"
          ? parsed.data.discordMessageId
          : parsed.data.whatsappMessageId);
    if (!platformMsgId) {
      res.status(400).json({ error: "platform message id required" });
      return;
    }
    const chatId =
      parsed.data.chatId ?? parsed.data.telegramChatId ?? parsed.data.discordChatId ?? parsed.data.whatsappChatId;
    void eraseDirectCopy(platform, platformMsgId, chatId).then(
      (r) => {
        if (!res.headersSent) res.json({ ok: true, deleted: r.deleted, id: r.id });
      },
      (err) => {
        console.error("direct delete failed", err);
        if (!res.headersSent) res.status(500).json({ error: "delete failed" });
      },
    );
  });

  router.get("/api/direct/status", (req: Request, res: Response) => {
    if (!isBotRequest(req)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const chatId =
      (typeof req.query.chatId === "string" ? req.query.chatId : "") ||
      (typeof req.query.telegramChatId === "string" ? req.query.telegramChatId : "") ||
      (typeof req.query.discordChatId === "string" ? req.query.discordChatId : "") ||
      (typeof req.query.whatsappChatId === "string" ? req.query.whatsappChatId : "");
    const platform =
      typeof req.query.telegramChatId === "string" && req.query.telegramChatId
        ? "telegram"
        : typeof req.query.discordChatId === "string" && req.query.discordChatId
          ? "discord"
          : typeof req.query.whatsappChatId === "string" && req.query.whatsappChatId
            ? "whatsapp"
            : typeof req.query.platformId === "string"
              ? req.query.platformId
              : "telegram";
    if (!chatId) {
      res.status(400).json({ error: "chat id required" });
      return;
    }
    const link = findDirectLinkByChat(chatId, platform);
    if (!link) {
      res.json({ wired: false });
      return;
    }
    const peer = peerOf(link, platform, chatId);
    res.json({
      wired: true,
      mode: link.mode,
      link: linkPayload(link),
      peer,
      stats: { total: countDirectMessagesForLink(link.id) },
    });
  });

  router.post("/api/direct/disconnect", (req: Request, res: Response) => {
    if (!isBotRequest(req)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const parsed = z
      .object({
        chatId: z.string().min(1).max(128).optional(),
        telegramChatId: z.string().min(1).max(64).optional(),
        discordChatId: z.string().min(1).max(64).optional(),
        whatsappChatId: z.string().min(1).max(128).optional(),
        platformId: z.string().min(1).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid payload" });
      return;
    }
    const chatId =
      parsed.data.chatId ?? parsed.data.telegramChatId ?? parsed.data.discordChatId ?? parsed.data.whatsappChatId;
    if (!chatId) {
      res.status(400).json({ error: "chat id required" });
      return;
    }
    const platform = parsed.data.telegramChatId
      ? "telegram"
      : parsed.data.discordChatId
        ? "discord"
        : parsed.data.whatsappChatId
          ? "whatsapp"
          : parsed.data.platformId === "discord" || parsed.data.platformId === "whatsapp"
            ? parsed.data.platformId
            : "telegram";
    const removed = deleteDirectLinkByChat(chatId, platform);
    if (!removed) {
      res.json({ ok: true });
      return;
    }
    try {
      deleteDirectMessagesForLink(removed.id);
    } catch {
      /* noop */
    }
    try {
      fs.rmSync(path.join(config.mediaDir, "direct", removed.id), { recursive: true, force: true });
    } catch {
      /* noop */
    }
    const peer = peerOf(removed, platform, chatId);
    if (peer) {
      // A web peer has no bot push endpoint; wake its sockets so the UI can
      // drop the session immediately instead of discovering it on next send.
      if (peer.platform === "web" && removed.mode === "anon")
        emitToUser(peer.chat, "anon:ended", { sessionId: anonSessionId(removed) });
      else if (peer.platform !== "web") void notifyPeerUnlinked(peer.platform as Platform, peer.chat);
    }
    res.json({ ok: true });
  });

  return router;
}

export async function forwardToDirectPeer(opts: {
  sourcePlatform: Platform;
  sourceChat: string;
  kind: string;
  text?: string | null;
  mime?: string | null;
  filename?: string | null;
  fileBase64?: string | null;
  size?: number | null;
  platformMsgId?: string | null;
}): Promise<void> {
  const link = findDirectLinkByChat(opts.sourceChat, opts.sourcePlatform);
  if (!link) return;
  const peer = peerOf(link, opts.sourcePlatform, opts.sourceChat);
  if (!peer) return;
  const { peerMessageId } = await forwardDirectMessage(link.id, opts.sourcePlatform, opts.sourceChat, {
    kind: opts.kind,
    text: opts.text ?? null,
    mime: opts.mime ?? null,
    filename: opts.filename ?? "file",
    fileBase64: opts.fileBase64 ?? null,
    size: opts.size ?? null,
    platformMsgId: opts.platformMsgId ?? null,
    prefix: link.mode === "anon" ? anonPrefix(opts.sourcePlatform) : null,
  });
  try {
    insertDirectMessage({
      linkId: link.id,
      sourcePlatform: opts.sourcePlatform,
      sourceMsgId: opts.platformMsgId ?? randomUUID(),
      peerPlatform: peer.platform,
      peerMsgId: peerMessageId,
      kind: opts.kind,
    });
  } catch (err) {
    console.error("direct message map failed", err);
  }
}
