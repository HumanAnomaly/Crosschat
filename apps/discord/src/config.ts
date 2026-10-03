import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

function loadEnvOnce(): void {
  let dir = process.cwd();
  while (true) {
    const file = path.join(dir, ".env");
    if (fs.existsSync(file)) {
      dotenv.config({ path: file });
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dotenv.config();
}

loadEnvOnce();

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const discordConfig = {
  token: process.env.DISCORD_BOT_TOKEN ?? "",
  clientId: process.env.DISCORD_CLIENT_ID ?? "",
  guildId: process.env.DISCORD_GUILD_ID ?? "",
  webhookSecret: process.env.DISCORD_WEBHOOK_SECRET ?? process.env.TELEGRAM_WEBHOOK_SECRET ?? "",
  realtimeUrl: (process.env.REALTIME_URL ?? "http://localhost:8362").replace(/\/+$/, ""),
  port: num(process.env.DISCORD_PORT ?? "8365", 8365),
  locale: process.env.DISCORD_LOCALE ?? process.env.TELEGRAM_LOCALE ?? "en",
  pairTtlSec: num(process.env.PAIR_CODE_TTL_SEC ?? "300", 300),
  rateMax: num(process.env.PAIR_RATE_LIMIT_MAX ?? "5", 5),
  rateWindowMs: 60 * 1000,
  downloadMaxBytes: 20 * 1024 * 1024,
  uploadMaxBytes: 50 * 1024 * 1024,
} as const;

export type DiscordConfig = typeof discordConfig;
