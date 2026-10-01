import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { assertSecretsUsable } from "./secrets.js";

function findRepoRoot(start: string): string {
  let dir = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

export const repoRoot = findRepoRoot(process.cwd());

dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config();

function resolveDataPath(p: string): string {
  if (path.isAbsolute(p)) return p;
  return path.resolve(repoRoot, p);
}

export const isProd = (process.env.NODE_ENV ?? "development") === "production";

function requireStrongSecret(name: string, minLen: number): string {
  const v = process.env[name] ?? "";
  const weak = new Set(["", "dev-only-secret-change-me", "ganti-dengan-string-acak-panjang", "change-me"]);
  if (isProd && (weak.has(v) || v.length < minLen)) {
    throw new Error(
      `${name} is missing or too weak for production (need >= ${minLen} chars). Run: pnpm generate:secrets --rotate`,
    );
  }
  if (!isProd && weak.has(v)) {
    process.stderr.write(`[warn] ${name} is a placeholder. Run pnpm generate:secrets for a real secret.\n`);
    return "dev-only-secret-change-me-insecure";
  }
  return v;
}

assertSecretsUsable({
  SESSION_SECRET: process.env.SESSION_SECRET ?? "",
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET ?? "",
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? "",
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ?? "",
  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN ?? "",
});

export const config = {
  port: Number(process.env.PORT ?? 8362),
  appUrlLocal: process.env.APP_URL_LOCAL ?? "http://localhost:8362",
  appUrlProd: process.env.APP_URL_PROD ?? "",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  sessionSecret: requireStrongSecret("SESSION_SECRET", 32),
  databasePath: resolveDataPath(process.env.DATABASE_PATH ?? "./data/crosschat.db"),
  mediaDir: resolveDataPath(process.env.MEDIA_DIR ?? "./data/media"),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? "",
  telegramServiceUrl: (
    process.env.TELEGRAM_URL ?? process.env.BOT_URL ?? "http://localhost:8364"
  ).replace(/\/+$/, ""),
  discordBotToken: process.env.DISCORD_BOT_TOKEN ?? "",
  discordWebhookSecret: (
    process.env.DISCORD_WEBHOOK_SECRET ?? process.env.TELEGRAM_WEBHOOK_SECRET ?? ""
  ),
  discordServiceUrl: (
    process.env.DISCORD_URL ?? "http://localhost:8365"
  ).replace(/\/+$/, ""),
  telegramEntryUrl: (process.env.TELEGRAM_BOT_URL ?? "https://t.me/trycrosschat_bot").trim(),
  discordEntryUrl: (process.env.DISCORD_INVITE_URL ?? "https://discord.com/oauth2/authorize").trim(),
  pairCodeTtlMs: Number(process.env.PAIR_CODE_TTL_SEC ?? 300) * 1000,
  pairRateMax: Number(process.env.PAIR_RATE_LIMIT_MAX ?? 5),
  mediaMaxBytes: Number(process.env.MEDIA_MAX_BYTES ?? 20 * 1024 * 1024),
  isProd,
};

export function appBaseUrl(): string {
  if (isProd && config.appUrlProd) return config.appUrlProd.replace(/\/$/, "");
  return config.appUrlLocal.replace(/\/$/, "");
}

export function allowedOrigins(): string[] {
  return [config.appUrlLocal, config.appUrlProd].filter((v) => v.length > 0);
}
