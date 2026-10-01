import fs from "node:fs";
import path from "node:path";
import type { ChatMessage } from "@crosschat/core";
import { findConnectionById, findMessageById } from "./db.js";
import { config } from "./env.js";
import { resolveStoredMediaPath } from "./security.js";

const MAX_FORWARD_BYTES = 20 * 1024 * 1024;

function storedFileFor(connectionId: string, message: ChatMessage): string | null {
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

function originalFilename(connectionId: string, message: ChatMessage): string {
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
  if (message.mime?.startsWith("image/")) return "photo.png";
  if (message.mime?.startsWith("video/")) return "video.mp4";
  if (message.mime?.startsWith("audio/")) return "voice.ogg";
  return "file";
}

async function openDmChannel(userId: string, token: string): Promise<string | null> {
  try {
    const res = await fetch("https://discord.com/api/v10/users/@me/channels", {
      method: "POST",
      headers: {
        authorization: `Bot ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ recipient_id: userId }),
    });
    if (!res.ok) {
      console.error(`notifyDiscord: open DM failed with ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { id?: string };
    return typeof data.id === "string" ? data.id : null;
  } catch (err) {
    console.error("notifyDiscord open DM failed", err);
    return null;
  }
}

export async function notifyDiscord(
  connectionId: string,
  message: ChatMessage,
): Promise<{ discordMessageId: string | null }> {
  const token = config.discordBotToken;
  if (!token) return { discordMessageId: null };
  const connection = findConnectionById(connectionId);
  if (!connection) return { discordMessageId: null };
  if ((connection.platform_id ?? "telegram") !== "discord") return { discordMessageId: null };
  const userId = connection.telegram_chat_id;
  const sendJson = async (channelId: string, content: string): Promise<string | null> => {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ content: content || "(media)" }),
    });
    if (!res.ok) {
      console.error(`notifyDiscord: send failed with ${res.status}`);
      return null;
    }
    const data = (await res.json().catch(() => null)) as { id?: unknown } | null;
    return data && typeof data.id === "string" ? data.id : null;
  };
  try {
    const channelId = await openDmChannel(userId, token);
    if (!channelId) return { discordMessageId: null };
    const content = (message.text ?? (message.kind === "text" ? "(empty)" : "(media)")).slice(0, 2000);
    if (message.kind === "text" || !message.mediaPath) {
      const id = await sendJson(channelId, content);
      return { discordMessageId: id };
    }
    const stored = storedFileFor(connectionId, message);
    if (!stored || !fs.existsSync(stored)) {
      const id = await sendJson(channelId, content || "(media unavailable)");
      return { discordMessageId: id };
    }
    const stat = await fs.promises.stat(stored);
    if (stat.size > MAX_FORWARD_BYTES) {
      console.error(`notifyDiscord: file too large to forward (${stat.size} bytes)`);
      const id = await sendJson(channelId, `${content} (file too large for Discord)`);
      return { discordMessageId: id };
    }
    const blob = await fs.openAsBlob(stored, { type: message.mime ?? "application/octet-stream" });
    const filename = originalFilename(connectionId, message);
    const form = new FormData();
    form.append("content", content || "");
    form.append("files[0]", blob, filename);
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: { authorization: `Bot ${token}` },
      body: form,
    });
    if (!res.ok) {
      console.error(`notifyDiscord: send file failed with ${res.status}`);
      return { discordMessageId: null };
    }
    const data = (await res.json().catch(() => null)) as { id?: unknown } | null;
    return { discordMessageId: data && typeof data.id === "string" ? data.id : null };
  } catch (err) {
    console.error("notifyDiscord failed", err);
    return { discordMessageId: null };
  }
}

/** Best-effort removal of a previously forwarded web message in a Discord DM. */
export async function deleteDiscordMessage(userId: string, discordMessageId: string): Promise<boolean> {
  const token = config.discordBotToken;
  if (!token) return false;
  try {
    const channelId = await openDmChannel(userId, token);
    if (!channelId) return false;
    const res = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages/${encodeURIComponent(discordMessageId)}`,
      { method: "DELETE", headers: { authorization: `Bot ${token}` } },
    );
    return res.ok || res.status === 404;
  } catch (err) {
    console.error("deleteDiscordMessage failed", err);
    return false;
  }
}
