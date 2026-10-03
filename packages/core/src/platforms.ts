/**
 * Platform registry.
 *
 * Every chat surface is described here rather than being hardcoded in the UI, so
 * adding `apps/<platform>` later means adding one entry, not touching the
 * components. No platform is privileged: the list is rendered generically and
 * the first entry is not treated as a default anywhere.
 */

export type PlatformId = string;

export interface Platform {
  /** Stable id, matches the `apps/<id>` workspace directory. */
  id: PlatformId;
  /** Human label used in the UI. */
  label: string;
  /** Brand colour used for the icon tile. */
  brandColor: string;
  /** Key resolved by the web icon map. */
  icon: string;
  /** Where the user goes to start pairing on this platform. */
  entryUrl: string;
  /** Shown when no handler is reachable, e.g. the bot is offline. */
  entryLabel: string;
  /** Ordered instructions shown in the pairing tips dialog. */
  steps: string[];
  /** Short note about what this platform can carry. */
  note: string;
}

export const DEFAULT_TELEGRAM_ENTRY_URL = "https://t.me/trycrosschat_bot";
export const DEFAULT_DISCORD_ENTRY_URL = "https://discord.com/oauth2/authorize";
export const DEFAULT_WHATSAPP_ENTRY_URL = "https://wa.me/";

export interface PlatformUrlOverrides {
  telegramEntryUrl?: string;
  discordEntryUrl?: string;
  whatsappEntryUrl?: string;
}

/**
 * Only accept absolute https URLs. A bare
 * `https://discord.com/oauth2/authorize` without
 * `?client_id=...&permissions=...&scope=...` makes Discord render
 * "Invalid Form Body", so an invalid override falls back to the default
 * instead of breaking the pairing button.
 */
export function isValidEntryUrl(value: string): boolean {
  return /^https:\/\/\S{1,2000}$/.test(value);
}

export function resolveEntryUrl(raw: string | undefined, fallback: string): string {
  const value = (raw ?? "").trim();
  if (!value) return fallback;
  return isValidEntryUrl(value) ? value : fallback;
}

/** Same registry with env-configured invite URLs applied (no mutation). */
export function resolvePlatforms(overrides: PlatformUrlOverrides = {}): Platform[] {
  return PLATFORMS.map((p) => {
    if (p.id === "telegram" && overrides.telegramEntryUrl !== undefined) {
      return { ...p, entryUrl: resolveEntryUrl(overrides.telegramEntryUrl, p.entryUrl) };
    }
    if (p.id === "discord" && overrides.discordEntryUrl !== undefined) {
      return { ...p, entryUrl: resolveEntryUrl(overrides.discordEntryUrl, p.entryUrl) };
    }
    if (p.id === "whatsapp" && overrides.whatsappEntryUrl !== undefined) {
      const raw = (overrides.whatsappEntryUrl ?? "").trim();
      if (!raw) return { ...p };
      return { ...p, entryUrl: raw };
    }
    return { ...p };
  });
}

export const PLATFORMS: Platform[] = [
  {
    id: "telegram",
    label: "Telegram",
    brandColor: "#229ED9",
    icon: "telegram",
    entryUrl: DEFAULT_TELEGRAM_ENTRY_URL,
    entryLabel: "@trycrosschat_bot",
    steps: [
      "Open the bot in Telegram using the button above.",
      "Press Start so Telegram registers your chat with the bot.",
      "Press Wired, then send it the code from this page.",
      "Or press New code in the bot, then enter that code here instead.",
    ],
    note: "Text, photos, video, documents and voice notes up to 20MB.",
  },
  {
    id: "discord",
    label: "Discord",
    brandColor: "#5865F2",
    icon: "discord",
    entryUrl: DEFAULT_DISCORD_ENTRY_URL,
    entryLabel: "DM the Discord bot",
    steps: [
      "Open the Discord bot and send it a direct message.",
      "Use /wired, optionally passing the code from this page directly.",
      "Or use /newcode in the bot, then enter that code here instead.",
      "Keep DMs open so the bot can message you back.",
    ],
    note: "Text, photos, video, documents and audio up to 20MB via DM.",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    brandColor: "#25D366",
    icon: "whatsapp",
    entryUrl: DEFAULT_WHATSAPP_ENTRY_URL,
    entryLabel: "Chat the WhatsApp bot",
    steps: [
      "Make sure the WhatsApp session is added on the server (session:add wa).",
      "Send wired to the WhatsApp number, then send it the code from this page.",
      "Or send newcode in WhatsApp, then enter that code here instead.",
      "Keep the linked device active so messages keep flowing.",
    ],
    note: "Text, photos, video, documents and voice notes up to 20MB via DM.",
  },
];

/** Look up a platform by id; null when unknown. */
export function findPlatform(id: PlatformId, list: Platform[] = PLATFORMS): Platform | null {
  return list.find((p) => p.id === id) ?? null;
}

/** Look up a platform by id, falling back to a neutral placeholder entry. */
export function platformOrFallback(id: PlatformId, list: Platform[] = PLATFORMS): Platform {
  return (
    findPlatform(id, list) ?? {
      id,
      label: id,
      brandColor: "#71717A",
      icon: "generic",
      entryUrl: "#",
      entryLabel: "Not configured",
      steps: [`This platform (${id}) is not configured yet.`],
      note: "",
    }
  );
}
