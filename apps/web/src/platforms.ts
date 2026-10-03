import { useEffect, useState } from "react";
import { PLATFORMS, resolvePlatforms, type Platform } from "@crosschat/core";
import { getAppConfig } from "./api";

/**
 * Pairing buttons resolve their invite URLs from the backend `/api/config`,
 * which reads the single root `.env` (TELEGRAM_BOT_URL, DISCORD_INVITE_URL).
 * Falls back to the built-in registry when the backend is unreachable, so the
 * dialog never renders broken.
 */
export function usePlatforms(): Platform[] {
  const [platforms, setPlatforms] = useState<Platform[]>(() => PLATFORMS.map((p) => ({ ...p })));

  useEffect(() => {
    let alive = true;
    getAppConfig()
      .then((cfg) => {
        if (!alive) return;
        setPlatforms(
          resolvePlatforms({
            telegramEntryUrl: cfg.telegramEntryUrl,
            discordEntryUrl: cfg.discordEntryUrl,
            whatsappEntryUrl: cfg.whatsappEntryUrl,
          }),
        );
      })
      .catch(() => {
      });
    return () => {
      alive = false;
    };
  }, []);

  return platforms;
}
