import { useEffect, useState } from "react";
import { PLATFORMS, resolvePlatforms, type Platform } from "@crosschat/core";
import { getAppConfig } from "./api";

/**
 * Pairing buttons resolve their invite URLs from the backend `/api/config`,
 * which reads the single root `.env` (TELEGRAM_BOT_URL, DISCORD_INVITE_URL).
 * Falls back to the built-in registry when the backend is unreachable, so the
 * dialog never renders broken.
 *
 * Platforms the operator never configured (no bot token / entry URL) are
 * filtered out — pairing into a dead bot is worse than hiding the button.
 */
export function usePlatforms(): Platform[] {
  const [platforms, setPlatforms] = useState<Platform[]>(() => PLATFORMS.map((p) => ({ ...p })));

  useEffect(() => {
    let alive = true;
    getAppConfig()
      .then((cfg) => {
        if (!alive) return;
        const resolved = resolvePlatforms({
          telegramEntryUrl: cfg.telegramEntryUrl,
          discordEntryUrl: cfg.discordEntryUrl,
          whatsappEntryUrl: cfg.whatsappEntryUrl,
        });
        // Hide platforms the operator never configured. No flags from an
        // old backend: show everything, same as before.
        setPlatforms(
          cfg.configured
            ? resolved.filter((p) => cfg.configured?.[p.id as keyof typeof cfg.configured] ?? true)
            : resolved,
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
