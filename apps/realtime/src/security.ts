import crypto from "node:crypto";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { config } from "./env.js";

/** Length-guarded constant-time compare; an empty expected secret never matches. */
function sameSecret(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function isBotRequest(req: Request): boolean {
  const got = req.get("x-bot-secret") ?? "";
  if (!got) return false;
  return (
    sameSecret(got, config.telegramWebhookSecret) ||
    sameSecret(got, config.discordWebhookSecret) ||
    sameSecret(got, config.whatsappWebhookSecret)
  );
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
