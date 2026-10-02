import { Router, type Request, type Response } from "express";
import { resolvePlatforms } from "@crosschat/core";
import { config } from "./env.js";

/**
 * Public invite links for the web pairing dialog. The web bundle is static,
 * so the single root `.env` stays the source of truth: set
 * TELEGRAM_BOT_URL / DISCORD_INVITE_URL, restart realtime, no rebuild needed.
 */
export function createConfigRouter(): Router {
  const router = Router();
  router.get("/api/config", (_req: Request, res: Response) => {
    const resolved = resolvePlatforms({
      telegramEntryUrl: config.telegramEntryUrl,
      discordEntryUrl: config.discordEntryUrl,
      whatsappEntryUrl: (config as { whatsappEntryUrl?: string }).whatsappEntryUrl,
    });
    res.json({
      telegramEntryUrl: resolved.find((p) => p.id === "telegram")?.entryUrl ?? config.telegramEntryUrl,
      discordEntryUrl: resolved.find((p) => p.id === "discord")?.entryUrl ?? config.discordEntryUrl,
      whatsappEntryUrl: resolved.find((p) => p.id === "whatsapp")?.entryUrl ?? "",
    });
  });
  return router;
}
