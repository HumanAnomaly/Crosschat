import type { ChatMessage, Connection } from "@crosschat/core";

export interface SessionUser {
  id: string;
  email: string | null;
  name: string | null;
  picture?: string | null;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * The backend returns JSON errors, but a proxy or a payload-too-large abort can
 * still produce HTML. Fall back to a status-based message rather than throwing
 * a parse error that would mask the real failure.
 */
async function errorMessageFrom(res: Response): Promise<string> {
  const fallback = `Request failed (${res.status})`;
  try {
    const body = await res.json();
    if (typeof body?.error === "string") return body.error;
    if (typeof body?.message === "string") return body.message;
    return fallback;
  } catch {
    return fallback;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body != null;
  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new ApiError(res.status, await errorMessageFrom(res));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function getLoginUrl(): string {
  return "/api/auth/login";
}

export interface AppConfig {
  telegramEntryUrl: string;
  discordEntryUrl: string;
  whatsappEntryUrl?: string;
}

export async function getAppConfig(): Promise<AppConfig> {
  return request<AppConfig>("/api/config");
}

export async function getMe(): Promise<{ user: SessionUser | null }> {
  return request<{ user: SessionUser | null }>("/api/auth/me");
}

export async function logout(): Promise<void> {
  await request("/api/auth/logout", { method: "POST" });
}

export interface PairGenerateResult {
  code: string;
  expiresAt: string;
}

export async function generatePairCode(): Promise<PairGenerateResult> {
  return request<PairGenerateResult>("/api/pair/generate", { method: "POST" });
}

export async function claimPairCode(
  code: string,
): Promise<{ connection: Connection }> {
  return request<{ connection: Connection }>("/api/pair/claim", {
    method: "POST",
    body: JSON.stringify({ code: code.trim().toUpperCase() }),
  });
}

export interface ConnectionState {
  connection: Connection | null;
  messages: ChatMessage[];
}

export async function getConnection(limit = 50): Promise<ConnectionState> {
  return request<ConnectionState>(`/api/connection?limit=${limit}`);
}

export async function disconnect(): Promise<void> {
  await request("/api/connection", { method: "DELETE" });
}

export async function deleteMessage(id: string): Promise<void> {
  await request(`/api/messages/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export interface ConnectionStats {
  connectionId: string;
  platformId: string;
  username: string | null;
  createdAt: string;
  stats: {
    total: number;
    fromWeb: number;
    fromTelegram: number;
    fromDiscord: number;
    fromWhatsapp?: number;
    lastMessageAt: string | null;
  };
}

export async function getConnectionStats(connectionId?: string): Promise<ConnectionStats> {
  const qs = connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : "";
  return request<ConnectionStats>(`/api/connection/stats${qs}`);
}

export interface UploadResult {
  message: ChatMessage;
}

export async function uploadMedia(
  file: File,
  connectionId: string,
  caption?: string,
): Promise<UploadResult> {
  const res = await fetch(`/api/media/upload?connectionId=${encodeURIComponent(connectionId)}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      // Header values cannot carry non-ASCII (emoji in captions/names would
      // throw); the backend decodeURIComponent()s both of these.
      "X-Filename": encodeURIComponent(file.name),
      ...(caption ? { "X-Caption": encodeURIComponent(caption.slice(0, 4000)) } : {}),
    },
    body: file,
  });
  if (!res.ok) {
    const message = await errorMessageFrom(res);
    throw new ApiError(res.status, message.startsWith("Request failed") ? message.replace("Request", "Upload") : message);
  }
  return (await res.json()) as UploadResult;
}

/** Single contract: backend always returns `/media/<messageId>`. */
export function mediaUrl(message: ChatMessage): string {
  if (message.mediaPath?.startsWith("/media/")) return message.mediaPath;
  return `/media/${message.id}`;
}
