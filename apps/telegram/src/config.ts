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

const nodeEnv = (process.env.NODE_ENV ?? "development").toLowerCase();
const configuredMode = (process.env.TELEGRAM_MODE ?? "").toLowerCase();

export const telegramConfig = {
  token: process.env.TELEGRAM_BOT_TOKEN ?? "",
  webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? "",
  mode: configuredMode === "webhook" || configuredMode === "polling"
    ? configuredMode
    : nodeEnv === "production"
      ? "webhook"
      : "polling",
  appUrlProd: (process.env.APP_URL_PROD ?? "").replace(/\/+$/, ""),
  realtimeUrl: (process.env.REALTIME_URL ?? "http://localhost:8362").replace(/\/+$/, ""),
  port: num(process.env.TELEGRAM_PORT ?? process.env.BOT_PORT ?? "8364", 8364),
  locale: process.env.TELEGRAM_LOCALE ?? "en",
  pairTtlSec: num(process.env.PAIR_CODE_TTL_SEC ?? "300", 300),
  rateMax: num(process.env.PAIR_RATE_LIMIT_MAX ?? "5", 5),
  rateWindowMs: 60 * 1000,
  downloadMaxBytes: 20 * 1024 * 1024,
  uploadMaxBytes: 50 * 1024 * 1024,
} as const;

export type TelegramConfig = typeof telegramConfig;
