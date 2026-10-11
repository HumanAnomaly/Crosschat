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
CREATE TABLE IF NOT EXISTS direct_links (
  id TEXT PRIMARY KEY,
  a_platform TEXT NOT NULL,
  a_chat TEXT NOT NULL,
  a_username TEXT,
  b_platform TEXT NOT NULL,
  b_chat TEXT NOT NULL,
  b_username TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_direct_a ON direct_links(a_platform, a_chat);
CREATE UNIQUE INDEX IF NOT EXISTS idx_direct_b ON direct_links(b_platform, b_chat);
CREATE TABLE IF NOT EXISTS direct_messages (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL REFERENCES direct_links(id) ON DELETE CASCADE,
  source_platform TEXT NOT NULL,
  source_msg_id TEXT NOT NULL,
  peer_platform TEXT NOT NULL,
  peer_msg_id TEXT,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_direct_msg_source ON direct_messages(source_platform, source_msg_id);
CREATE INDEX IF NOT EXISTS idx_direct_msg_link ON direct_messages(link_id);
CREATE TABLE IF NOT EXISTS anon_queue (
  platform TEXT NOT NULL,
  chat TEXT NOT NULL,
  username TEXT,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (platform, chat)
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
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

// Anonymous P2P rides on direct_links; old rows predate the column.
{
  const exists = db.prepare("SELECT name FROM pragma_table_info('direct_links') WHERE name = 'mode'").get();
  if (!exists) db.exec("ALTER TABLE direct_links ADD COLUMN mode TEXT NOT NULL DEFAULT 'direct'");
}

// The *_msg_id columns come from the ALTER migration above, so their indexes
// must be created only after it has run (fresh databases included).
db.exec(`
CREATE INDEX IF NOT EXISTS idx_messages_tg_msg ON messages_meta(telegram_msg_id);
CREATE INDEX IF NOT EXISTS idx_messages_dc_msg ON messages_meta(discord_msg_id);
CREATE INDEX IF NOT EXISTS idx_messages_wa_msg ON messages_meta(whatsapp_msg_id);
`);

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

export interface PushSubscriptionRow {
  endpoint: string;
  user_id: string;
  p256dh: string;
  auth: string;
  created_at: number;
}

export function upsertPushSubscription(userId: string, endpoint: string, p256dh: string, auth: string): void {
  db.prepare(
    "INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth",
  ).run(endpoint, userId, p256dh, auth, Date.now());
}

export function deletePushSubscription(userId: string, endpoint: string): void {
  db.prepare("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?").run(userId, endpoint);
}

export function deletePushSubscriptionByEndpoint(endpoint: string): void {
  db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
}

export function listPushSubscriptions(userId: string): PushSubscriptionRow[] {
  return db.prepare("SELECT * FROM push_subscriptions WHERE user_id = ?").all(userId) as PushSubscriptionRow[];
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

/** All rows carrying a platform id (ids repeat per chat on Telegram). */
export function findMessagesByPlatformId(platformMsgId: string, platform: PlatformMessageKind): MessageRow[] {
  const col = platformIdColumn(platform);
  return db.prepare(`SELECT * FROM messages_meta WHERE ${col} = ? OR ${col} LIKE ?`).all(platformMsgId, `${platformMsgId}:%`) as MessageRow[];
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

export interface DirectLinkRow {
  id: string;
  a_platform: string;
  a_chat: string;
  a_username: string | null;
  b_platform: string;
  b_chat: string;
  b_username: string | null;
  /** 'direct' (code-paired) or 'anon' (matchmade). Old rows read 'direct'. */
  mode: string;
  created_at: number;
}

export interface DirectMessageRow {
  id: string;
  link_id: string;
  source_platform: string;
  source_msg_id: string;
  peer_platform: string;
  peer_msg_id: string | null;
  kind: string;
  created_at: number;
}

export type DirectPlatform = "telegram" | "discord" | "whatsapp" | "web";

export function findDirectLinkByChat(chatId: string, platform: string): DirectLinkRow | undefined {
  return db.prepare(
    "SELECT * FROM direct_links WHERE (a_platform = ? AND a_chat = ?) OR (b_platform = ? AND b_chat = ?) LIMIT 1",
  ).get(platform, chatId, platform, chatId) as DirectLinkRow | undefined;
}

export function findDirectLinkById(id: string): DirectLinkRow | undefined {
  return db.prepare("SELECT * FROM direct_links WHERE id = ?").get(id) as DirectLinkRow | undefined;
}

export function peerOf(link: DirectLinkRow, platform: string, chatId: string): { platform: DirectPlatform; chat: string } | null {
  if (link.a_platform === platform && link.a_chat === chatId) {
    return { platform: link.b_platform as DirectPlatform, chat: link.b_chat };
  }
  if (link.b_platform === platform && link.b_chat === chatId) {
    return { platform: link.a_platform as DirectPlatform, chat: link.a_chat };
  }
  return null;
}

export function createDirectLink(opts: {
  id?: string;
  aPlatform: string;
  aChat: string;
  aUsername?: string | null;
  bPlatform: string;
  bChat: string;
  bUsername?: string | null;
  mode?: string;
}): DirectLinkRow {
  const id = opts.id ?? randomUUID();
  db.prepare(
    "INSERT INTO direct_links (id, a_platform, a_chat, a_username, b_platform, b_chat, b_username, mode, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, opts.aPlatform, opts.aChat, opts.aUsername ?? null, opts.bPlatform, opts.bChat, opts.bUsername ?? null, opts.mode ?? "direct", Date.now());
  return findDirectLinkById(id) as DirectLinkRow;
}

export function deleteDirectLinkByChat(chatId: string, platform: string): DirectLinkRow | undefined {
  const existing = findDirectLinkByChat(chatId, platform);
  if (existing) db.prepare("DELETE FROM direct_links WHERE id = ?").run(existing.id);
  return existing;
}

export function deleteDirectLinkById(id: string): DirectLinkRow | undefined {
  const existing = findDirectLinkById(id);
  if (existing) db.prepare("DELETE FROM direct_links WHERE id = ?").run(id);
  return existing;
}

export interface AnonQueueRow {
  platform: string;
  chat: string;
  username: string | null;
  joined_at: number;
}

export function findAnonQueueEntry(platform: string, chat: string): AnonQueueRow | undefined {
  return db.prepare("SELECT * FROM anon_queue WHERE platform = ? AND chat = ?").get(platform, chat) as
    | AnonQueueRow
    | undefined;
}

export function joinAnonQueue(platform: string, chat: string, username: string | null): void {
  const changed = db
    .prepare("UPDATE anon_queue SET username = ?, joined_at = ? WHERE platform = ? AND chat = ?")
    .run(username, Date.now(), platform, chat).changes;
  if (!changed) {
    db.prepare("INSERT INTO anon_queue (platform, chat, username, joined_at) VALUES (?, ?, ?, ?)").run(
      platform,
      chat,
      username,
      Date.now(),
    );
  }
}

/** Oldest waiter that isn't me; waiters on other platforms sort first. */
export function popAnonPartner(excludePlatform: string, excludeChat: string): AnonQueueRow | undefined {
  return db
    .prepare(
      "SELECT * FROM anon_queue WHERE NOT (platform = ? AND chat = ?) ORDER BY (platform != ?) DESC, joined_at ASC LIMIT 1",
    )
    .get(excludePlatform, excludeChat, excludePlatform) as AnonQueueRow | undefined;
}

export function leaveAnonQueue(platform: string, chat: string): boolean {
  return db.prepare("DELETE FROM anon_queue WHERE platform = ? AND chat = ?").run(platform, chat).changes > 0;
}

export function deleteStaleAnonQueue(maxAgeMs: number): number {
  return db.prepare("DELETE FROM anon_queue WHERE joined_at < ?").run(Date.now() - maxAgeMs).changes;
}

export function insertDirectMessage(row: {
  id?: string;
  linkId: string;
  sourcePlatform: string;
  sourceMsgId: string;
  peerPlatform: string;
  peerMsgId?: string | null;
  kind: string;
}): DirectMessageRow {
  const id = row.id ?? randomUUID();
  db.prepare(
    "INSERT INTO direct_messages (id, link_id, source_platform, source_msg_id, peer_platform, peer_msg_id, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, row.linkId, row.sourcePlatform, row.sourceMsgId, row.peerPlatform, row.peerMsgId ?? null, row.kind, Date.now());
  return db.prepare("SELECT * FROM direct_messages WHERE id = ?").get(id) as DirectMessageRow;
}

export function updateDirectMessagePeerId(id: string, peerMsgId: string | null): void {
  db.prepare("UPDATE direct_messages SET peer_msg_id = ? WHERE id = ?").run(peerMsgId, id);
}

/** Match exact id plus Discord attachment suffix `<msgId>:<attId>`. */
export function findDirectMessagesBySource(platformMsgId: string, platform: string): DirectMessageRow[] {
  return db.prepare(
    "SELECT * FROM direct_messages WHERE source_platform = ? AND (source_msg_id = ? OR source_msg_id LIKE ?)",
  ).all(platform, platformMsgId, `${platformMsgId}:%`) as DirectMessageRow[];
}

export function findDirectMessagesByPeer(peerMsgId: string, platform: string): DirectMessageRow[] {
  return db.prepare(
    "SELECT * FROM direct_messages WHERE peer_platform = ? AND (peer_msg_id = ? OR peer_msg_id LIKE ?)",
  ).all(platform, peerMsgId, `${peerMsgId}:%`) as DirectMessageRow[];
}

export function deleteDirectMessagesForLink(linkId: string): void {
  db.prepare("DELETE FROM direct_messages WHERE link_id = ?").run(linkId);
}

export function countDirectMessagesForLink(linkId: string): number {
  const r = db.prepare("SELECT COUNT(*) as n FROM direct_messages WHERE link_id = ?").get(linkId) as { n: number };
  return r?.n ?? 0;
}

const invokedAsMain =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsMain) {
  process.stdout.write(`database ready at ${config.databasePath}\n`);
}
