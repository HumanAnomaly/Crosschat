import { Check, Copy, Link2, WifiOff } from "lucide-react";
import { PLATFORMS, type Platform } from "@crosschat/core";
import type { ConnectionStats, SessionUser } from "../api";
import { webConfig } from "../config";
import { FILE_LIMIT_LABEL, PAIR_TTL_LABEL, formatCountdown } from "../format";
import PlatformRail from "./PlatformRail";
import PlatformIcon from "./PlatformIcon";
import UserAvatar from "./UserAvatar";

function formatLastActivity(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLinkedSince(iso: string | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

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
  onGenerate: () => void;
  onCopy: () => void;
  onClaimOpen: () => void;
  onPlatformSelect: (id: string) => void;
  onDisconnect: () => void;
  onLogout: () => void;
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
  onGenerate,
  onCopy,
  onClaimOpen,
  onPlatformSelect,
  onDisconnect,
  onLogout,
  platforms = PLATFORMS,
}: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="bg-base-100 rounded-2xl p-4 shadow-sm border border-base-300">
        <div className="flex items-center gap-3">
          <UserAvatar user={me} size="md" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{displayName}</span>
            <span className="block truncate text-xs opacity-60">{me.email}</span>
          </span>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${connected ? "text-success" : "opacity-60"}`}>
            <span className={`h-2 w-2 rounded-full ${connected ? "bg-success" : "bg-base-content/30"}`} />
            {connected && platform ? `${platform.label} linked` : "No platform linked"}
          </span>
          <span className="flex-1" />
          <button className="btn btn-outline btn-xs" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </div>

      <div className="bg-base-100 rounded-2xl p-4 shadow-sm border border-base-300">
        <h2 className="text-sm font-bold">Platforms</h2>
        <p className="mt-1 text-[13px] leading-relaxed opacity-65">
          Pick a platform to see how to link it. One room at a time.
        </p>
        <div className="mt-3">
          <PlatformRail connectedId={connected ? platform?.id ?? null : null} onSelect={onPlatformSelect} platforms={platforms} />
        </div>
      </div>

      {!connected ? (
        <div className="bg-base-100 rounded-2xl p-4 shadow-sm border border-base-300">
          <h2 className="text-sm font-bold">Pair your account</h2>
          <p className="mt-1 text-[13px] leading-relaxed opacity-65">
            Generate a code and send it to your platform, or enter one it gave you. Valid {PAIR_TTL_LABEL}.
          </p>
          {pairError && (
            <p role="alert" className="text-error mt-2 text-[13px]">
              {pairError}
            </p>
          )}
          {pairCode ? (
            <div className="bg-base-200 mt-3 rounded-xl border border-dashed border-base-content/20 p-3 text-center">
              <p className="font-mono text-[28px] font-bold tracking-[0.2em] tabular-nums select-all">{pairCode}</p>
              <p className="mt-1 text-xs tabular-nums opacity-60">Expires in {formatCountdown(pairLeft)}</p>
              <progress className="progress progress-primary mt-2 h-1 w-full" value={pairLeft} max={webConfig.pairTtlSeconds} />
              <div className="mt-2 flex items-center justify-center gap-2">
                <button className="btn btn-outline btn-xs gap-1" onClick={onCopy}>
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button className="btn btn-outline btn-xs" onClick={onGenerate} disabled={pairLoading}>
                  New code
                </button>
              </div>
              <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] opacity-60">
                <span className="loading loading-bars loading-xs" />
                Waiting for your platform…
              </p>
            </div>
          ) : (
            <button className="btn btn-primary btn-sm mt-3 w-full" onClick={onGenerate} disabled={pairLoading}>
              {pairLoading && <span className="loading loading-spinner loading-xs" />}
              {pairLoading ? "Creating…" : "Generate code"}
            </button>
          )}
          <button className="btn btn-outline btn-sm mt-2 w-full gap-1.5" onClick={onClaimOpen}>
            <Link2 size={14} />
            I have a code
          </button>
        </div>
      ) : (
        <div className="bg-base-100 rounded-2xl p-4 shadow-sm border border-base-300">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            {platform && <PlatformIcon platform={platform} size={13} />}
            {platform ? `${platform.label} linked` : "Linked"}
          </h2>
          <p className="mt-1 text-[13px] opacity-65">
            {messageCount} message{messageCount === 1 ? "" : "s"} in this room.
          </p>
          {/* Mirrors bot /status numbers. */}
          <dl className="mt-3 space-y-1.5 text-[13px]">
            <div className="flex justify-between gap-2">
              <dt className="opacity-60">Account</dt>
              <dd className="max-w-[60%] truncate font-medium" title={accountName ?? undefined}>
                {accountName ? `@${accountName}` : "-"}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="opacity-60">User ID</dt>
              <dd className="max-w-[60%] truncate font-mono text-xs tabular-nums" title={accountId ?? undefined}>
                {accountId ?? "-"}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="opacity-60">Since</dt>
              <dd className="font-medium">{formatLinkedSince(stats?.createdAt ?? connectionCreatedAt)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="opacity-60">Total</dt>
              <dd className="font-medium tabular-nums">{stats?.stats.total ?? messageCount}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="opacity-60">From web</dt>
              <dd className="font-medium tabular-nums">{stats?.stats.fromWeb ?? "-"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="opacity-60">From {platform?.label ?? "platform"}</dt>
              <dd className="font-medium tabular-nums">
                {platform?.id === "discord"
                  ? (stats?.stats.fromDiscord ?? "-")
                  : platform?.id === "whatsapp"
                    ? (stats?.stats.fromWhatsapp ?? "-")
                    : (stats?.stats.fromTelegram ?? "-")}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="opacity-60">Last activity</dt>
              <dd className="font-medium">{formatLastActivity(stats?.stats.lastMessageAt ?? null)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[11px] opacity-55">
            Right-click or long-press one of your messages to delete it on both sides.
          </p>
          <button className="btn btn-outline btn-sm border-error/25 text-error mt-2 w-full gap-1.5" onClick={onDisconnect}>
            <WifiOff size={14} />
            Disconnect
          </button>
        </div>
      )}

      <p className="px-1 text-[11px] leading-relaxed opacity-50">
        Text, photos, video, documents and voice notes up to {FILE_LIMIT_LABEL} sync both ways.
      </p>
    </div>
  );
}
