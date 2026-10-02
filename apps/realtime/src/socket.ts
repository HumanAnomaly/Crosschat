import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { chatMessageSchema, type ChatMessage } from "@crosschat/core";
import { resolveSessionUser, SESSION_COOKIE } from "./auth.js";
import { allowedOrigins } from "./env.js";
import {
  findConnectionById,
  insertMessage,
  listMessages,
  findMessageById,
} from "./db.js";

export type WebMessageHandler = (connectionId: string, message: ChatMessage) => void;

let io: Server | null = null;
let webMessageHandler: WebMessageHandler | null = null;

export function setWebMessageHandler(fn: WebMessageHandler | null): void {
  webMessageHandler = fn;
}

export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(`user:${userId}`).emit(event, payload);
}

export function emitToConnection(connectionId: string, event: string, payload: unknown): void {
  io?.to(`conn:${connectionId}`).emit(event, payload);
}

function readSessionCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === SESSION_COOKIE) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return undefined;
}

/** Single public contract: media is always `/media/<messageId>`. */
function toChatMessage(row: {
  id: string;
  connection_id: string;
  sender: string;
  kind: string;
  text: string | null;
  media_path: string | null;
  mime: string | null;
  size: number | null;
  created_at: number;
}): ChatMessage {
  const sender: ChatMessage["sender"] =
    row.sender === "telegram" ? "telegram" : row.sender === "discord" ? "discord" : row.sender === "whatsapp" ? "whatsapp" : "web";
  return {
    id: row.id,
    connectionId: row.connection_id,
    sender,
    kind: row.kind as ChatMessage["kind"],
    text: row.text ?? undefined,
    mediaPath: row.media_path ? `/media/${row.id}` : undefined,
    mime: row.mime ?? undefined,
    size: row.size ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export { toChatMessage };

const sendStamps = new Map<string, number[]>();
function checkSendRate(userId: string): boolean {
  const now = Date.now();
  const arr = (sendStamps.get(userId) ?? []).filter((t) => now - t < 10_000);
  if (arr.length >= 20) {
    sendStamps.set(userId, arr);
    return false;
  }
  arr.push(now);
  sendStamps.set(userId, arr);
  return true;
}

export function attachSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: allowedOrigins(), credentials: true },
  });

  io.use((socket, next) => {
    const user = resolveSessionUser(
      (socket.handshake.auth?.session as string | undefined) ??
        readSessionCookie(socket.handshake.headers.cookie),
    );
    if (!user) {
      next(new Error("unauthorized"));
      return;
    }
    socket.data.userId = user.id;
    next();
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    socket.join(`user:${userId}`);

    // A session can die after connect; re-resolve it from the database on
    // every privileged event and drop stale sockets after one final answer.
    function liveUser(ack?: (res: unknown) => void): boolean {
      const user = resolveSessionUser(
        (socket.handshake.auth?.session as string | undefined) ??
          readSessionCookie(socket.handshake.headers.cookie),
      );
      if (!user || user.id !== userId) {
        socket.emit("error:message", { error: "session expired" });
        if (ack) ack({ ok: false, error: "session expired" });
        setTimeout(() => socket.disconnect(true), 50).unref?.();
        return false;
      }
      return true;
    }

    socket.on("join", (raw: unknown) => {
      if (!liveUser()) return;
      const connectionId =
        typeof raw === "string" ? raw : (raw as { connectionId?: unknown })?.connectionId;
      if (typeof connectionId !== "string") return;
      const connection = findConnectionById(connectionId);
      if (!connection || connection.user_id !== userId) {
        socket.emit("error:message", { error: "connection not found" });
        return;
      }
      socket.join(`conn:${connectionId}`);
      socket.emit(
        "message:history",
        listMessages(connectionId).map(toChatMessage),
      );
    });

    socket.on("leave", (raw: unknown) => {
      const connectionId =
        typeof raw === "string" ? raw : (raw as { connectionId?: unknown })?.connectionId;
      if (typeof connectionId === "string") socket.leave(`conn:${connectionId}`);
    });

    socket.on("message:send", (payload: unknown, ack?: (res: unknown) => void) => {
      if (!liveUser(ack)) return;
      if (!checkSendRate(userId)) {
        if (ack) ack({ ok: false, error: "too many requests" });
        return;
      }
      if (typeof payload !== "object" || payload === null) {
        if (ack) ack({ ok: false, error: "invalid payload" });
        return;
      }
      const body = payload as Record<string, unknown>;
      if (typeof body.connectionId !== "string") {
        if (ack) ack({ ok: false, error: "connectionId required" });
        return;
      }
      const connection = findConnectionById(body.connectionId);
      if (!connection || connection.user_id !== userId) {
        socket.emit("error:message", { error: "connection not found" });
        if (ack) ack({ ok: false, error: "connection not found" });
        return;
      }
      // Text-only here; media goes through POST /api/media/upload.
      // Client-supplied `mediaPath` would be a traversal + spoof vector.
      if (body.kind !== "text" && body.kind !== undefined) {
        if (ack) ack({ ok: false, error: "use media upload for files" });
        return;
      }
      if (typeof body.mediaPath === "string" || typeof body.mediaId === "string") {
        if (ack) ack({ ok: false, error: "use media upload for files" });
        return;
      }
      const candidate = {
        id: randomUUID(),
        connectionId: connection.id,
        sender: "web" as const,
        kind: "text" as const,
        text: body.text,
        createdAt: new Date().toISOString(),
      };
      const parsed = chatMessageSchema.safeParse(candidate);
      if (!parsed.success || !parsed.data.text) {
        socket.emit("error:message", { error: "text message needs text" });
        if (ack) ack({ ok: false, error: "text message needs text" });
        return;
      }
      const saved = insertMessage({
        id: parsed.data.id,
        connectionId: parsed.data.connectionId,
        sender: parsed.data.sender,
        kind: parsed.data.kind,
        text: parsed.data.text,
        mediaPath: null,
        mime: null,
        size: null,
        createdAt: Date.parse(parsed.data.createdAt),
      });
      const message = toChatMessage(saved);
      io?.to(`conn:${connection.id}`).emit("message:new", message);
      if (ack) ack({ ok: true, message });
      webMessageHandler?.(connection.id, message);
    });

    socket.on("message:delete", (payload: unknown, ack?: (res: unknown) => void) => {
      if (!liveUser(ack)) return;
      const body = (payload ?? {}) as Record<string, unknown>;
      const id = typeof body.id === "string" ? body.id : typeof body.messageId === "string" ? body.messageId : null;
      const connectionId = typeof body.connectionId === "string" ? body.connectionId : null;
      if (!id) {
        if (ack) ack({ ok: false, error: "id required" });
        return;
      }
      const meta = findMessageById(id);
      if (!meta) {
        if (ack) ack({ ok: false, error: "message not found" });
        return;
      }
      if (connectionId && meta.connection_id !== connectionId) {
        if (ack) ack({ ok: false, error: "message not found" });
        return;
      }
      const connection = findConnectionById(meta.connection_id);
      if (!connection || connection.user_id !== userId) {
        if (ack) ack({ ok: false, error: "forbidden" });
        return;
      }
      if (meta.sender !== "web") {
        if (ack) ack({ ok: false, error: "you can only delete your own messages" });
        return;
      }
      void import("./messages.js").then(({ eraseMessageCompletely }) =>
        eraseMessageCompletely(meta).then(() => {
          if (ack) ack({ ok: true, id });
        }),
      );
    });
  });

  return io;
}
