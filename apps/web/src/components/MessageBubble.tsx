import { memo, useEffect, useRef } from "react";
import { RotateCcw } from "lucide-react";
import { findPlatform, PLATFORMS, type ChatMessage } from "@crosschat/core";
import { mediaUrl } from "../api";
import { useLang, type Lang, type T } from "../i18n";
import { formatTime } from "../format";

function senderLabel(sender: ChatMessage["sender"], t: T): string {
  if (sender === "web") return t("bubble.you");
  return findPlatform(sender, PLATFORMS)?.label ?? sender;
}

function fileLabel(m: ChatMessage, t: T): string {
  const size = typeof m.size === "number" ? ` · ${(m.size / 1024).toFixed(m.size < 10240 ? 1 : 0)} KB` : "";
  return `${t("bubble.openDoc")}${size}`;
}

function BubbleContent({ m, mine, tick, lang, t }: { m: ChatMessage; mine: boolean; tick?: string | null; lang: Lang; t: T }) {
  const linkCls = mine ? "text-white underline underline-offset-2" : "link";
  const label = m.kind === "photo" ? `${t("bubble.photoMsg")}${m.text ? `: ${m.text.slice(0, 80)}` : ""}` : undefined;
  return (
    <div className="min-w-0">
      {!mine && (
        <span className="mb-1 block text-[11px] font-semibold tracking-wide uppercase opacity-60">
          {senderLabel(m.sender, t)}
        </span>
      )}
      {m.kind === "photo" && m.mediaPath && (
        <img
          src={mediaUrl(m)}
          alt={label ?? t("bubble.photo")}
          className="mb-1.5 block w-full max-w-[260px] rounded-lg object-cover"
          loading="lazy"
        />
      )}
      {m.kind === "video" && m.mediaPath && (
        <video src={mediaUrl(m)} controls preload="metadata" className="mb-1.5 block w-full max-w-[260px] rounded-lg" />
      )}
      {m.kind === "voice" && m.mediaPath && <audio src={mediaUrl(m)} controls preload="none" className="mb-1.5 block w-56 max-w-full" />}
      {m.kind === "document" && m.mediaPath && (
        <a href={mediaUrl(m)} target="_blank" rel="noreferrer" className={`${linkCls} mb-1.5 block text-sm font-medium`}>
          {fileLabel(m, t)}
        </a>
      )}
      {m.kind === "sticker" && m.mediaPath && (
        <img src={mediaUrl(m)} alt={t("bubble.sticker")} className="mb-1 block w-24 object-contain" loading="lazy" />
      )}
      {m.kind === "sticker" && !m.mediaPath && m.text && (
        <p className="text-2xl leading-relaxed">{m.text}</p>
      )}
      {!(m.kind === "sticker" && !m.mediaPath) && m.text && (
        <p className="whitespace-pre-wrap break-words text-[14.5px] leading-relaxed">{m.text}</p>
      )}
      <span className={`mt-1 block text-right text-[11px] leading-none tabular-nums ${mine ? "text-white/70" : "opacity-50"}`}>
        {formatTime(m.createdAt, lang)}
        {tick}
      </span>
    </div>
  );
}

const LONG_PRESS_MS = 550;

export const MessageBubble = memo(function MessageBubble({
  m,
  onDelete,
  deleting,
  failed,
  pending,
  delivered,
  onRetry,
  mine: mineProp,
}: {
  m: ChatMessage;
  onDelete?: (m: ChatMessage) => void;
  deleting?: boolean;
  failed?: boolean;
  pending?: boolean;
  delivered?: boolean;
  onRetry?: (m: ChatMessage) => void;
  /** Override owner detection (default: sender === "web"). */
  mine?: boolean;
}) {
  const mine = mineProp ?? m.sender === "web";
  const { t, lang } = useLang();

  const canAct = mine && !!onDelete && !deleting && !pending;
  const pressTimer = useRef<number | null>(null);
  const longFired = useRef(false);

  function clearPress(): void {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  useEffect(() => clearPress, []);

  return (
    <div className={`msg-enter flex w-full ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[82%] px-3.5 py-2.5 break-words sm:max-w-[68%] ${
          mine
            ? "chat-bubble-primary rounded-2xl rounded-br-md"
            : "bg-base-200 rounded-2xl rounded-bl-md shadow-sm ring-1 ring-base-content/5"
        } ${canAct ? "cursor-context-menu" : ""} ${failed ? "ring-1 ring-error/70" : ""}`}
        onContextMenu={
          canAct
            ? (e) => {
                e.preventDefault();
                if (longFired.current) {
                  longFired.current = false;
                  return;
                }
                onDelete?.(m);
              }
            : undefined
        }
        onTouchStart={
          canAct
            ? () => {
                longFired.current = false;
                clearPress();
                pressTimer.current = window.setTimeout(() => {
                  longFired.current = true;
                  pressTimer.current = null;
                  onDelete?.(m);
                }, LONG_PRESS_MS);
              }
            : undefined
        }
        onTouchEnd={canAct ? clearPress : undefined}
        onTouchMove={canAct ? clearPress : undefined}
        onTouchCancel={canAct ? clearPress : undefined}
      >
        <BubbleContent m={m} mine={mine} lang={lang} t={t} tick={mine && !failed && !pending ? (delivered ? " ✓✓" : " ✓") : null} />
        {failed && (
          <button
            type="button"
            className="btn btn-xs btn-error btn-outline mt-1.5"
            aria-label={t("bubble.retryAria", { id: m.id, text: m.text?.slice(0, 40) ?? "message" })}
            onTouchStart={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
            onClick={() => onRetry?.(m)}
          >
            <RotateCcw size={12} />
            {t("bubble.retry")}
          </button>
        )}
      </div>
    </div>
  );
});
