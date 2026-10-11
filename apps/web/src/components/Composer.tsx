import { useRef } from "react";
import { Paperclip, Send, X } from "lucide-react";
import { webConfig } from "../config";
import { useLang } from "../i18n";
import { FILE_LIMIT_LABEL } from "../format";

interface Props {
  draft: string;
  setDraft: (v: string) => void;
  sending: boolean;
  uploading: boolean;
  uploadProgress?: number | null;
  onSend: () => void;
  onFile: (f: File | undefined) => void;
  onCancelUpload?: () => void;
}

const ACCEPTED_FILES = "image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip";

export default function Composer({ draft, setDraft, sending, uploading, uploadProgress = null, onSend, onFile, onCancelUpload }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { t } = useLang();
  return (
    <footer className="shrink-0 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        aria-label={t("composer.attach")}
        accept={ACCEPTED_FILES}
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      {uploading && (
        <div className="mb-2 flex items-center gap-2" role="status" aria-label={t("composer.uploading")}>
          <progress
            className="progress progress-primary h-1.5 flex-1"
            value={uploadProgress == null ? undefined : Math.round(uploadProgress * 100)}
            max={100}
          />
          <span className="w-9 text-right text-[11px] tabular-nums opacity-60">
            {uploadProgress == null ? "…" : `${Math.round(uploadProgress * 100)}%`}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-xs btn-circle"
            onClick={() => onCancelUpload?.()}
            aria-label={t("composer.cancelUpload")}
            title={t("composer.cancelUpload")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <form
        className="flex min-w-0 items-center gap-2"
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
          aria-label={t("composer.attachMax", { limit: FILE_LIMIT_LABEL })}
          title={t("composer.attachMax", { limit: FILE_LIMIT_LABEL })}
        >
          {uploading ? <span className="loading loading-spinner loading-sm" /> : <Paperclip size={18} />}
        </button>
        <input
          className="input input-bordered min-h-[44px] w-full min-w-0 flex-1 rounded-full"
          placeholder={t("composer.writePh")}
          aria-label={t("composer.writeLabel")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={webConfig.messageMaxLength}
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
      <div className="hidden items-center justify-between px-1 pt-1.5 text-[11px] opacity-50 sm:flex">
        <span>
          {t("composer.hint", { limit: FILE_LIMIT_LABEL })}
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
