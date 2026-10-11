import { useMemo, type RefObject } from "react";
import { MessageCircle } from "lucide-react";
import type { ChatMessage } from "@crosschat/core";
import { useLang, type Lang, type T } from "../i18n";
import { MessageBubble } from "./MessageBubble";

function dayKey(iso: string): string {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? iso : new Date(t).toDateString();
}

function formatDay(iso: string, lang: Lang, t: T): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return t("list.today");
  if (d.toDateString() === yesterday.toDateString()) return t("list.yesterday");
  return d.toLocaleDateString(lang === "id" ? "id-ID" : "en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface Props {
  messages: ChatMessage[];
  scrollRef: RefObject<HTMLDivElement>;
  onScroll: () => void;
  onDelete?: (m: ChatMessage) => void;
  deletingId?: string | null;
  failedIds?: ReadonlySet<string>;
  pendingIds?: ReadonlySet<string>;
  deliveredIds?: ReadonlySet<string>;
  onRetry?: (m: ChatMessage) => void;
  /** Override per-message owner detection (default: sender === "web"). */
  isMine?: (m: ChatMessage) => boolean;
}

export default function MessageList({ messages, scrollRef, onScroll, onDelete, deletingId, failedIds, pendingIds, deliveredIds, onRetry, isMine }: Props) {
  const { t, lang } = useLang();
  const grouped = useMemo(() => {
    const rows: { day: string; items: ChatMessage[] }[] = [];
    for (const m of messages) {
      const key = dayKey(m.createdAt);
      const last = rows[rows.length - 1];
      if (last && last.day === key) last.items.push(m);
      else rows.push({ day: key, items: [m] });
    }
    return rows;
  }, [messages]);

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      role="log"
      aria-live="polite"
      aria-label={t("list.aria")}
      className="chat-scroll min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5"
    >
      {messages.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center py-10 text-center">
          <span className="bg-base-200 flex h-12 w-12 items-center justify-center rounded-full">
            <MessageCircle size={22} className="opacity-60" />
          </span>
          <p className="mt-3 font-semibold">{t("list.empty")}</p>
          <p className="mt-1 max-w-xs text-sm opacity-65">
            {t("list.emptySub")}
          </p>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-2xl">
          {grouped.map((g) => (
            <div key={g.day}>
              <div className="sticky top-0 z-[1] my-2 flex justify-center">
                <span className="bg-base-100/90 rounded-full px-3 py-1 text-[11px] font-medium shadow-sm ring-1 ring-base-content/10 backdrop-blur">
                  {formatDay(g.items[0].createdAt, lang, t)}
                </span>
              </div>
              <div className="space-y-1.5">
                {g.items.map((m) => (
                  <MessageBubble
                    key={m.id}
                    m={m}
                    onDelete={onDelete}
                    deleting={deletingId === m.id}
                    failed={failedIds?.has(m.id)}
                    pending={pendingIds?.has(m.id)}
                    delivered={deliveredIds?.has(m.id)}
                    onRetry={onRetry}
                    mine={isMine ? isMine(m) : undefined}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
