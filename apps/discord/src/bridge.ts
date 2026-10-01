import type { Message } from "discord.js";
import { discordConfig } from "./config.js";
import { translate } from "./i18n.js";
import { fetchLinkStatus, isWired, markUnwired, markWired, usernameOf } from "./wired.js";

type InboundKind = "text" | "photo" | "video" | "document" | "voice" | "sticker";

type PostResult = "ok" | "not-linked" | "error";

function t(key: string): string {
  return translate(discordConfig.locale, key);
}

function kindFor(contentType: string | null, filename: string): InboundKind {
  const ct = (contentType ?? "").toLowerCase();
  const name = filename.toLowerCase();
  if (ct.startsWith("image/")) return "photo";
  if (ct.startsWith("video/")) return "video";
  if (ct.startsWith("audio/")) return "voice";
  if (name.endsWith(".ogg") || name.endsWith(".mp3") || name.endsWith(".wav") || name.endsWith(".m4a")) return "voice";
  return "document";
}

async function download(url: string, size?: number): Promise<Buffer | null> {
  if (size != null && size > discordConfig.downloadMaxBytes) return null;
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > discordConfig.uploadMaxBytes) return null;
  return buf;
}

async function postJson(payload: Record<string, unknown>): Promise<PostResult> {  let res: Response;
  try {
    res = await fetch(`${discordConfig.realtimeUrl}/api/discord/inbound`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bot-secret": discordConfig.webhookSecret,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return "error";
  }
  if (res.status === 404) return "not-linked";
  return res.ok ? "ok" : "error";
}

export async function handleInbound(message: Message): Promise<void> {  const chatId = message.author.id;
  if (!chatId || message.author.bot) return;
  if (!isWired(chatId)) {
    const status = await fetchLinkStatus(chatId);
    if (!status) {
      await message.reply(t("media.backendDown"));
      return;
    }
    if (!status.wired) {
      await message.reply(t("media.notLinked"));
      return;
    }
    markWired(chatId);
  }
  const discordUsername = usernameOf(message.author) ?? message.author.username.slice(0, 32);
  const text = (message.content ?? "").slice(0, 4000);
  const platformMsgId = message.id;

  const attachments = [...message.attachments.values()];
  if (attachments.length === 0 && message.stickers.size === 0) {
    if (!text.trim()) {
      await message.reply(t("media.unsupported"));
      return;
    }
    const result = await postJson({ chatId, discordUsername, kind: "text", text, platformMsgId });
    if (result === "not-linked") {
      markUnwired(chatId);
      await message.reply(t("media.linkExpired"));
    } else if (result === "error") {
      await message.reply(t("media.backendDown"));
    }
    return;
  }

  if (message.stickers.size > 0 && attachments.length === 0) {

    const sticker = message.stickers.first() as unknown as
      | { url?: unknown; name?: unknown }
      | undefined;
    const stickerUrl = typeof sticker?.url === "string" ? sticker.url : null;
    if (stickerUrl) {
      let buf: Buffer | null = null;
      try {
        buf = await download(stickerUrl);
      } catch {
        buf = null;
      }
      if (buf) {
        const stickerName =
          typeof sticker?.name === "string" && sticker.name ? `${sticker.name}.png` : "sticker.png";
        const result = await postJson({
          chatId,
          discordUsername,
          kind: "sticker",
          text,
          fileBase64: buf.toString("base64"),
          filename: stickerName,
          mime: "image/png",
          size: buf.length,
          platformMsgId,
        });
        if (result === "not-linked") {
          markUnwired(chatId);
          await message.reply(t("media.linkExpired"));
        } else if (result === "error") {
          await message.reply(t("media.backendDown"));
        }
        return;
      }
    }
    const result = await postJson({ chatId, discordUsername, kind: "sticker", text, platformMsgId });
    if (result === "not-linked") {
      markUnwired(chatId);
      await message.reply(t("media.linkExpired"));
    } else if (result === "error") {
      await message.reply(t("media.backendDown"));
    }
    return;
  }

  let first = true;
  for (const att of attachments) {
    const kind = kindFor(att.contentType ?? null, att.name ?? "file");
    let buf: Buffer | null = null;
    try {
      buf = await download(att.url, att.size);
    } catch {
      buf = null;
    }
    if (!buf) {
      await message.reply(att.size > discordConfig.downloadMaxBytes ? t("media.tooBigDownload") : t("media.downloadFailed"));
      first = false;
      continue;
    }
    const result = await postJson({
      chatId,
      discordUsername,
      kind,
      text: first ? text : "",
      fileBase64: buf.toString("base64"),
      filename: att.name ?? "file",
      mime: att.contentType ?? "application/octet-stream",
      size: buf.length,
      platformMsgId: first ? platformMsgId : `${platformMsgId}:${att.id ?? att.name ?? "file"}`,
    });
    first = false;
    if (result === "not-linked") {
      markUnwired(chatId);
      await message.reply(t("media.linkExpired"));
      return;
    }
    if (result === "error") {
      await message.reply(t("media.backendDown"));
      return;
    }
  }
}

/** Forward a native Discord DM deletion to the web room. */
export async function handleDeleted(chatId: string | null, discordMessageId: string): Promise<void> {
  if (!discordMessageId) return;
  try {
    await fetch(`${discordConfig.realtimeUrl}/api/discord/delete`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bot-secret": discordConfig.webhookSecret,
      },
      body: JSON.stringify(chatId ? { chatId, platformMsgId: discordMessageId } : { platformMsgId: discordMessageId }),
    });
  } catch (err) {
    console.error("discord delete forward failed", err);
  }
}
