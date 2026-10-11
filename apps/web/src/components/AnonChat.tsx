import { useEffect, useRef } from "react";
import { Send, SkipForward, Square } from "lucide-react";
import type { ChatMessage } from "@crosschat/core";
import { useLang } from "../i18n";
import type { AnonSession } from "../api";
import MessageList from "./MessageList";

interface Props {
  session: AnonSession;
  partnerLabel: string;
  messages: ChatMessage[];
  draft: string;
  setDraft: (v: string) => void;
  sending: boolean;
  error: string;
  onSend: () => void;
  onNext: () => void;
  onStop: () => void;
  isMine: (m: ChatMessage) => boolean;
}

export default function AnonChat({ session, partnerLabel, messages, draft, setDraft, sending, error, onSend, onNext, onStop, isMine }: Props) {
  const { t } = useLang();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, session.id]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-base-content/10 px-4 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{t("anon.partner", { partner: partnerLabel })}</p>
          <p className="font-mono text-[11px] opacity-55">{t("anon.session", { id: session.id })}</p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-xs gap-1"
          onClick={onNext}
          aria-label={t("anon.next")}
          title={t("anon.next")}
        >
          <SkipForward size={14} />
          <span className="hidden sm:inline">{t("anon.next")}</span>
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-xs gap-1 text-error"
          onClick={onStop}
          aria-label={t("anon.stop")}
          title={t("anon.stop")}
        >
          <Square size={14} />
          <span className="hidden sm:inline">{t("anon.stop")}</span>
        </button>
      </div>

      <MessageList
        messages={messages}
        scrollRef={scrollRef}
        onScroll={handleScroll}
        isMine={isMine}
      />

      {error && (
        <p role="alert" className="text-error flex shrink-0 items-center gap-1.5 border-t border-base-content/10 px-4 pt-2 text-[13px]">
          {error}
        </p>
      )}

      <footer className="shrink-0 border-t border-base-content/10 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <form
          className="flex min-w-0 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onSend();
          }}
        >
          <input
            className="input input-bordered min-h-[44px] w-full min-w-0 flex-1 rounded-full"
            placeholder={t("composer.writePh")}
            aria-label={t("composer.writeLabel")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={4000}
          />
          <button
            type="submit"
            className="btn btn-primary btn-circle shrink-0"
            disabled={sending || !draft.trim()}
            aria-label={t("composer.send")}
            title={t("composer.sendTitle")}
          >
            {sending ? <span className="loading loading-spinner loading-sm" /> : <Send size={18} />}
          </button>
        </form>
        <p className="px-1 pt-1.5 text-[11px] opacity-50">{t("anon.hint")}</p>
      </footer>
    </div>
  );
}
