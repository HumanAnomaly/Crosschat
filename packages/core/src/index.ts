import { z } from "zod";

export * from "./platforms.js";
export * from "./cli.js";

export const pairingCodeSchema = z
  .string()
  .regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/, "Code format WXYZ-1234")
  .transform((v) => v.toUpperCase());

export const connectionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().min(1),
  /** Registry id of the platform this room is bound to. */
  platformId: z.string().min(1),
  /** Platform-scoped chat identifier. Kept under this name for wire stability. */
  telegramChatId: z.string().min(1),
  telegramUsername: z.string().max(33).optional(),
  createdAt: z.string(),
});

export const messageKindSchema = z.enum([
  "text",
  "photo",
  "video",
  "document",
  "voice",
  "sticker",
]);

const senderSchema = z.enum(["web", "telegram", "discord", "whatsapp"]);

export const chatMessageSchema = z.object({
  id: z.string().uuid(),
  connectionId: z.string().uuid(),
  sender: senderSchema,
  kind: messageKindSchema,
  text: z.string().max(4000).optional(),
  mediaPath: z.string().max(256).optional(),
  mime: z.string().max(120).optional(),
  size: z.number().max(50 * 1024 * 1024).optional(),
  createdAt: z.string(),
});

export type PairingCode = z.infer<typeof pairingCodeSchema>;
export type Connection = z.infer<typeof connectionSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type MessageKind = z.infer<typeof messageKindSchema>;

export const PAIR_CODE_TTL_SEC = 300;
export const MEDIA_MAX_BYTES = 20 * 1024 * 1024;
export const MESSAGE_MAX_LENGTH = 4000;

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makePairingCode(): string {
  const rnd = new Uint32Array(8);
  globalThis.crypto.getRandomValues(rnd);
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[rnd[i] % alphabet.length];
    if (i === 3) out += "-";
  }
  return out;
}

/**
 * Accept `AB12-CD34`, `ab12cd34`, `ab12 cd34` etc. Returns the canonical
 * `XXXX-XXXX` form or null. All three apps must use this; no local copies.
 */
export function parsePairingCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const compact = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length !== 8) return null;
  const dashed = `${compact.slice(0, 4)}-${compact.slice(4)}`;
  return pairingCodeSchema.safeParse(dashed).success ? dashed : null;
}

export function normalizeTelegramUsername(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const v = input.trim().replace(/^@+/, "");
  return /^[A-Za-z0-9_]{1,32}$/.test(v) ? v : null;
}

/** Discord usernames: 2-32 chars, lowercase alnum plus `_` and `.`. */
export function normalizeDiscordUsername(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const v = input.trim().replace(/^@+/, "").toLowerCase();
  return /^[a-z0-9_.]{2,32}$/.test(v) ? v : null;
}

/** WhatsApp: digits with country code (8-15 digits, leading + optional). */
export function normalizeWhatsappUsername(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const v = input.trim().replace(/^\+/, "").replace(/[\s\-()]/g, "");
  return /^[0-9]{8,15}$/.test(v) ? v : null;
}

/** Shared filename sanitizer: backend media paths must never contain `..`. */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  return clean.length > 0 ? clean : "file";
}
