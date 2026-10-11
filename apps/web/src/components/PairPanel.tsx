import { ArrowLeftRight, Check, ChevronRight, Copy, Link2, Shuffle, WifiOff } from "lucide-react";
import { PLATFORMS, type Platform } from "@crosschat/core";
import type { ConnectionStats, SessionUser } from "../api";
import { webConfig } from "../config";
import { useLang, type Lang } from "../i18n";
import { FILE_LIMIT_LABEL, formatCountdown } from "../format";
import PlatformRail from "./PlatformRail";
import PlatformIcon from "./PlatformIcon";
import UserAvatar from "./UserAvatar";

function dateLocale(lang: Lang): string {
  return lang === "id" ? "id-ID" : "en-GB";
}

function formatLastActivity(iso: string | null, lang: Lang): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString(dateLocale(lang), {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLinkedSince(iso: string | undefined, lang: Lang): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString(dateLocale(lang), { day: "2-digit", month: "short", year: "numeric" });
}

/** Per-platform message counter key, mirroring the bot /status numbers. */
const FROM_KEY = {
  telegram: "fromTelegram",
  discord: "fromDiscord",
  whatsapp: "fromWhatsapp",
} as const;

interface Props {
  me: SessionUser;
  displayName: string;
  connected: boolean;
  /** The live room's platform entry, resolved from the registry. */
  platform: Platform | null;
  messageCount: number;
  stats?: ConnectionStats | null;
  connectionCreatedAt?: string;
  accountName?: string | null;
  accountId?: string;
  pairCode: string;
  pairLeft: number;
  pairLoading: boolean;
  pairError: string;
  copied: boolean;
  linkCopied?: boolean;
  onGenerate: () => void;
  onCopy: () => void;
  onCopyLink?: () => void;
  onClaimOpen: () => void;
  onPlatformSelect: (id: string) => void;
  onSwitch: () => void;
  onDisconnect: () => void;
  onProfileOpen: () => void;
  anonActive: boolean;
  onAnonFind: () => void;
  /** Resolved registry (env overrides applied). Defaults to PLATFORMS. */
  platforms?: Platform[];
}

export default function PairPanel({
  me,
  displayName,
  connected,
  platform,
  messageCount,
  stats,
  connectionCreatedAt,
  accountName,
  accountId,
  pairCode,
  pairLeft,
  pairLoading,
  pairError,
  copied,
  linkCopied,
  onGenerate,
  onCopy,
  onCopyLink,
  onClaimOpen,
  onPlatformSelect,
  onSwitch,
  onDisconnect,
  onProfileOpen,
  anonActive,
  onAnonFind,
  platforms = PLATFORMS,
}: Props) {
  const { t, lang } = useLang();
  const ttlLabel = t("common.minutes", { n: Math.round(webConfig.pairTtlSeconds / 60) });
  return (
    <div className="flex flex-col gap-3">
      <div className="bg-base-100 rounded-2xl p-4 shadow-sm border border-base-300">
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-xl text-left"
          onClick={onProfileOpen}
          aria-label={t("profile.title")}
        >
          <UserAvatar user={me} size="md" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{displayName}</span>
            <span className="block truncate text-xs opacity-60">{me.email}</span>
          </span>
          <ChevronRight size={16} className="shrink-0 opacity-40" />
        </button>
        <div className="mt-3 flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${connected ? "text-success" : "opacity-60"}`}>
            <span className={`h-2 w-2 rounded-full ${connected ? "bg-success" : "bg-base-content/30"}`} />
            {connected && platform ? t("panel.linkedIs", { label: platform.label }) : t("panel.noLink")}
          </span>
        </div>
      </div>

      <div className="bg-base-100 rounded-2xl p-4 shadow-sm border border-base-300">
        <h2 className="text-sm font-bold">{t("panel.platforms")}</h2>
        <p className="mt-1 text-[13px] leading-relaxed opacity-65">
          {t("panel.platformsSub")}
        </p>
        <div className="mt-3">
          <PlatformRail connectedId={connected ? platform?.id ?? null : null} onSelect={onPlatformSelect} platforms={platforms} />
        </div>
      </div>

      <div className="bg-base-100 rounded-2xl p-4 shadow-sm border border-base-300">
        <h2 className="text-sm font-bold">{t("anon.title")}</h2>
        <p className="mt-1 text-[13px] leading-relaxed opacity-65">
          {t("anon.sub")}
        </p>
        <button
          className={`btn btn-sm mt-3 w-full gap-1.5 ${anonActive ? "btn-outline" : "btn-primary"}`}
          onClick={onAnonFind}
        >
          <Shuffle size={14} />
          {t("anon.find")}
        </button>
      </div>

      {!connected ? (
        <div className="bg-base-100 rounded-2xl p-4 shadow-sm border border-base-300">
          <h2 className="text-sm font-bold">{t("panel.pairTitle")}</h2>
          <p className="mt-1 text-[13px] leading-relaxed opacity-65">
            {t("panel.pairSub", { ttl: ttlLabel })}
          </p>
          {pairError && (
            <p role="alert" className="text-error mt-2 text-[13px]">
              {pairError}
            </p>
          )}
          {pairCode ? (
            <div className="pop-in bg-base-200 mt-3 rounded-xl border border-dashed border-base-content/20 p-3 text-center">
              <p className="font-mono text-[28px] font-bold tracking-[0.2em] tabular-nums select-all">{pairCode}</p>
              <p className="mt-1 text-xs tabular-nums opacity-60">{t("panel.expiresIn", { left: formatCountdown(pairLeft) })}</p>
              <progress className="progress progress-primary mt-2 h-1 w-full" value={pairLeft} max={webConfig.pairTtlSeconds} />
              <div className="mt-2 flex items-center justify-center gap-2">
                <button className="btn btn-outline btn-xs gap-1" onClick={onCopy}>
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? t("panel.copied") : t("panel.copy")}
                </button>
                <button className="btn btn-outline btn-xs gap-1" onClick={onCopyLink}>
                  {linkCopied ? <Check size={13} /> : <Link2 size={13} />}
                  {linkCopied ? t("panel.linkCopied") : t("panel.copyLink")}
                </button>
                <button className="btn btn-outline btn-xs" onClick={onGenerate} disabled={pairLoading}>
                  {t("panel.newCode")}
                </button>
              </div>
              <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] opacity-60">
                <span className="loading loading-bars loading-xs" />
                {t("panel.waiting")}
              </p>
            </div>
          ) : (
            <button className="btn btn-primary btn-sm mt-3 w-full" onClick={onGenerate} disabled={pairLoading}>
              {pairLoading && <span className="loading loading-spinner loading-xs" />}
              {pairLoading ? t("panel.creating") : t("panel.generate")}
            </button>
          )}
          <button className="btn btn-outline btn-sm mt-2 w-full gap-1.5" onClick={onClaimOpen}>
            <Link2 size={14} />
            {t("panel.enterCode")}
          </button>
        </div>
      ) : (
        <div className="bg-base-100 rounded-2xl p-4 shadow-sm border border-base-300">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            {platform && <PlatformIcon platform={platform} size={13} />}
            {platform ? t("panel.linkedIs", { label: platform.label }) : t("panel.linked")}
          </h2>
          <p className="mt-1 text-[13px] opacity-65">
            {t(messageCount === 1 ? "panel.roomOne" : "panel.roomMany", { count: messageCount })}
          </p>
          {/* Mirrors bot /status numbers. */}
          <dl className="mt-3 space-y-1.5 text-[13px]">
            <div className="flex justify-between gap-2">
              <dt className="opacity-60">{t("panel.account")}</dt>
              <dd className="max-w-[60%] truncate font-medium" title={accountName ?? undefined}>
                {accountName ? `@${accountName}` : "-"}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="opacity-60">{t("panel.userId")}</dt>
              <dd className="max-w-[60%] truncate font-mono text-xs tabular-nums" title={accountId ?? undefined}>
                {accountId ?? "-"}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="opacity-60">{t("panel.since")}</dt>
              <dd className="font-medium">{formatLinkedSince(stats?.createdAt ?? connectionCreatedAt, lang)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="opacity-60">{t("panel.total")}</dt>
              <dd className="font-medium tabular-nums">{stats?.stats.total ?? messageCount}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="opacity-60">{t("panel.fromWeb")}</dt>
              <dd className="font-medium tabular-nums">{stats?.stats.fromWeb ?? "-"}</dd>
            </div>
            {platform && (
              <div className="flex justify-between gap-2">
                <dt className="opacity-60">{t("panel.fromPlatform", { label: platform.label })}</dt>
                <dd className="font-medium tabular-nums">
                  {(platform.id in FROM_KEY
                    ? stats?.stats[FROM_KEY[platform.id as keyof typeof FROM_KEY]]
                    : undefined) ?? "-"}
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <dt className="opacity-60">{t("panel.lastActivity")}</dt>
              <dd className="font-medium">{formatLastActivity(stats?.stats.lastMessageAt ?? null, lang)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[11px] opacity-55">
            {t("panel.deleteHint")}
          </p>
          <button className="btn btn-primary btn-sm mt-2 w-full gap-1.5" onClick={onSwitch}>
            <ArrowLeftRight size={14} />
            {t("panel.switch")}
          </button>
          <button className="btn btn-outline btn-sm border-error/25 text-error mt-2 w-full gap-1.5" onClick={onDisconnect}>
            <WifiOff size={14} />
            {t("chat.disconnect")}
          </button>
        </div>
      )}

      <p className="px-1 text-[11px] leading-relaxed opacity-50">
        {t("panel.syncNote", { limit: FILE_LIMIT_LABEL })}
      </p>
    </div>
  );
}
