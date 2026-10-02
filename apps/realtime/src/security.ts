import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { config } from "./env.js";

export function isBotRequest(req: Request): boolean {
  const telegram = config.telegramWebhookSecret;
  const discord = (config as { discordWebhookSecret?: string }).discordWebhookSecret ?? "";
  const whatsapp = (config as { whatsappWebhookSecret?: string }).whatsappWebhookSecret ?? "";
  const got = req.get("x-bot-secret") ?? "";
  if (!got) return false;
  if (telegram && got === telegram) return true;
  if (discord && got === discord) return true;
  if (whatsapp && got === whatsapp) return true;
  return false;
}

export function resolveStoredMediaPath(storedRel: string): string | null {
  const rel = storedRel.replace(/\\/g, "/");
  if (rel.startsWith("/") || rel.includes("..")) return null;
  const abs = path.resolve(config.mediaDir, rel);
  const base = path.resolve(config.mediaDir) + path.sep;
  if (!abs.startsWith(base)) return null;
  return abs;
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  if (config.isProd) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
}
