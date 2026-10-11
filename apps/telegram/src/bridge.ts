import type { Context } from "grammy";
import { telegramConfig } from "./config.js";
import { translate } from "./i18n.js";
import { fetchLinkStatus, isWired, markUnwired, markWired, usernameOf, wiredKeyboard } from "./wired.js";

type InboundKind = "text" | "photo" | "video" | "document" | "voice" | "sticker";


type PostResult = "ok" | "not-linked" | "error";

function t(key: string): string {
  return translate(telegramConfig.locale, key);
}

function captionOf(msg: object): string {
  if ("caption" in msg && typeof (msg as { caption?: unknown }).caption === "string") {
    return ((msg as { caption: string }).caption ?? "").slice(0, 1000);
  }
  return "";
}

async function download(ctx: Context, fileId: string, size?: number): Promise<Buffer | null> {
  if (size != null && size > telegramConfig.downloadMaxBytes) {
    await ctx.reply(t("media.tooBigDownload"));
    return null;
  }
  const file = await ctx.api.getFile(fileId);
  if (!file.file_path) {
    await ctx.reply(t("media.unavailable"));
    return null;
  }
  const url = `https://api.telegram.org/file/bot${telegramConfig.token}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) {
    await ctx.reply(t("media.downloadFailed"));
    return null;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > telegramConfig.uploadMaxBytes) {
    await ctx.reply(t("media.tooBigForward"));
    return null;
  }
  return buf;
}

async function postText(chatId: string, text: string, telegramUsername: string | null, platformMsgId?: string): Promise<PostResult> {
  let res: Response;
  try {
    res = await fetch(`${telegramConfig.realtimeUrl}/api/telegram/inbound`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bot-secret": telegramConfig.webhookSecret,
      },
      body: JSON.stringify({ chatId, telegramUsername, kind: "text", text: text.slice(0, 4000), platformMsgId }),
    });
  } catch {
    return "error";
  }
  if (res.status === 404) return "not-linked";
  return res.ok ? "ok" : "error";
}

async function postFile(opts: {
  chatId: string;
  telegramUsername: string | null;
  kind: InboundKind;
  text: string;
  buf: Buffer;
  filename: string;
  mime: string;
  platformMsgId?: string;
}): Promise<PostResult> {
  let res: Response;
  try {
    res = await fetch(`${telegramConfig.realtimeUrl}/api/telegram/inbound`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bot-secret": telegramConfig.webhookSecret,
      },
      body: JSON.stringify({
        chatId: opts.chatId,
        telegramUsername: opts.telegramUsername,
        kind: opts.kind,
        text: opts.text.slice(0, 4000),
        fileBase64: opts.buf.toString("base64"),
        filename: opts.filename,
        mime: opts.mime,
        size: opts.buf.length,
        platformMsgId: opts.platformMsgId,
      }),
    });
  } catch {
    return "error";
  }
  if (res.status === 404) return "not-linked";
  return res.ok ? "ok" : "error";
}

async function replyGone(ctx: Context): Promise<void> {
  // The link died server-side; fix local memory and say so.
  const chatId = ctx.chat ? String(ctx.chat.id) : "";
  if (chatId) markUnwired(chatId);
  await ctx.reply(t("media.linkExpired"), { reply_markup: wiredKeyboard(false) });
}

/** Delete a bridged message from a `/delete` reply. Returns true when handled. */
export async function handleDeleteCommand(ctx: Context): Promise<boolean> {
  const msg = ctx.msg as
    | { text?: unknown; reply_to_message?: { message_id?: unknown } }
    | undefined;
  const text = typeof msg?.text === "string" ? msg.text.trim() : "";
  if (!/^\/delete(@\w+)?\s*$/.test(text)) return false;
  const chatId = ctx.chat ? String(ctx.chat.id) : "";
  if (!chatId) return true;
  const replied = msg?.reply_to_message?.message_id;
  if (replied == null) {
    await ctx.reply(t("delete.noReply"));
    return true;
  }
  try {
    const res = await fetch(`${telegramConfig.realtimeUrl}/api/telegram/delete`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bot-secret": telegramConfig.webhookSecret,
      },
      body: JSON.stringify({ chatId, platformMsgId: String(replied) }),
    });
    if (res.status === 404) {
      await replyGone(ctx);
      return true;
    }
    if (res.status === 403) {
      await ctx.reply(t("delete.forbidden"));
      return true;
    }
    const data = (await res.json().catch(() => null)) as { deleted?: boolean } | null;
    await ctx.reply(t(data?.deleted ? "delete.done" : "delete.notFound"));
  } catch {
    await ctx.reply(t("media.backendDown"));
  }
  return true;
}

export async function handleInbound(ctx: Context): Promise<void> {
  const chatId = ctx.chat ? String(ctx.chat.id) : "";
  if (!chatId || !ctx.msg) return;
  if (!isWired(chatId)) {
    const status = await fetchLinkStatus(chatId);
    if (!status) {
      await ctx.reply(t("media.backendDown"));
      return;
    }
    if (!status.wired) {
      await ctx.reply(t("media.notLinked"), { reply_markup: wiredKeyboard(false) });
      return;
    }
    markWired(chatId);
  }
  const msg = ctx.msg;
  const telegramUsername = usernameOf(ctx);

  if ("text" in msg && typeof msg.text === "string") {
    const platformMsgId = typeof (msg as { message_id?: unknown }).message_id !== "undefined"
      ? String((msg as { message_id?: unknown }).message_id)
      : undefined;
    const result = await postText(chatId, msg.text, telegramUsername, platformMsgId);
    if (result === "not-linked") {
      await replyGone(ctx);
    } else if (result === "error") {
      await ctx.reply(t("media.backendDown"));
    }
    return;
  }

  let fileId = "";
  let size: number | undefined;
  let kind: InboundKind | null = null;
  let filename = "file.bin";
  let mime = "application/octet-stream";

  if ("photo" in msg && Array.isArray(msg.photo) && msg.photo.length > 0) {
    const best = msg.photo[msg.photo.length - 1];
    fileId = best.file_id;
    size = best.file_size;
    kind = "photo";
    filename = "photo.jpg";
    mime = "image/jpeg";
  } else if ("video" in msg && msg.video) {
    fileId = msg.video.file_id;
    size = msg.video.file_size;
    kind = "video";
    filename = "video.mp4";
    mime = msg.video.mime_type ?? "video/mp4";
  } else if ("animation" in msg && msg.animation) {
    fileId = msg.animation.file_id;
    size = msg.animation.file_size;
    kind = "video";
    filename = "animation.mp4";
    mime = msg.animation.mime_type ?? "video/mp4";
  } else if ("document" in msg && msg.document) {
    fileId = msg.document.file_id;
    size = msg.document.file_size;
    kind = "document";
    filename = msg.document.file_name ?? "document.bin";
    mime = msg.document.mime_type ?? "application/octet-stream";
  } else if ("voice" in msg && msg.voice) {
    fileId = msg.voice.file_id;
    size = msg.voice.file_size;
    kind = "voice";
    filename = "voice.ogg";
    mime = msg.voice.mime_type ?? "audio/ogg";
  } else if ("audio" in msg && msg.audio) {
    fileId = msg.audio.file_id;
    size = msg.audio.file_size;
    kind = "voice";
    filename = msg.audio.file_name ?? "audio.mp3";
    mime = msg.audio.mime_type ?? "audio/mpeg";
  } else if ("video_note" in msg && msg.video_note) {
    fileId = msg.video_note.file_id;
    size = msg.video_note.file_size;
    kind = "video";
    filename = "video_note.mp4";
    mime = "video/mp4";
  } else if ("sticker" in msg && msg.sticker) {
    fileId = msg.sticker.file_id;
    size = msg.sticker.file_size;
    kind = "sticker";
    filename = "sticker.webp";
    mime = "image/webp";
  }

  if (!kind || !fileId) {
    await ctx.reply(t("media.unsupported"));
    return;
  }

  try {
    const buf = await download(ctx, fileId, size);
    if (!buf) return;
    const platformMsgId = typeof msg.message_id !== "undefined" ? String(msg.message_id) : undefined;
    const result = await postFile({ chatId, telegramUsername, kind, text: captionOf(msg), buf, filename, mime, platformMsgId });
    if (result === "not-linked") {
      await replyGone(ctx);
    } else if (result === "error") {
      await ctx.reply(t("media.backendDown"));
    }
  } catch {
    await ctx.reply(t("media.backendDown"));
  }
}
