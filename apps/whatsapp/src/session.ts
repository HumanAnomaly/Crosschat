import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { whatsappConfig } from "./config.js";

export function sessionFilePath(name = whatsappConfig.session): string {
  const dir = path.isAbsolute(whatsappConfig.dataDir)
    ? whatsappConfig.dataDir
    : path.resolve(whatsappConfig.dataDir);
  const safe = name.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 64) || "wa";
  return path.join(dir, `${safe}.sqlite`);
}

export interface SessionStatus {
  name: string;
  file: string;
  exists: boolean;
  size: number;
  looksValid: boolean;
  /** True only when the store holds pairing credentials (me_jid set). */
  paired: boolean;
  active: boolean;
}

function hasHeader(file: string): boolean {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(16);
      fs.readSync(fd, buf, 0, 16, 0);
      return buf.toString("utf8", 0, 15).startsWith("SQLite format");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

/**
 * A session file can exist without a completed pairing (e.g. `session:add`
 * was started but the phone never scanned/entered the code). Only a row with
 * `me_jid` set counts as paired. Any read failure means not paired, never a
 * crash. Falls back to null when `node:sqlite` is unavailable (Node < 22.13).
 */
function isPaired(file: string, name: string): boolean | null {
  try {
    const require = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sqlite = require("node:sqlite") as any;
    const db = new sqlite.DatabaseSync(file, { readOnly: true });
    try {
      const row = db
        .prepare("SELECT me_jid FROM auth_credentials WHERE session_id = ?")
        .get(name) as { me_jid?: unknown } | undefined;
      return typeof row?.me_jid === "string" && row.me_jid.length > 0;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export function sessionStatus(name = whatsappConfig.session): SessionStatus {
  const file = sessionFilePath(name);
  let exists = false;
  let size = 0;
  try {
    const st = fs.statSync(file);
    exists = st.isFile();
    size = st.size;
  } catch {
    exists = false;
  }
  const looksValid = exists && size > 100 && hasHeader(file);
  const check = looksValid ? isPaired(file, name) : false;
  // Unknown (old Node without node:sqlite) keeps the legacy file check.
  const paired = check ?? looksValid;
  return { name, file, exists, size, looksValid, paired, active: exists && looksValid && paired };
}

export function ensureSessionDir(): string {
  const dir = path.dirname(sessionFilePath(whatsappConfig.session));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
