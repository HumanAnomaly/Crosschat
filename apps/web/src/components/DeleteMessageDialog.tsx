import { useEffect, useRef } from "react";
import { Trash2 } from "lucide-react";
import type { ChatMessage } from "@crosschat/core";

interface Props {
  message: ChatMessage | null;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

function previewText(m: ChatMessage): string {
  if (m.text) return m.text.length > 120 ? `${m.text.slice(0, 120)}…` : m.text;
  const kind = m.kind === "photo" ? "photo" : m.kind === "video" ? "video" : m.kind === "voice" ? "voice note" : m.kind === "sticker" ? "sticker" : "document";
  return `(${kind} attachment)`;
}

export default function DeleteMessageDialog({ message, deleting, onClose, onConfirm }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (message) ref.current?.showModal();
    else if (ref.current?.open) ref.current.close();
  }, [message]);

  return (
    <dialog ref={ref} className="modal modal-bottom sm:modal-middle" aria-label="Delete message" onClose={onClose}>
      <div className="modal-box bg-base-100 text-base-content">
        <h3 className="flex items-center gap-2 text-lg font-bold">
          <Trash2 size={18} className="text-error" />
          Delete this message?
        </h3>
        {message && (
          <p className="bg-base-200 mt-3 max-h-24 overflow-y-auto rounded-xl px-3 py-2 text-sm break-words opacity-80">
            {previewText(message)}
          </p>
        )}
        <p className="mt-2 text-sm opacity-70">
          It will be removed here and on your linked platform, including its file if it has one.
        </p>
        <div className="modal-action">
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose} disabled={deleting}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-error btn-sm"
            onClick={onConfirm}
            disabled={deleting}
            autoFocus
          >
            {deleting && <span className="loading loading-spinner loading-xs" />}
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  );
}
