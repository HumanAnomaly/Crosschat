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

export const UNAUTHORIZED_EVENT = "crosschat:unauthorized";

function notifyUnauthorized(): void {
  window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
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
    if (res.status === 401) notifyUnauthorized();
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
  configured?: { telegram: boolean; discord: boolean; whatsapp: boolean };
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

export interface PushConfig {
  enabled: boolean;
  publicKey: string;
}

export async function getPushConfig(): Promise<PushConfig> {
  return request<PushConfig>("/api/push/config");
}

export async function subscribePushServer(sub: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/api/push/subscribe", { method: "POST", body: JSON.stringify(sub) });
}

export async function unsubscribePushServer(endpoint: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/api/push/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint }) });
}

export interface UploadResult {
  message: ChatMessage;
}

export interface UploadOptions {
  signal?: AbortSignal;
  onProgress?: (ratio: number) => void;
}

// fetch has no upload-progress events, so uploads go through XHR.
export function uploadMedia(
  file: File,
  connectionId: string,
  caption?: string,
  opts?: UploadOptions,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/media/upload?connectionId=${encodeURIComponent(connectionId)}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    // Header values cannot carry non-ASCII (emoji in captions/names would
    // throw); the backend decodeURIComponent()s both of these.
    xhr.setRequestHeader("X-Filename", encodeURIComponent(file.name));
    if (caption) xhr.setRequestHeader("X-Caption", encodeURIComponent(caption.slice(0, 4000)));
    opts?.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) opts?.onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status === 401) notifyUnauthorized();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadResult);
        } catch {
          reject(new ApiError(xhr.status, "Upload failed (bad response)"));
        }
        return;
      }
      let message = `Upload failed (${xhr.status})`;
      try {
        const body = JSON.parse(xhr.responseText) as { error?: unknown; message?: unknown };
        if (typeof body?.error === "string") message = body.error;
        else if (typeof body?.message === "string") message = body.message;
      } catch {
        /* keep fallback */
      }
      reject(new ApiError(xhr.status, message));
    };
    xhr.onerror = () => reject(new ApiError(0, "Upload failed (network)"));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    if (opts?.signal?.aborted) {
      reject(new DOMException("Upload cancelled", "AbortError"));
      return;
    }
    xhr.send(file);
  });
}

/** Single contract: backend always returns `/media/<messageId>`. */
export function mediaUrl(message: ChatMessage): string {
  if (message.mediaPath?.startsWith("/media/")) return message.mediaPath;
  return `/media/${message.id}`;
}

export interface AnonSession {
  id: string;
  partnerPlatform: string;
}

export interface AnonJoinResult {
  matched: boolean;
  queued?: boolean;
  session?: AnonSession;
}

export interface AnonLeaveResult {
  ok: boolean;
  ended: boolean;
  wasQueued: boolean;
}

export interface AnonStatus {
  inQueue: boolean;
  session: AnonSession | null;
}

export function joinAnonQueue(): Promise<AnonJoinResult> {
  return request<AnonJoinResult>("/api/anon/join", { method: "POST" });
}

export function leaveAnonQueue(): Promise<AnonLeaveResult> {
  return request<AnonLeaveResult>("/api/anon/leave", { method: "POST" });
}

export function nextAnonPartner(): Promise<AnonJoinResult> {
  return request<AnonJoinResult>("/api/anon/next", { method: "POST" });
}

export function getAnonStatus(): Promise<AnonStatus> {
  return request<AnonStatus>("/api/anon/status");
}
