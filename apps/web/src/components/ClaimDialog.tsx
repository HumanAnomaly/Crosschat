import { useEffect, useRef } from "react";
import { Link2, X } from "lucide-react";
import { PAIR_TTL_LABEL } from "../format";

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

  useEffect(() => {
    if (open) ref.current?.showModal();
    else if (ref.current?.open) ref.current.close();
  }, [open]);

  return (
    <dialog ref={ref} className="modal modal-bottom sm:modal-middle" onClose={onClose}>
      <div className="modal-box bg-base-100 text-base-content">
        <h3 className="text-lg font-bold">Enter pairing code</h3>
        <p className="py-2 text-sm opacity-70">It looks like {PAIR_CODE_EXAMPLE}. Codes are valid for {PAIR_TTL_LABEL}.</p>
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
              aria-label="Pairing code"
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              maxLength={PAIR_CODE_INPUT_MAX}
              autoFocus
            />
          </label>
          <div className="modal-action">
            <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={loading}>
              {loading && <span className="loading loading-spinner loading-xs" />}
              {loading ? "Checking…" : "Connect"}
            </button>
          </div>
        </form>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  );
}
