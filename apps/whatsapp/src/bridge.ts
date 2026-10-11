import { createLogger } from "@crosschat/core";
import { whatsappConfig } from "./config.js";
import { translate } from "./i18n.js";
import { fetchLinkStatus, isWired, markUnwired, markWired, usernameOf } from "./wired.js";
import type { AnyClient } from "./client.js";

type InboundKind = "text" | "photo" | "video" | "document" | "voice" | "sticker";
type PostResult = "ok" | "not-linked" | "error";

const log = createLogger("whatsapp");

function t(key: string): string {
  return translate(whatsappConfig.locale, key);
}

export function extractText(message: any): string {
  if (!message || typeof message !== "object") return "";
  return (
    message.conversation ??
    message.extendedTextMessage?.text ??
    message.imageMessage?.caption ??
    message.videoMessage?.caption ??
    ""
  );
}

function detectKind(message: any): { kind: InboundKind; mime: string; filename: string } | null {
  if (!message || typeof message !== "object") return null;
  if (message.conversation || message.extendedTextMessage) {
    return { kind: "text", mime: "text/plain", filename: "message.txt" };
  }
  if (message.imageMessage) {
    return { kind: "photo", mime: message.imageMessage.mimetype ?? "image/jpeg", filename: "photo.jpg" };
  }
  if (message.videoMessage) {
    return { kind: "video", mime: message.videoMessage.mimetype ?? "video/mp4", filename: "video.mp4" };
  }
  if (message.audioMessage) {
    return { kind: "voice", mime: message.audioMessage.mimetype ?? "audio/ogg; codecs=opus", filename: "voice.ogg" };
  }
  if (message.documentMessage) {
    return {
      kind: "document",
      mime: message.documentMessage.mimetype ?? "application/octet-stream",
      filename: message.documentMessage.fileName ?? "document.bin",
    };
  }
  if (message.stickerMessage) {
    return { kind: "sticker", mime: message.stickerMessage.mimetype ?? "image/webp", filename: "sticker.webp" };
  }
  return null;
}

async function postJson(payload: Record<string, unknown>): Promise<PostResult> {
  let res: Response;
  try {
    res = await fetch(`${whatsappConfig.realtimeUrl}/api/whatsapp/inbound`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bot-secret": whatsappConfig.webhookSecret },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    log.error(`inbound unreachable (${whatsappConfig.realtimeUrl})`, err);
    return "error";
  }
  if (res.status === 404) return "not-linked";
  if (!res.ok) {
    log.error(`inbound rejected with ${res.status} (check x-bot-secret match with realtime)`);
    return "error";
  }
  return "ok";
}

export async function handleInbound(client: AnyClient, event: any): Promise<void> {
  const key = event?.key ?? {};
  if (key.fromMe) return;
  if (key.isGroup || key.isBroadcast || key.isNewsletter) return;
  const chatId = typeof key.remoteJid === "string" ? key.remoteJid : "";
  if (!chatId) return;

  const send = async (text: string) => {
    try {
      await client.message.send(chatId, text);
    } catch (err) {
      log.error("wa reply failed", err);
    }
  };

  if (!isWired(chatId)) {
    const status = await fetchLinkStatus(chatId);
    if (!status) {
      await send(t("media.backendDown"));
      return;
    }
    if (!status.wired) {
      await send(t("media.notLinked"));
      return;
    }
    markWired(chatId);
  }

  const detected = detectKind(event?.message);
  if (!detected) {
    await send(t("media.unsupported"));
    return;
  }
  const username = usernameOf(chatId) ?? event?.pushName?.slice(0, 32) ?? null;
  const text = extractText(event?.message).slice(0, 4000);
  const platformMsgId = typeof key.id === "string" ? key.id : undefined;

  if (detected.kind === "text") {
    if (!text.trim()) {
      await send(t("media.unsupported"));
      return;
    }
    const result = await postJson({ chatId, whatsappUsername: username, kind: "text", text, platformMsgId });
    if (result === "not-linked") {
      markUnwired(chatId);
      await send(t("media.linkExpired"));
    } else if (result === "error") {
      await send(t("media.backendDown"));
    }
    return;
  }

  let buf: Uint8Array | null = null;
  try {
    buf = await client.message.downloadBytes(event, { maxBytes: whatsappConfig.downloadMaxBytes });
  } catch (err) {
    log.error("wa download failed", err);
    await send(t("media.downloadFailed"));
    return;
  }
  if (!buf || buf.length === 0) {
    await send(t("media.downloadFailed"));
    return;
  }
  if (buf.length > whatsappConfig.uploadMaxBytes) {
    await send(t("media.tooBigForward"));
    return;
  }
  const result = await postJson({
    chatId,
    whatsappUsername: username,
    kind: detected.kind,
    text,
    fileBase64: Buffer.from(buf).toString("base64"),
    filename: detected.filename,
    mime: detected.mime,
    size: buf.length,
    platformMsgId,
  });
  if (result === "not-linked") {
    markUnwired(chatId);
    await send(t("media.linkExpired"));
  } else if (result === "error") {
    await send(t("media.backendDown"));
  }
}
