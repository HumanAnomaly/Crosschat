import { createLogger, makePairingCode, normalizeWhatsappUsername, parsePairingCode } from "@crosschat/core";
import { whatsappConfig } from "./config.js";
import { translate } from "./i18n.js";

const log = createLogger("whatsapp");

export const wiredChats = new Set<string>();

const pendingClaim = new Map<string, number>();
const rateHits = new Map<string, number[]>();
const PENDING_TTL_MS = 10 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [k, ts] of pendingClaim) {
    if (now - ts > PENDING_TTL_MS) pendingClaim.delete(k);
  }
  for (const [k, v] of rateHits) {
    const kept = v.filter((t) => now - t < whatsappConfig.rateWindowMs);
    if (kept.length === 0) rateHits.delete(k);
    else rateHits.set(k, kept);
  }
}, 60 * 1000).unref?.();

function t(key: string, vars?: Record<string, string | number>): string {
  return translate(whatsappConfig.locale, key, vars);
}

function backend() {
  return { base: whatsappConfig.realtimeUrl, secret: whatsappConfig.webhookSecret };
}

function headers() {
  return { "content-type": "application/json", "x-bot-secret": backend().secret };
}

export function isWired(chatId: string): boolean {
  return wiredChats.has(chatId);
}

export function markWired(chatId: string): void {
  wiredChats.add(chatId);
  pendingClaim.delete(chatId);
}

export function markUnwired(chatId: string): void {
  wiredChats.delete(chatId);
  pendingClaim.delete(chatId);
}

export interface LinkStatus {
  wired: boolean;
  platformId?: string;
  connection?: { id: string; createdAt: string };
  user?: { email: string | null; name: string | null };
  stats?: { total: number; fromWeb: number; fromTelegram: number; fromDiscord?: number; fromWhatsapp?: number; lastMessageAt: string | null };
}

export async function fetchLinkStatus(chatId: string): Promise<LinkStatus | null> {
  try {
    const res = await fetch(
      `${backend().base}/api/pair/status?whatsappChatId=${encodeURIComponent(chatId)}`,
      { headers: { "x-bot-secret": backend().secret } },
    );
    if (!res.ok) {
      if (res.status !== 404) {
        log.warn(`pair/status -> ${res.status} (backend reachable, check x-bot-secret)`);
      }
      return null;
    }
    return (await res.json()) as LinkStatus;
  } catch (err) {
    log.error(`pair/status unreachable (${backend().base})`, err);
    return null;
  }
}

export function isRateLimited(chatId: string): boolean {
  const now = Date.now();
  const window = (rateHits.get(chatId) ?? []).filter((stamp) => now - stamp < whatsappConfig.rateWindowMs);
  window.push(now);
  rateHits.set(chatId, window);
  return window.length > whatsappConfig.rateMax;
}

export function usernameOf(remoteJid: string | null | undefined): string | null {
  if (!remoteJid) return null;
  const user = remoteJid.split("@")[0] ?? "";
  return normalizeWhatsappUsername(user);
}

export interface ReplyTarget {
  reply: (text: string) => Promise<void>;
  chatId: string;
  username: string | null;
}

export async function handleWiredRequest(target: ReplyTarget): Promise<void> {
  const chatId = target.chatId;
  if (!chatId) return;
  if (isWired(chatId)) {
    await target.reply(t("wired.alreadyLinked"));
    return;
  }
  if (isRateLimited(chatId)) {
    await target.reply(t("common.rateLimited"));
    return;
  }
  pendingClaim.set(chatId, Date.now());
  await target.reply(t("wired.askCode"));
}

export async function handleCreateCode(target: ReplyTarget): Promise<void> {
  const chatId = target.chatId;
  if (!chatId) return;
  if (isWired(chatId)) {
    await target.reply(t("wired.alreadyLinked"));
    return;
  }
  if (isRateLimited(chatId)) {
    await target.reply(t("common.rateLimited"));
    return;
  }
  const code = makePairingCode();
  try {
    const res = await fetch(`${backend().base}/api/pair/create`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        code,
        whatsappChatId: chatId,
        platformId: "whatsapp",
        whatsappUsername: target.username ?? undefined,
        ttlSec: whatsappConfig.pairTtlSec,
      }),
    });
    if (!res.ok) throw new Error(`backend ${res.status}`);
  } catch {
    await target.reply(t("common.backendDown"));
    return;
  }
  pendingClaim.delete(chatId);
  await target.reply(t("wired.codeMessage", { code, minutes: Math.round(whatsappConfig.pairTtlSec / 60) }));
}

export async function handleCodeInput(target: ReplyTarget, raw: string): Promise<boolean> {
  const chatId = target.chatId;
  if (!chatId) return false;
  const ts = pendingClaim.get(chatId);
  if (ts == null || Date.now() - ts > PENDING_TTL_MS) {
    pendingClaim.delete(chatId);
    return false;
  }
  const code = parsePairingCode(raw);
  if (!code) {
    await target.reply(t("wired.invalidFormat"));
    return true;
  }
  if (isRateLimited(chatId)) {
    await target.reply(t("common.rateLimitedAttempts"));
    return true;
  }
  try {
    const res = await fetch(`${backend().base}/api/pair/claim`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        code,
        whatsappChatId: chatId,
        platformId: "whatsapp",
        whatsappUsername: target.username ?? undefined,
      }),
    });
    if (!res.ok) {
      const hint = res.status === 404 || res.status === 410 ? t("wired.unknownCode") : t("wired.rejectedCode");
      await target.reply(hint);
      return true;
    }
  } catch {
    await target.reply(t("media.backendDown"));
    return true;
  }
  markWired(chatId);
  await target.reply(t("wired.linked", { account: t("wired.unknownAccount") }));
  return true;
}
