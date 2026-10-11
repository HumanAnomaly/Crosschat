import { InlineKeyboard, type Context } from "grammy";
import { makePairingCode, parsePairingCode } from "@crosschat/core";
import { telegramConfig } from "./config.js";
import { translate } from "./i18n.js";

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
    const kept = v.filter((t) => now - t < telegramConfig.rateWindowMs);
    if (kept.length === 0) rateHits.delete(k);
    else rateHits.set(k, kept);
  }
}, 60 * 1000).unref?.();

function t(key: string, vars?: Record<string, string | number>): string {
  return translate(telegramConfig.locale, key, vars);
}

function backend() {
  return { base: telegramConfig.realtimeUrl, secret: telegramConfig.webhookSecret };
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
  connection?: { id: string; createdAt: string };
  user?: { email: string | null; name: string | null };
  stats?: { total: number; fromWeb: number; fromTelegram: number; lastMessageAt: string | null };
}

export async function fetchLinkStatus(chatId: string): Promise<LinkStatus | null> {
  try {
    const res = await fetch(
      `${backend().base}/api/pair/status?telegramChatId=${encodeURIComponent(chatId)}`,
      { headers: { "x-bot-secret": backend().secret } },
    );
    if (!res.ok) return null;
    return (await res.json()) as LinkStatus;
  } catch {
    return null;
  }
}

export function isRateLimited(chatId: string): boolean {
  const now = Date.now();
  const window = (rateHits.get(chatId) ?? []).filter((stamp) => now - stamp < telegramConfig.rateWindowMs);
  window.push(now);
  rateHits.set(chatId, window);
  return window.length > telegramConfig.rateMax;
}

export function usernameOf(ctx: { from?: { username?: string } }): string | null {
  const u = ctx.from?.username?.trim().replace(/^@+/, "");
  return u && /^[A-Za-z0-9_]{1,32}$/.test(u) ? u : null;
}

export function wiredKeyboard(wired: boolean): InlineKeyboard {
  if (wired) return new InlineKeyboard().text(t("buttons.disconnect"), "unwire");
  return new InlineKeyboard().text(t("buttons.wired"), "wire").text(t("buttons.newCode"), "newcode");
}

export async function handleWiredRequest(ctx: Context): Promise<void> {
  const chatId = String(ctx.chat?.id ?? "");
  if (!chatId) return;
  if (isWired(chatId)) {
    await ctx.reply(t("wired.alreadyLinked"), { reply_markup: wiredKeyboard(true) });
    return;
  }
  if (isRateLimited(chatId)) {
    await ctx.reply(t("common.rateLimited"));
    return;
  }
  pendingClaim.set(chatId, Date.now());
  await ctx.reply(t("wired.askCode"), {
    reply_markup: new InlineKeyboard().text(t("buttons.newCode"), "newcode"),
  });
}

export async function handleCreateCode(ctx: Context): Promise<void> {
  const chatId = String(ctx.chat?.id ?? "");
  if (!chatId) return;
  if (isWired(chatId)) {
    await ctx.reply(t("wired.alreadyLinked"), { reply_markup: wiredKeyboard(true) });
    return;
  }
  if (isRateLimited(chatId)) {
    await ctx.reply(t("common.rateLimited"));
    return;
  }
  const code = makePairingCode();
  try {
    const username = ctx.from?.username ?? undefined;
    const res = await fetch(`${backend().base}/api/pair/create`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ code, telegramChatId: chatId, telegramUsername: username, ttlSec: telegramConfig.pairTtlSec }),
    });
    if (!res.ok) throw new Error(`backend ${res.status}`);
  } catch {
    await ctx.reply(t("common.backendDown"));
    return;
  }
  pendingClaim.delete(chatId);
  await ctx.reply(
    t("wired.codeMessage", { code, minutes: Math.round(telegramConfig.pairTtlSec / 60) }),
  );
}

export async function handleCodeInput(ctx: Context, raw: string): Promise<boolean> {
  const chatId = String(ctx.chat?.id ?? "");
  if (!chatId) return false;
  const ts = pendingClaim.get(chatId);
  if (ts == null || Date.now() - ts > PENDING_TTL_MS) {
    pendingClaim.delete(chatId);
    return false;
  }

  const code = parsePairingCode(raw);
  if (!code) {
    await ctx.reply(t("wired.invalidFormat"));
    return true;
  }
  if (isRateLimited(chatId)) {
    await ctx.reply(t("common.rateLimitedAttempts"));
    return true;
  }
  try {
    const username = ctx.from?.username ?? undefined;
    const res = await fetch(`${backend().base}/api/pair/claim`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ code, telegramChatId: chatId, telegramUsername: username }),
    });
    if (res.ok) {
      markWired(chatId);
      await ctx.reply(t("wired.linked"), { reply_markup: wiredKeyboard(true) });
      return true;
    }
    // Web claim failed — maybe this is a platform-to-platform code
    // (created via /newcode on Discord/WhatsApp/Telegram). Try direct.
    if (res.status !== 404 && res.status !== 400 && res.status !== 410) {
      await ctx.reply(t("wired.rejectedCode"));
      return true;
    }
    const direct = await fetch(`${backend().base}/api/direct/claim`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ code, telegramChatId: chatId, telegramUsername: username }),
    });
    if (!direct.ok) {
      const hint =
        direct.status === 404 || direct.status === 410 ? t("wired.unknownCode") : t("wired.rejectedCode");
      await ctx.reply(hint);
      return true;
    }
  } catch {
    await ctx.reply(t("media.backendDown"));
    return true;
  }
  markWired(chatId);
  await ctx.reply(t("wired.linked"), { reply_markup: wiredKeyboard(true) });
  return true;
}
