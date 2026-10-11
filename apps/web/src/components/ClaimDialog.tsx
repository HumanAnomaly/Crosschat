import { useEffect, useRef } from "react";
import { Link2, X } from "lucide-react";
import { webConfig } from "../config";
import { useLang } from "../i18n";

const PAIR_CODE_EXAMPLE = "AB12-CD34";
const PAIR_CODE_INPUT_MAX = 9;

interface Props {
  open: boolean;
  input: string;
  setInput: (v: string) => void;
  loading: boolean;
  error: string;
  onClose: () => void;
  onSubmit: () => void;
}

export default function ClaimDialog({ open, input, setInput, loading, error, onClose, onSubmit }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useLang();
  const ttl = t("common.minutes", { n: Math.round(webConfig.pairTtlSeconds / 60) });

  useEffect(() => {
    if (open) ref.current?.showModal();
    else if (ref.current?.open) ref.current.close();
  }, [open]);

  return (
    <dialog ref={ref} className="modal modal-bottom sm:modal-middle" onClose={onClose}>
      <div className="modal-box bg-base-100 text-base-content">
        <h3 className="text-lg font-bold">{t("claim.title")}</h3>
        <p className="py-2 text-sm opacity-70">{t("claim.sub", { ex: PAIR_CODE_EXAMPLE, ttl })}</p>
        {error && (
          <div role="alert" className="alert alert-error mb-2 text-sm">
            <X size={16} />
            <span>{error}</span>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <label className="input input-bordered flex w-full items-center gap-2 bg-base-200 uppercase focus-within:border-primary/50 focus-within:bg-base-100">
            <Link2 size={15} className="shrink-0 opacity-60" />
            <input
              className="grow bg-transparent uppercase placeholder:text-base-content/40"
              placeholder={PAIR_CODE_EXAMPLE}
              aria-label={t("claim.label")}
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              maxLength={PAIR_CODE_INPUT_MAX}
              autoFocus
            />
          </label>
          <div className="modal-action">
            <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={loading}>
              {loading && <span className="loading loading-spinner loading-xs" />}
              {loading ? t("claim.checking") : t("claim.connect")}
            </button>
          </div>
        </form>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button>{t("common.closeDialog")}</button>
      </form>
    </dialog>
  );
}
