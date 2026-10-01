import { memo, useRef } from "react";
import { findPlatform, PLATFORMS, type ChatMessage } from "@crosschat/core";
import { mediaUrl } from "../api";
import { formatTime } from "../format";

function senderLabel(sender: ChatMessage["sender"]): string {
  if (sender === "web") return "You";
  return findPlatform(sender, PLATFORMS)?.label ?? sender;
}

function fileLabel(m: ChatMessage): string {
  const size = typeof m.size === "number" ? ` · ${(m.size / 1024).toFixed(m.size < 10240 ? 1 : 0)} KB` : "";
  return `Open document${size}`;
}

function BubbleContent({ m, mine }: { m: ChatMessage; mine: boolean }) {
  const linkCls = mine ? "text-white underline underline-offset-2" : "link";
  const label = m.kind === "photo" ? `Photo message${m.text ? `: ${m.text.slice(0, 80)}` : ""}` : undefined;
  return (
    <div className="min-w-0">
      {!mine && (
        <span className="mb-1 block text-[11px] font-semibold tracking-wide uppercase opacity-60">
          {senderLabel(m.sender)}
        </span>
      )}
      {m.kind === "photo" && m.mediaPath && (
        <img
          src={mediaUrl(m)}
          alt={label ?? "Photo"}
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
          {fileLabel(m)}
        </a>
      )}
      {m.kind === "sticker" && m.mediaPath && (
        <img src={mediaUrl(m)} alt="Sticker" className="mb-1 block w-24 object-contain" loading="lazy" />
      )}
      {m.kind === "sticker" && !m.mediaPath && m.text && (
        <p className="text-2xl leading-relaxed">{m.text}</p>
      )}
      {!(m.kind === "sticker" && !m.mediaPath) && m.text && (
        <p className="whitespace-pre-wrap break-words text-[14.5px] leading-relaxed">{m.text}</p>
      )}
      <span className={`mt-1 block text-right text-[11px] leading-none tabular-nums ${mine ? "text-white/70" : "opacity-50"}`}>
        {formatTime(m.createdAt)}
      </span>
    </div>
  );
}

const LONG_PRESS_MS = 550;

export const MessageBubble = memo(function MessageBubble({
  m,
  onDelete,
  deleting,
}: {
  m: ChatMessage;
  onDelete?: (m: ChatMessage) => void;
  deleting?: boolean;
}) {
  const mine = m.sender === "web";

  const canAct = mine && !!onDelete && !deleting;
  const pressTimer = useRef<number | null>(null);
  const longFired = useRef(false);

  function clearPress(): void {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  return (
    <div className={`flex w-full ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[82%] px-3.5 py-2.5 break-words sm:max-w-[68%] ${
          mine
            ? "chat-bubble-primary rounded-2xl rounded-br-md"
            : "bg-base-200 rounded-2xl rounded-bl-md shadow-sm ring-1 ring-base-content/5"
        } ${canAct ? "cursor-context-menu" : ""}`}
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
        <BubbleContent m={m} mine={mine} />
      </div>
    </div>
  );
});
