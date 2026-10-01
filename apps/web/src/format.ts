import { webConfig } from "./config";

export const FILE_LIMIT_LABEL = `${Math.round(webConfig.maxFileBytes / (1024 * 1024))}MB`;
export const PAIR_TTL_LABEL = `${Math.round(webConfig.pairTtlSeconds / 60)} minutes`;

export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${String(m).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
