import { useEffect, useRef } from "react";
import { ExternalLink, X } from "lucide-react";
import type { Platform } from "@crosschat/core";
import { useLang } from "../i18n";
import PlatformIcon from "./PlatformIcon";

interface Props {
  platform: Platform | null;
  onClose: () => void;
  /** Opens the code entry dialog after the tips are read. */
  onClaim: () => void;
}

export default function PlatformTipsDialog({ platform, onClose, onClaim }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useLang();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (platform && !el.open) el.showModal();
    else if (!platform && el.open) el.close();
  }, [platform]);

  return (
    <dialog
      ref={ref}
      className="modal modal-bottom sm:modal-middle"
      onClose={onClose}
      aria-label={platform ? t("tips.linkTitle", { label: platform.label }) : t("tips.aria")}
    >
      {platform && (
        <div className="modal-box bg-base-100 text-base-content max-w-md">
          <div className="flex items-start gap-3">
            <PlatformIcon platform={platform} size={22} />
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-bold">{t("tips.linkTitle", { label: platform.label })}</h3>
              <p className="mt-0.5 text-sm opacity-70">{platform.note}</p>
            </div>
            <button className="btn btn-ghost btn-sm btn-circle" onClick={onClose} aria-label={t("common.close")}>
              <X size={16} />
            </button>
          </div>

          <ol className="mt-4 space-y-2.5 text-sm">
            {platform.steps.map((step, i) => (
              <li key={step} className="flex gap-3">
                <span className="badge badge-primary badge-sm mt-0.5 shrink-0">{i + 1}</span>
                <span className="opacity-90">{step}</span>
              </li>
            ))}
          </ol>

          <div className="modal-action flex-wrap gap-2">
            <a
              className="btn btn-primary btn-sm gap-1.5"
              href={platform.entryUrl}
              target="_blank"
              rel="noreferrer"
            >
              {platform.entryLabel}
              <ExternalLink size={14} />
            </a>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => {
                onClose();
                onClaim();
              }}
            >
              {t("panel.enterCode")}
            </button>
          </div>
        </div>
      )}
      <form method="dialog" className="modal-backdrop">
        <button>{t("common.closeDialog")}</button>
      </form>
    </dialog>
  );
}
