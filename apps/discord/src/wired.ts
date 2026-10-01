import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { makePairingCode, parsePairingCode } from "@crosschat/core";
import { discordConfig } from "./config.js";
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
    const kept = v.filter((t) => now - t < discordConfig.rateWindowMs);
    if (kept.length === 0) rateHits.delete(k);
    else rateHits.set(k, kept);
  }
}, 60 * 1000).unref?.();

function t(key: string, vars?: Record<string, string | number>): string {
  return translate(discordConfig.locale, key, vars);
}

function backend() {
  return { base: discordConfig.realtimeUrl, secret: discordConfig.webhookSecret };
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
  stats?: { total: number; fromWeb: number; fromTelegram: number; fromDiscord?: number; lastMessageAt: string | null };
}

export async function fetchLinkStatus(chatId: string): Promise<LinkStatus | null> {
  try {
    const res = await fetch(
      `${backend().base}/api/pair/status?chatId=${encodeURIComponent(chatId)}&platformId=discord`,
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
  const window = (rateHits.get(chatId) ?? []).filter((stamp) => now - stamp < discordConfig.rateWindowMs);
  window.push(now);
  rateHits.set(chatId, window);
  return window.length > discordConfig.rateMax;
}

export function usernameOf(user: { username?: string } | null | undefined): string | null {
  const u = user?.username?.trim().replace(/^@+/, "").toLowerCase();
  return u && /^[a-z0-9_.]{2,32}$/.test(u) ? u : null;
}

export function actionRow(wired: boolean): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (wired) {
    row.addComponents(
      new ButtonBuilder().setCustomId("unwire").setLabel(t("buttons.disconnect")).setStyle(ButtonStyle.Danger),
    );
  } else {
    row.addComponents(
      new ButtonBuilder().setCustomId("wire").setLabel(t("buttons.wired")).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("newcode").setLabel(t("buttons.newCode")).setStyle(ButtonStyle.Secondary),
    );
  }
  return row;
}

export interface ReplyTarget {
  reply: (text: string, wired: boolean) => Promise<void>;
  userId: string;
  username: string | null;
}

export async function handleWiredRequest(target: ReplyTarget): Promise<void> {
  const chatId = target.userId;
  if (!chatId) return;
  if (isWired(chatId)) {
    await target.reply(t("wired.alreadyLinked"), true);
    return;
  }
  if (isRateLimited(chatId)) {
    await target.reply(t("common.rateLimited"), false);
    return;
  }
  pendingClaim.set(chatId, Date.now());
  await target.reply(t("wired.askCode"), false);
}

export async function handleCreateCode(target: ReplyTarget): Promise<void> {
  const chatId = target.userId;
  if (!chatId) return;
  if (isWired(chatId)) {
    await target.reply(t("wired.alreadyLinked"), true);
    return;
  }
  if (isRateLimited(chatId)) {
    await target.reply(t("common.rateLimited"), false);
    return;
  }
  const code = makePairingCode();
  try {
    const res = await fetch(`${backend().base}/api/pair/create`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        code,
        discordChatId: chatId,
        platformId: "discord",
        discordUsername: target.username ?? undefined,
        ttlSec: discordConfig.pairTtlSec,
      }),
    });
    if (!res.ok) throw new Error(`backend ${res.status}`);
  } catch {
    await target.reply(t("common.backendDown"), false);
    return;
  }
  pendingClaim.delete(chatId);
  await target.reply(t("wired.codeMessage", { code, minutes: Math.round(discordConfig.pairTtlSec / 60) }), false);
}

export async function handleCodeInput(
  target: ReplyTarget,
  raw: string,
  opts?: { skipPending?: boolean },
): Promise<boolean> {
  const chatId = target.userId;
  if (!chatId) return false;
  if (!opts?.skipPending) {
    const ts = pendingClaim.get(chatId);
    if (ts == null || Date.now() - ts > PENDING_TTL_MS) {
      pendingClaim.delete(chatId);
      return false;
    }
  }

  const code = parsePairingCode(raw);
  if (!code) {
    await target.reply(t("wired.invalidFormat"), false);
    return true;
  }
  if (isRateLimited(chatId)) {
    await target.reply(t("common.rateLimitedAttempts"), false);
    return true;
  }
  try {
    const res = await fetch(`${backend().base}/api/pair/claim`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        code,
        discordChatId: chatId,
        platformId: "discord",
        discordUsername: target.username ?? undefined,
      }),
    });
    if (!res.ok) {
      const hint = res.status === 404 || res.status === 410 ? t("wired.unknownCode") : t("wired.rejectedCode");
      await target.reply(hint, false);
      return true;
    }
  } catch {
    await target.reply(t("media.backendDown"), false);
    return true;
  }
  markWired(chatId);
  await target.reply(t("wired.linked", { account: t("wired.unknownAccount") }), true);
  return true;
}
