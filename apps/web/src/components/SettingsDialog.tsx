import { useEffect, useRef } from "react";
import { Moon, Sun } from "lucide-react";
import { useLang } from "../i18n";
import { useTheme } from "../theme";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function SettingsDialog({ open, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t, lang, setLang } = useLang();
  const { theme, toggle } = useTheme();
  const dark = theme === "crosschat-dark";

  useEffect(() => {
    if (open) ref.current?.showModal();
    else if (ref.current?.open) ref.current.close();
  }, [open]);

  return (
    <dialog ref={ref} className="modal modal-bottom sm:modal-middle" onClose={onClose} aria-label={t("settings.title")}>
      <div className="modal-box bg-base-100 text-base-content max-w-xs">
        <h3 className="text-lg font-bold">{t("settings.title")}</h3>

        <p className="mt-4 text-sm font-semibold">{t("settings.theme")}</p>
        <div className="join mt-1.5 w-full" role="group" aria-label={t("settings.theme")}>
          <button
            type="button"
            className={`btn btn-sm join-item flex-1 gap-1.5 ${dark ? "" : "btn-active"}`}
            aria-pressed={!dark}
            onClick={() => dark && toggle()}
          >
            <Sun size={14} />
            {t("settings.light")}
          </button>
          <button
            type="button"
            className={`btn btn-sm join-item flex-1 gap-1.5 ${dark ? "btn-active" : ""}`}
            aria-pressed={dark}
            onClick={() => !dark && toggle()}
          >
            <Moon size={14} />
            {t("settings.dark")}
          </button>
        </div>

        <p className="mt-4 text-sm font-semibold">{t("settings.language")}</p>
        <div className="join mt-1.5 w-full" role="group" aria-label={t("settings.language")}>
          <button
            type="button"
            className={`btn btn-sm join-item flex-1 ${lang === "id" ? "" : "btn-active"}`}
            aria-pressed={lang !== "id"}
            onClick={() => setLang("en")}
          >
            {t("settings.english")}
          </button>
          <button
            type="button"
            className={`btn btn-sm join-item flex-1 ${lang === "id" ? "btn-active" : ""}`}
            aria-pressed={lang === "id"}
            onClick={() => setLang("id")}
          >
            {t("settings.indonesian")}
          </button>
        </div>

        <div className="modal-action">
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button>{t("common.closeDialog")}</button>
      </form>
    </dialog>
  );
}
