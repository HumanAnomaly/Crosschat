import { useEffect, useRef } from "react";
import { LogOut } from "lucide-react";
import { useLang } from "../i18n";
import UserAvatar from "./UserAvatar";
import type { SessionUser } from "../api";

interface Props {
  open: boolean;
  me: SessionUser;
  displayName: string;
  status: string;
  onClose: () => void;
  onLogout: () => void;
}

export default function ProfileDialog({ open, me, displayName, status, onClose, onLogout }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useLang();

  useEffect(() => {
    if (open) ref.current?.showModal();
    else if (ref.current?.open) ref.current.close();
  }, [open ]);

  return (
    <dialog ref={ref} className="modal modal-bottom sm:modal-middle" onClose={onClose} aria-label={t("profile.title")}>
      <div className="modal-box bg-base-100 text-base-content max-w-xs text-center">
        <div className="mx-auto w-fit">
          <UserAvatar user={me} size="lg" />
        </div>
        <h3 className="mt-3 truncate text-lg font-bold">{displayName}</h3>
        <p className="truncate text-sm opacity-60">{me.email}</p>
        <p className="mt-1 text-[13px] opacity-60">{status}</p>
        <button type="button" className="btn btn-outline btn-sm border-error/25 text-error mt-4 w-full gap-1.5" onClick={onLogout}>
          <LogOut size={14} />
          {t("panel.signOut")}
        </button>
        <div className="modal-action justify-center">
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
