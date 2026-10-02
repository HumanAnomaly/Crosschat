import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./env.js";

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

export const db: DatabaseType = new Database(config.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_sub TEXT UNIQUE NOT NULL,
  email TEXT,
  name TEXT,
  picture TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS pairing_codes (
  code TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  telegram_chat_id TEXT,
  purpose TEXT NOT NULL DEFAULT 'link',
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pairing_user ON pairing_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_pairing_expires ON pairing_codes(expires_at);
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  telegram_chat_id TEXT NOT NULL,
  telegram_username TEXT,
  platform_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(telegram_chat_id, platform_id)
);
CREATE TABLE IF NOT EXISTS messages_meta (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT,
  media_path TEXT,
  mime TEXT,
  size INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conn ON messages_meta(connection_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_conn_sender ON messages_meta(connection_id, sender);
`);

for (const column of ["name", "picture"]) {
  const exists = db
    .prepare("SELECT name FROM pragma_table_info('users') WHERE name = ?")
    .get(column);
  if (!exists) db.exec(`ALTER TABLE users ADD COLUMN ${column} TEXT`);
}



for (const [table, column] of [
  ["connections", "telegram_username"],
  ["pairing_codes", "telegram_username"],
  ["connections", "platform_id"],
  ["pairing_codes", "platform_id"],
  ["messages_meta", "telegram_msg_id"],
  ["messages_meta", "discord_msg_id"],
  ["messages_meta", "whatsapp_msg_id"],
] as const) {
  const exists = db.prepare(`SELECT name FROM pragma_table_info('${table}') WHERE name = ?`).get(column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
}

{
  const info = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'connections'").get() as
    | { sql: string }
    | undefined;

  if (info?.sql && /telegram_chat_id TEXT UNIQUE/i.test(info.sql)) {
    db.exec("PRAGMA foreign_keys=OFF");
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS connections_new (
          id TEXT PRIMARY KEY,
          user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          telegram_chat_id TEXT NOT NULL,
          telegram_username TEXT,
          platform_id TEXT,
          created_at INTEGER NOT NULL
        );
        INSERT OR IGNORE INTO connections_new (id, user_id, telegram_chat_id, telegram_username, platform_id, created_at)
          SELECT id, user_id, telegram_chat_id, telegram_username, platform_id, created_at FROM connections;
        DROP TABLE connections;
        ALTER TABLE connections_new RENAME TO connections;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_conn_chat_platform ON connections(telegram_chat_id, platform_id);
      `);
    } finally {
      db.exec("PRAGMA foreign_keys=ON");
    }
  } else {
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_conn_chat_platform ON connections(telegram_chat_id, platform_id)",
    );
  }
}

{
  const info = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'pairing_codes'").get() as
    | { sql: string }
    | undefined;
  if (info?.sql && /user_id TEXT NOT NULL/i.test(info.sql)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pairing_codes_new (
        code TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        telegram_chat_id TEXT,
        telegram_username TEXT,
        platform_id TEXT,
        purpose TEXT NOT NULL DEFAULT 'link',
        expires_at INTEGER NOT NULL,
        used INTEGER NOT NULL DEFAULT 0
      );
      INSERT OR IGNORE INTO pairing_codes_new (code, user_id, telegram_chat_id, telegram_username, platform_id, purpose, expires_at, used)
        SELECT code,
          CASE WHEN user_id = 'tg-pending' THEN NULL ELSE user_id END,
          telegram_chat_id, telegram_username, platform_id, purpose, expires_at, used
        FROM pairing_codes;
      DROP TABLE pairing_codes;
      ALTER TABLE pairing_codes_new RENAME TO pairing_codes;
      CREATE INDEX IF NOT EXISTS idx_pairing_user ON pairing_codes(user_id);
      CREATE INDEX IF NOT EXISTS idx_pairing_expires ON pairing_codes(expires_at);
    `);
    db.prepare("DELETE FROM users WHERE id = 'tg-pending'").run();
  }
}






export interface UserRow {
  id: string;
  google_sub: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  created_at: number;
}

export interface SessionRow {
  id: string;
  user_id: string;
  created_at: number;
  expires_at: number;
}

export interface PairingCodeRow {
  code: string;
  user_id: string | null;
  telegram_chat_id: string | null;
  telegram_username: string | null;
  platform_id: string | null;
  purpose: string;
  expires_at: number;
  used: number;
}

export interface ConnectionRow {
  id: string;
  user_id: string;
  telegram_chat_id: string;
  telegram_username: string | null;
  platform_id: string | null;
  created_at: number;
}

export interface MessageRow {
  id: string;
  connection_id: string;
  sender: string;
  kind: string;
  text: string | null;
  media_path: string | null;
  mime: string | null;
  size: number | null;
  created_at: number;
  telegram_msg_id: string | null;
  discord_msg_id: string | null;
  whatsapp_msg_id: string | null;
}

export function findUserBySub(googleSub: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE google_sub = ?").get(googleSub) as
    | UserRow
    | undefined;
}

export function findUserById(id: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function createUser(
  id: string,
  googleSub: string,
  email: string | null,
  name: string | null = null,
  picture: string | null = null,
): UserRow {
  db.prepare(
    "INSERT INTO users (id, google_sub, email, name, picture, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, googleSub, email, name, picture, Date.now());
  return findUserById(id) as UserRow;
}

export function updateUserProfile(
  id: string,
  email: string | null,
  name: string | null,
  picture: string | null,
): void {
  db.prepare("UPDATE users SET email = ?, name = ?, picture = ? WHERE id = ?").run(
    email,
    name,
    picture,
    id,
  );
}


export function createSession(id: string, userId: string, ttlMs: number): SessionRow {
  const now = Date.now();
  db.prepare(
    "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).run(id, userId, now, now + ttlMs);
  return { id, user_id: userId, created_at: now, expires_at: now + ttlMs };
}

export function findSession(id: string): SessionRow | undefined {
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
}

export function deleteSession(id: string): void {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

export function deleteExpiredSessions(now = Date.now()): void {
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
}

export function insertPairingCode(
  code: string,
  userId: string | null,
  expiresAt: number,
  purpose = "link",
  telegramChatId: string | null = null,
  telegramUsername: string | null = null,
  platformId: string | null = null,
): void {
  db.prepare(
    "INSERT INTO pairing_codes (code, user_id, telegram_chat_id, telegram_username, platform_id, purpose, expires_at, used) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
  ).run(code, userId, telegramChatId, telegramUsername, platformId, purpose, expiresAt);
}

export function findPairingCode(code: string): PairingCodeRow | undefined {
  return db.prepare("SELECT * FROM pairing_codes WHERE code = ?").get(code) as
    | PairingCodeRow
    | undefined;
}

export function markCodeUsed(code: string): void {
  db.prepare("UPDATE pairing_codes SET used = 1 WHERE code = ?").run(code);
}

export function deleteExpiredCodes(now = Date.now()): number {
  const r = db.prepare("DELETE FROM pairing_codes WHERE expires_at < ? OR used = 1").run(now);
  return Number(r.changes ?? 0);
}

export function findConnectionByUser(userId: string): ConnectionRow | undefined {
  return db.prepare("SELECT * FROM connections WHERE user_id = ?").get(userId) as
    | ConnectionRow
    | undefined;
}

export function findConnectionById(id: string): ConnectionRow | undefined {
  return db.prepare("SELECT * FROM connections WHERE id = ?").get(id) as
    | ConnectionRow
    | undefined;
}

export function findConnectionByTelegramChat(telegramChatId: string): ConnectionRow | undefined {
  return db.prepare("SELECT * FROM connections WHERE telegram_chat_id = ?").get(telegramChatId) as
    | ConnectionRow
    | undefined;
}

/** Platform-scoped lookup. The `telegram_chat_id` column is reused as the
 * platform-scoped chat id (see migration comment above); always filter by
 * `platform_id` for new platforms so numeric Telegram and Discord ids can
 * never collide. */
export function findConnectionByPlatformChat(
  chatId: string,
  platformId: string,
): ConnectionRow | undefined {
  return db.prepare(
    "SELECT * FROM connections WHERE telegram_chat_id = ? AND (platform_id = ? OR (platform_id IS NULL AND ? = 'telegram'))",
  ).get(chatId, platformId, platformId) as ConnectionRow | undefined;
}

export function findConnectionByDiscordChat(discordChatId: string): ConnectionRow | undefined {
  return findConnectionByPlatformChat(discordChatId, "discord");
}

export function findConnectionByWhatsappChat(whatsappChatId: string): ConnectionRow | undefined {
  return findConnectionByPlatformChat(whatsappChatId, "whatsapp");
}

export function deleteConnectionByTelegramChat(telegramChatId: string, platformId = "telegram"): ConnectionRow | undefined {
  const existing = findConnectionByPlatformChat(telegramChatId, platformId);
  if (existing) db.prepare("DELETE FROM connections WHERE id = ?").run(existing.id);
  return existing;
}

export function createConnection(
  id: string,
  userId: string,
  telegramChatId: string,
  telegramUsername: string | null = null,
  platformId = "telegram",
): ConnectionRow {
  db.prepare(
    "INSERT INTO connections (id, user_id, telegram_chat_id, telegram_username, platform_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, userId, telegramChatId, telegramUsername, platformId, Date.now());
  return findConnectionById(id) as ConnectionRow;
}

export function updateConnectionUsername(telegramChatId: string, telegramUsername: string, platformId = "telegram"): void {
  db.prepare(
    "UPDATE connections SET telegram_username = ? WHERE telegram_chat_id = ? AND (platform_id = ? OR (platform_id IS NULL AND ? = 'telegram'))",
  ).run(telegramUsername, telegramChatId, platformId, platformId);
}

export function deleteConnectionByUser(userId: string): ConnectionRow | undefined {
  const existing = findConnectionByUser(userId);
  if (existing) db.prepare("DELETE FROM connections WHERE user_id = ?").run(userId);
  return existing;
}

const claimAtomicTx = db.transaction(
  (opts: { code: string; userId: string; telegramChatId: string; telegramUsername: string | null; platformId?: string }) => {
    const row = findPairingCode(opts.code);
    if (!row || row.used === 1 || row.expires_at < Date.now()) throw new Error("CODE_INVALID");
    const ownerId = row.user_id;
    if (ownerId && ownerId !== opts.userId) throw new Error("CODE_FOREIGN");
    if (findConnectionByUser(opts.userId)) throw new Error("CONFLICT_USER");
    if (findConnectionByPlatformChat(opts.telegramChatId, opts.platformId ?? "telegram")) throw new Error("CONFLICT_CHAT");
    const connection = createConnection(randomUUID(), opts.userId, opts.telegramChatId, opts.telegramUsername, opts.platformId ?? "telegram");
    markCodeUsed(opts.code);
    return { connection, tgInitiated: ownerId === null };
  },
);

export function claimPairingCodeAtomic(opts: {
  code: string;
  userId: string;
  telegramChatId: string;
  telegramUsername: string | null;
  platformId?: string;
}): { connection: ConnectionRow; tgInitiated: boolean } {
  return claimAtomicTx(opts) as { connection: ConnectionRow; tgInitiated: boolean };
}

const claimAtomicBotTx = db.transaction(
  (opts: { code: string; telegramChatId: string; telegramUsername: string | null; platformId?: string }) => {
    const row = findPairingCode(opts.code);
    if (!row || row.used === 1 || row.expires_at < Date.now()) throw new Error("CODE_INVALID");
    if (row.user_id === null) throw new Error("CODE_TG_INITIATED");
    if (findConnectionByUser(row.user_id)) throw new Error("CONFLICT_USER");
    if (findConnectionByPlatformChat(opts.telegramChatId, opts.platformId ?? "telegram")) throw new Error("CONFLICT_CHAT");
    const connection = createConnection(randomUUID(), row.user_id, opts.telegramChatId, opts.telegramUsername, opts.platformId ?? "telegram");
    markCodeUsed(opts.code);
    return { connection, ownerId: row.user_id };
  },
);

export function claimPairingCodeAtomicBot(opts: {
  code: string;
  telegramChatId: string;
  telegramUsername: string | null;
  platformId?: string;
}): { connection: ConnectionRow; ownerId: string } {
  return claimAtomicBotTx(opts) as { connection: ConnectionRow; ownerId: string };
}

export function insertMessage(row: {
  id: string;
  connectionId: string;
  sender: string;
  kind: string;
  text?: string | null;
  mediaPath?: string | null;
  mime?: string | null;
  size?: number | null;
  createdAt: number;
  telegramMsgId?: string | null;
  discordMsgId?: string | null;
  whatsappMsgId?: string | null;
}): MessageRow {
  db.prepare(
    "INSERT INTO messages_meta (id, connection_id, sender, kind, text, media_path, mime, size, created_at, telegram_msg_id, discord_msg_id, whatsapp_msg_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    row.id,
    row.connectionId,
    row.sender,
    row.kind,
    row.text ?? null,
    row.mediaPath ?? null,
    row.mime ?? null,
    row.size ?? null,
    row.createdAt,
    row.telegramMsgId ?? null,
    row.discordMsgId ?? null,
    row.whatsappMsgId ?? null,
  );
  return db.prepare("SELECT * FROM messages_meta WHERE id = ?").get(row.id) as MessageRow;
}

export function updateMessagePlatformIds(id: string, opts: { telegramMsgId?: string | null; discordMsgId?: string | null; whatsappMsgId?: string | null }): void {
  if (opts.telegramMsgId != null) {
    db.prepare("UPDATE messages_meta SET telegram_msg_id = ? WHERE id = ?").run(opts.telegramMsgId, id);
  }
  if (opts.discordMsgId != null) {
    db.prepare("UPDATE messages_meta SET discord_msg_id = ? WHERE id = ?").run(opts.discordMsgId, id);
  }
  if (opts.whatsappMsgId != null) {
    db.prepare("UPDATE messages_meta SET whatsapp_msg_id = ? WHERE id = ?").run(opts.whatsappMsgId, id);
  }
}

export type PlatformMessageKind = "telegram" | "discord" | "whatsapp";

function platformIdColumn(platform: PlatformMessageKind): string {
  if (platform === "discord") return "discord_msg_id";
  if (platform === "whatsapp") return "whatsapp_msg_id";
  return "telegram_msg_id";
}

export function findMessageByPlatformId(platformMsgId: string, platform: PlatformMessageKind): MessageRow | undefined {
  const col = platformIdColumn(platform);
  return db.prepare(`SELECT * FROM messages_meta WHERE ${col} = ?`).get(platformMsgId) as
    | MessageRow
    | undefined;
}

export function findMessagesByPlatformPrefix(prefix: string, platform: PlatformMessageKind): MessageRow[] {
  const col = platformIdColumn(platform);
  return db.prepare(`SELECT * FROM messages_meta WHERE ${col} = ? OR ${col} LIKE ?`).all(prefix, `${prefix}:%`) as MessageRow[];
}

/** All rows carrying a platform id (ids repeat per chat on Telegram). */
export function findMessagesByPlatformId(platformMsgId: string, platform: PlatformMessageKind): MessageRow[] {
  const col = platformIdColumn(platform);
  return db.prepare(`SELECT * FROM messages_meta WHERE ${col} = ? OR ${col} LIKE ?`).all(platformMsgId, `${platformMsgId}:%`) as MessageRow[];
}

export function findMessageInConnection(id: string, connectionId: string): MessageRow | undefined {
  return db.prepare("SELECT * FROM messages_meta WHERE id = ? AND connection_id = ?").get(id, connectionId) as
    | MessageRow
    | undefined;
}

export function deleteMessageById(id: string): MessageRow | undefined {
  const existing = findMessageById(id);
  if (existing) db.prepare("DELETE FROM messages_meta WHERE id = ?").run(id);
  return existing;
}

export function findMessageById(id: string): MessageRow | undefined {
  return db.prepare("SELECT * FROM messages_meta WHERE id = ?").get(id) as
    | MessageRow
    | undefined;
}

export interface PageOpts {
  limit?: number;
  before?: number;
}

/** Newest-first window, returned oldest-first for rendering. */
export function listMessages(connectionId: string, limit = 50): MessageRow[] {
  return listMessagesPage(connectionId, { limit });
}

export function listMessagesPage(connectionId: string, opts: PageOpts = {}): MessageRow[] {
  const n = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  if (opts.before != null) {
    return db
      .prepare(
        "SELECT * FROM messages_meta WHERE connection_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(connectionId, opts.before, n)
      .reverse() as MessageRow[];
  }
  return db
    .prepare("SELECT * FROM messages_meta WHERE connection_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(connectionId, n)
    .reverse() as MessageRow[];
}

export interface ConnectionStats {
  total: number;
  fromWeb: number;
  fromTelegram: number;
  fromDiscord?: number;
  fromWhatsapp?: number;
  lastMessageAt: number | null;
}

export function connectionStats(connectionId: string): ConnectionStats {
  const rows = db
    .prepare(
      "SELECT sender, COUNT(*) as n, MAX(created_at) as last_at FROM messages_meta WHERE connection_id = ? GROUP BY sender",
    )
    .all(connectionId) as { sender: string; n: number; last_at: number | null }[];
  let fromWeb = 0;
  let fromTelegram = 0;
  let fromDiscord = 0;
  let fromWhatsapp = 0;
  let lastMessageAt: number | null = null;
  for (const row of rows) {
    if (row.sender === "telegram") fromTelegram = row.n;
    else if (row.sender === "discord") fromDiscord = row.n;
    else if (row.sender === "whatsapp") fromWhatsapp = row.n;
    else fromWeb += row.n;
    if (row.last_at != null && (lastMessageAt == null || row.last_at > lastMessageAt)) {
      lastMessageAt = row.last_at;
    }
  }
  return { total: fromWeb + fromTelegram + fromDiscord + fromWhatsapp, fromWeb, fromTelegram, lastMessageAt, fromDiscord, fromWhatsapp };
}

const invokedAsMain =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsMain) {
  process.stdout.write(`database ready at ${config.databasePath}\n`);
}
