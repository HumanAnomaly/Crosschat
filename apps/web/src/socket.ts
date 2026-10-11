import { io, type Socket } from "socket.io-client";
import type { ChatMessage, Connection } from "@crosschat/core";
import { UNAUTHORIZED_EVENT } from "./api";

export type MessageHandler = (msg: ChatMessage) => void;
export type CreatedHandler = (connection: Connection) => void;
export type ClosedHandler = () => void;
export type StatusHandler = (online: boolean) => void;
export type DeliveredHandler = (payload: { id: string; ok: boolean }) => void;

let socket: Socket | null = null;
let currentRoom: string | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      withCredentials: true,
      autoConnect: false,
    });
  }
  return socket;
}

/**
 * Reports socket health and re-joins the current room after a reconnect
 * (server-side room membership is lost on disconnect; the server answers
 * every join with `message:history`, which backfills missed messages).
 */
export function onSocketStatus(handler: StatusHandler): () => void {
  const s = getSocket();
  const onConnect = () => {
    if (currentRoom) s.emit("join", { connectionId: currentRoom });
    handler(true);
  };
  const onDisconnect = (reason: string) => {
    if (reason !== "io client disconnect") handler(false);
  };
  // The server rejects the handshake with "unauthorized" when the session is
  // dead; every other connect_error is a network issue (banner only). A plain
  // server-side disconnect is NOT mapped: deploys drop sockets too, and the
  // reconnect handshake will report "unauthorized" if the session is gone.
  const onError = (err: Error) => {
    handler(false);
    if (err?.message === "unauthorized") window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
  };
  s.on("connect", onConnect);
  s.on("disconnect", onDisconnect);
  s.on("connect_error", onError);
  return () => {
    s.off("connect", onConnect);
    s.off("disconnect", onDisconnect);
    s.off("connect_error", onError);
  };
}

export function connectSession(onCreated: CreatedHandler, onClosed: ClosedHandler): Socket {
  const s = getSocket();
  s.off("connection:created");
  s.off("connection:closed");
  if (!s.connected) s.connect();
  s.on("connection:created", (connection: Connection) => onCreated(connection));
  s.on("connection:closed", () => onClosed());
  return s;
}

export function joinChat(
  connectionId: string,
  onMessage: MessageHandler,
  onDeleted?: (payload: { id: string; connectionId: string }) => void,
  onHistory?: (msgs: ChatMessage[]) => void,
  onDelivered?: DeliveredHandler,
): Socket {
  const s = getSocket();
  if (currentRoom && currentRoom !== connectionId) {
    s.emit("leave", { connectionId: currentRoom });
  }
  currentRoom = connectionId;
  s.off("message:new");
  s.off("message:deleted");
  s.off("message:history");
  s.off("message:delivered");
  s.on("message:new", (msg: ChatMessage) => {
    if (msg?.connectionId === connectionId) onMessage(msg);
  });
  s.on("message:history", (msgs: ChatMessage[]) => {
    if (!Array.isArray(msgs)) return;
    const mine = msgs.filter((m) => m?.connectionId === connectionId);
    if (onHistory) onHistory(mine);
    else mine.forEach(onMessage);
  });
  if (onDeleted) {
    s.on("message:deleted", (payload: { id: string; connectionId: string }) => {
      if (payload?.connectionId === connectionId) onDeleted(payload);
    });
  }
  if (onDelivered) {
    s.on("message:delivered", (payload: { id: string; connectionId?: string; ok: boolean }) => {
      if (typeof payload?.id === "string" && (!payload.connectionId || payload.connectionId === connectionId)) {
        onDelivered({ id: payload.id, ok: payload.ok !== false });
      }
    });
  }
  if (!s.connected) s.connect();
  else s.emit("join", { connectionId });
  return s;
}

export function leaveChat(connectionId?: string): void {
  const target = connectionId ?? currentRoom;
  if (target) socket?.emit("leave", { connectionId: target });
  if (!connectionId || connectionId === currentRoom) {
    currentRoom = null;
    socket?.off("message:new");
    socket?.off("message:deleted");
    socket?.off("message:history");
    socket?.off("message:delivered");
  }
}

export function disconnectSocket(): void {
  currentRoom = null;
  socket?.off("message:new");
  socket?.off("message:deleted");
  socket?.off("message:history");
  socket?.off("message:delivered");
  socket?.off("connection:created");
  socket?.off("connection:closed");
  if (socket?.connected) socket.disconnect();
}

export function sendText(
  s: Socket,
  connectionId: string,
  text: string,
): Promise<ChatMessage> {
  return new Promise((resolve, reject) => {
    s.emit(
      "message:send",
      { connectionId, kind: "text", text },
      (res: { ok: boolean; message?: ChatMessage; error?: string }) => {
        if (res?.ok && res.message) resolve(res.message);
        else reject(new Error(res?.error ?? "Failed to send message"));
      },
    );
  });
}

export function deleteMessageSocket(
  s: Socket,
  connectionId: string,
  id: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    s.emit(
      "message:delete",
      { connectionId, id },
      (res: { ok: boolean; error?: string }) => {
        if (res?.ok) resolve();
        else reject(new Error(res?.error ?? "Failed to delete message"));
      },
    );
  });
}

export interface AnonFound {
  sessionId: string;
  partnerPlatform: string;
}

export interface AnonIncoming {
  id: string;
  sender: ChatMessage["sender"];
  kind: string;
  text?: string | null;
  createdAt: string;
  sessionId: string;
}

export interface AnonAck {
  ok: boolean;
  message?: ChatMessage;
  sessionId?: string;
  error?: string;
}

export function onAnonFound(handler: (found: AnonFound) => void): () => void {
  const s = getSocket();
  const wrapped = (payload: AnonFound) => {
    if (payload && typeof payload.sessionId === "string") handler(payload);
  };
  s.on("anon:found", wrapped);
  return () => {
    s.off("anon:found", wrapped);
  };
}

export function onAnonEnded(handler: (payload: { sessionId: string }) => void): () => void {
  const s = getSocket();
  const wrapped = (payload: { sessionId: string }) => {
    if (payload && typeof payload.sessionId === "string") handler(payload);
  };
  s.on("anon:ended", wrapped);
  return () => {
    s.off("anon:ended", wrapped);
  };
}

export function onAnonMessage(handler: (msg: AnonIncoming) => void): () => void {
  const s = getSocket();
  const wrapped = (msg: AnonIncoming) => {
    if (msg && typeof msg.id === "string" && typeof msg.sessionId === "string") handler(msg);
  };
  s.on("anon:new", wrapped);
  return () => {
    s.off("anon:new", wrapped);
  };
}

export function sendAnonText(text: string, timeoutMs = 20000): Promise<AnonAck> {
  const s = getSocket();
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      // Socket dropped mid-send: answer locally so the send button recovers
      // instead of staying disabled forever.
      if (!done) {
        done = true;
        resolve({ ok: false });
      }
    }, timeoutMs);
    s.emit("anon:send", { text }, (res: AnonAck) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(res ?? { ok: false });
      }
    });
  });
}
