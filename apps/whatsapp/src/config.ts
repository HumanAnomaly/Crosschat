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

function findRepoRoot(start: string): string {
  let dir = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

const repoRoot = findRepoRoot(process.cwd());

function resolveDataPath(p: string): string {
  if (path.isAbsolute(p)) return p;
  return path.resolve(repoRoot, p);
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = (process.env[name] ?? "").toLowerCase().trim();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export const whatsappConfig = {
  session: (process.env.WHATSAPP_SESSION ?? "wa").trim() || "wa",
  dataDir: resolveDataPath(process.env.WHATSAPP_DATA_DIR ?? "./data/whatsapp"),
  port: num(process.env.WHATSAPP_PORT ?? "8366", 8366),
  locale: process.env.WHATSAPP_LOCALE ?? process.env.TELEGRAM_LOCALE ?? "en",
  realtimeUrl: (process.env.REALTIME_URL ?? "http://localhost:8362").replace(/\/+$/, ""),
  webhookSecret: process.env.WHATSAPP_WEBHOOK_SECRET ?? process.env.TELEGRAM_WEBHOOK_SECRET ?? "",
  pairWithCode: bool(process.env.WHATSAPP_PAIR_WITH_CODE ?? "", true),
  pairTtlSec: num(process.env.PAIR_CODE_TTL_SEC ?? "300", 300),
  rateMax: num(process.env.PAIR_RATE_LIMIT_MAX ?? "5", 5),
  rateWindowMs: 60 * 1000,
  downloadMaxBytes: 20 * 1024 * 1024,
  uploadMaxBytes: 50 * 1024 * 1024,
} as const;

export type WhatsappConfig = typeof whatsappConfig;
