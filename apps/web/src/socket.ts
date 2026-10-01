import { io, type Socket } from "socket.io-client";
import type { ChatMessage, Connection } from "@crosschat/core";

export type MessageHandler = (msg: ChatMessage) => void;
export type CreatedHandler = (connection: Connection) => void;
export type ClosedHandler = () => void;

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
): Socket {
  const s = getSocket();
  if (currentRoom && currentRoom !== connectionId) {
    s.emit("leave", { connectionId: currentRoom });
  }
  currentRoom = connectionId;
  s.off("message:new");
  s.off("message:deleted");
  if (!s.connected) s.connect();
  s.emit("join", { connectionId });
  s.on("message:new", (msg: ChatMessage) => onMessage(msg));
  if (onDeleted) s.on("message:deleted", (payload: { id: string; connectionId: string }) => onDeleted(payload));
  return s;
}

export function leaveChat(connectionId?: string): void {
  const target = connectionId ?? currentRoom;
  if (target) socket?.emit("leave", { connectionId: target });
  if (!connectionId || connectionId === currentRoom) {
    currentRoom = null;
    socket?.off("message:new");
    socket?.off("message:deleted");
  }
}

export function disconnectSocket(): void {
  currentRoom = null;
  socket?.off("message:new");
  socket?.off("message:deleted");
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
