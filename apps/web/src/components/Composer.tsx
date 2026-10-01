import { useRef } from "react";
import { Paperclip, Send } from "lucide-react";
import { webConfig } from "../config";
import { FILE_LIMIT_LABEL } from "../format";

interface Props {
  draft: string;
  setDraft: (v: string) => void;
  sending: boolean;
  uploading: boolean;
  onSend: () => void;
  onFile: (f: File | undefined) => void;
}

const ACCEPTED_FILES = "image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip";

export default function Composer({ draft, setDraft, sending, uploading, onSend, onFile }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <footer className="shrink-0 border-t border-base-content/10 p-3">
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        aria-label="Attach a file"
        accept={ACCEPTED_FILES}
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
      >
        <button
          type="button"
          className="btn btn-ghost btn-circle shrink-0"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || sending}
          aria-label={`Attach a file (max ${FILE_LIMIT_LABEL})`}
          title={`Attach a file (max ${FILE_LIMIT_LABEL})`}
        >
          {uploading ? <span className="loading loading-spinner loading-sm" /> : <Paperclip size={18} />}
        </button>
        <input
          className="input input-bordered min-h-[44px] flex-1 rounded-full"
          placeholder="Write a message…"
          aria-label="Write a message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={webConfig.messageMaxLength}
        />
        <button
          type="submit"
          className="btn btn-primary btn-circle shrink-0"
          disabled={sending || !draft.trim()}
          aria-label="Send message"
          title="Send"
        >
          {sending ? <span className="loading loading-spinner loading-sm" /> : <Send size={18} />}
        </button>
      </form>
      <div className="flex items-center justify-between px-1 pt-1.5 text-[11px] opacity-50">
        <span>
          Media up to {FILE_LIMIT_LABEL} · Enter to send · Right-click or long-press your message to delete it
        </span>
        {draft.length > webConfig.messageMaxLength - 500 && (
          <span className="tabular-nums">
            {draft.length}/{webConfig.messageMaxLength}
          </span>
        )}
      </div>
    </footer>
  );
}
