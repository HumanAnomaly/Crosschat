import fs from "node:fs";
import type { ChatMessage } from "@crosschat/core";
import { findConnectionById } from "./db.js";
import { config } from "./env.js";
import { originalFilename as storedOriginal, storedFileFor } from "./bridge-files.js";

const MAX_FORWARD_BYTES = 20 * 1024 * 1024;

function originalFilename(message: ChatMessage): string {
  const stored = storedOriginal(message);
  if (stored !== "file") return stored;
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

export interface DirectDiscordInput {
  kind: string;
  text?: string | null;
  mime?: string | null;
  fileAbsPath?: string | null;
  filename?: string | null;
}

/** Direct send to a Discord DM without a web connection (P2P links). */
export async function sendDiscordToUser(
  userId: string,
  input: DirectDiscordInput,
): Promise<{ discordMessageId: string | null }> {
  const token = config.discordBotToken;
  if (!token) return { discordMessageId: null };
  const sendJson = async (channelId: string, content: string): Promise<string | null> => {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ content: content || "(media)" }),
    });
    if (!res.ok) {
      console.error(`sendDiscordToUser: send failed with ${res.status}`);
      return null;
    }
    const data = (await res.json().catch(() => null)) as { id?: unknown } | null;
    return data && typeof data.id === "string" ? data.id : null;
  };
  try {
    const channelId = await openDmChannel(userId, token);
    if (!channelId) return { discordMessageId: null };
    const content = (input.text ?? (input.kind === "text" ? "(empty)" : "(media)")).slice(0, 2000);
    if (input.kind === "text" || !input.fileAbsPath) {
      const id = await sendJson(channelId, content);
      return { discordMessageId: id };
    }
    if (!fs.existsSync(input.fileAbsPath)) {
      const id = await sendJson(channelId, content || "(media unavailable)");
      return { discordMessageId: id };
    }
    const stat = await fs.promises.stat(input.fileAbsPath);
    if (stat.size > MAX_FORWARD_BYTES) {
      console.error(`sendDiscordToUser: file too large to forward (${stat.size} bytes)`);
      const id = await sendJson(channelId, `${content} (file too large for Discord)`);
      return { discordMessageId: id };
    }
    const blob = await fs.openAsBlob(input.fileAbsPath, { type: input.mime ?? "application/octet-stream" });
    const form = new FormData();
    form.append("content", content || "");
    form.append("files[0]", blob, input.filename ?? "file");
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: { authorization: `Bot ${token}` },
      body: form,
    });
    if (!res.ok) {
      console.error(`sendDiscordToUser: send file failed with ${res.status}`);
      return { discordMessageId: null };
    }
    const data = (await res.json().catch(() => null)) as { id?: unknown } | null;
    return { discordMessageId: data && typeof data.id === "string" ? data.id : null };
  } catch (err) {
    console.error("sendDiscordToUser failed", err);
    return { discordMessageId: null };
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
  const stored = message.kind === "text" || !message.mediaPath ? null : storedFileFor(connectionId, message);
  return sendDiscordToUser(userId, {
    kind: message.kind,
    text: message.text ?? undefined,
    mime: message.mime ?? undefined,
    fileAbsPath: stored,
    filename: stored ? originalFilename(message) : undefined,
  });
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
