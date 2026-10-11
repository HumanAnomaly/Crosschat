import { webConfig } from "./config";
import type { Lang } from "./i18n";

export const FILE_LIMIT_LABEL = `${Math.round(webConfig.maxFileBytes / (1024 * 1024))}MB`;

export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${String(m).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function timeLocale(lang: Lang): string {
  return lang === "id" ? "id-ID" : "en-US";
}

export function formatTime(iso: string, lang: Lang = "en"): string {
  try {
    return new Date(iso).toLocaleTimeString(timeLocale(lang), { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
