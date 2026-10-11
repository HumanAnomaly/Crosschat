import type { IncomingMessage, ServerResponse } from "node:http";
import { createLogger } from "@crosschat/core";
import { whatsappConfig } from "./config.js";
import { translate } from "./i18n.js";
import type { AnyClient } from "./client.js";

const log = createLogger("whatsapp");

function t(key: string, vars?: Record<string, string | number>): string {
  return translate(whatsappConfig.locale, key, vars);
}

interface AnonSession {
  id: string;
  partnerPlatform: string | null;
}

function peerLabel(platform: string | null): string {
  if (platform === "telegram") return t("anon.peerTelegram");
  if (platform === "discord") return t("anon.peerDiscord");
  if (platform === "whatsapp") return t("anon.peerWhatsapp");
  if (platform === "web") return t("anon.peerWeb");
  return t("anon.peerUnknown");
}

function readSession(data: unknown): AnonSession | null {
  const session = (data as { session?: unknown })?.session as Partial<AnonSession> | undefined;
  if (!session || typeof session.id !== "string") return null;
  return { id: session.id, partnerPlatform: typeof session.partnerPlatform === "string" ? session.partnerPlatform : null };
}

function secretHeaders(): Record<string, string> {
  return { "content-type": "application/json", "x-bot-secret": whatsappConfig.webhookSecret };
}

async function postAnon(path: "join" | "leave" | "next", chatId: string, username: string | null): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${whatsappConfig.realtimeUrl}/api/anon/${path}`, {
    method: "POST",
    headers: secretHeaders(),
    body: JSON.stringify({
      whatsappChatId: chatId,
      whatsappUsername: username ?? undefined,
    }),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function getStatus(chatId: string): Promise<AnonSession | null> {
  const res = await fetch(
    `${whatsappConfig.realtimeUrl}/api/anon/status?whatsappChatId=${encodeURIComponent(chatId)}`,
    { headers: secretHeaders() },
  );
  if (!res.ok) return null;
  return readSession(await res.json().catch(() => null));
}

async function replyFound(reply: (text: string) => Promise<void>, session: AnonSession, already: boolean): Promise<void> {
  const partner = peerLabel(session.partnerPlatform);
  await reply(t(already ? "anon.already" : "anon.found", { session: session.id, partner: partner }));
}

export async function handleAnon(chatId: string, username: string | null, reply: (text: string) => Promise<void>): Promise<void> {
  if (!chatId) return;
  try {
    // Already chatting: say so instead of re-matching behind their back.
    const current = await getStatus(chatId);
    if (current) {
      await replyFound(reply, current, true);
      return;
    }
    const out = await postAnon("join", chatId, username);
    if (out.status === 409) {
      await reply(t("anon.busy"));
      return;
    }
    if (out.data && typeof out.data === "object" && (out.data as { matched?: boolean }).matched) {
      const session = readSession(out.data);
      if (session) await replyFound(reply, session, false);
      else await reply(t("common.backendDown"));
      return;
    }
    await reply(t("anon.searching"));
  } catch {
    await reply(t("common.backendDown"));
  }
}

export async function handleNext(chatId: string, username: string | null, reply: (text: string) => Promise<void>): Promise<void> {
  if (!chatId) return;
  try {
    const out = await postAnon("next", chatId, username);
    if (out.status === 409) {
      await reply(t("anon.busy"));
      return;
    }
    if (out.data && typeof out.data === "object" && (out.data as { matched?: boolean }).matched) {
      const session = readSession(out.data);
      if (session) await replyFound(reply, session, false);
      else await reply(t("common.backendDown"));
      return;
    }
    await reply(t("anon.searching"));
  } catch {
    await reply(t("common.backendDown"));
  }
}

export async function handleStop(chatId: string, username: string | null, reply: (text: string) => Promise<void>): Promise<void> {
  if (!chatId) return;
  try {
    const out = await postAnon("leave", chatId, username);
    if (out.status === 409) {
      await reply(t("anon.busy"));
      return;
    }
    const body = (out.data ?? {}) as { ended?: boolean; wasQueued?: boolean };
    if (body.ended) await reply(t("anon.stopped"));
    else if (body.wasQueued) await reply(t("anon.cancelled"));
    else await reply(t("anon.notInQueue"));
  } catch {
    await reply(t("common.backendDown"));
  }
}

function readBodyLimited(req: IncomingMessage, limit = 16_384): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = "";
    req.on("data", (chunk) => {
      size += (chunk as Buffer).length ?? String(chunk).length;
      if (size > limit) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      body += String(chunk);
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

export async function handleAnonNotify(client: AnyClient | null, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const secret = whatsappConfig.webhookSecret;
  if (!secret || req.headers["x-bot-secret"] !== secret) {
    res.writeHead(401);
    res.end("unauthorized");
    return;
  }
  try {
    const data = JSON.parse(await readBodyLimited(req)) as {
      chatId?: unknown;
      event?: unknown;
      sessionId?: unknown;
      partnerPlatform?: unknown;
    };
    if (typeof data.chatId !== "string" || data.chatId.length === 0) throw new Error("bad chatId");
    if (!client) throw new Error("whatsapp inactive");
    if (data.event === "found") {
      const session = typeof data.sessionId === "string" ? data.sessionId : "?";
      const partner = peerLabel(typeof data.partnerPlatform === "string" ? data.partnerPlatform : null);
      await client.message.send(data.chatId, t("anon.found", { session: session, partner: partner }));
    } else if (data.event === "ended") {
      const session = typeof data.sessionId === "string" ? data.sessionId : "?";
      await client.message.send(data.chatId, t("anon.ended", { session: session }));
    } else {
      throw new Error("bad event");
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    log.error("anon notify failed", err);
    res.writeHead(400);
    res.end("bad request");
  }
}
