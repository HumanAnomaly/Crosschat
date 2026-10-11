import path from "node:path";
import type { ChatMessage } from "@crosschat/core";
import { findMessageById } from "./db.js";
import { config } from "./env.js";
import { resolveStoredMediaPath } from "./security.js";

/**
 * Resolve the on-disk file for a chat message. `connectionId` comes from the
 * trusted caller (the DB row), never from the payload. Rejects cross-connection
 * `/media/<id>` references as well as raw paths escaping the connection dir.
 */
export function storedFileFor(connectionId: string, message: ChatMessage): string | null {
  if (!message.mediaPath) return null;
  if (message.mediaPath.startsWith("/media/")) {
    const id = message.mediaPath.slice("/media/".length).split("/")[0];
    if (!id) return null;
    const meta = findMessageById(id);
    if (!meta?.media_path || meta.connection_id !== connectionId) return null;
    return resolveStoredMediaPath(meta.media_path);
  }
  const abs = resolveStoredMediaPath(message.mediaPath);
  if (!abs) return null;
  const rel = abs.slice(path.resolve(config.mediaDir).length + 1).replace(/\\/g, "/");
  return rel.startsWith(`${connectionId}/`) ? abs : null;
}

/** Original client filename behind the `<uuid>-<name>` storage prefix. */
export function originalFilename(message: ChatMessage): string {
  if (message.mediaPath?.startsWith("/media/")) {
    const id = message.mediaPath.slice("/media/".length).split("/")[0];
    const meta = id ? findMessageById(id) : undefined;
    if (meta?.media_path) {
      const base = meta.media_path.replace(/\\/g, "/").split("/").pop() ?? "file";
      const dash = base.indexOf("-");
      const name = dash >= 0 ? base.slice(dash + 1) : base;
      if (name) return name;
    }
  }
  return "file";
}
