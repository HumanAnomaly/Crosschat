import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { disablePush, enablePush, pushStatus, pushSupported } from "../push";
import { useLang } from "../i18n";
import { getPushConfig } from "../api";

type State = "hidden" | "off" | "on" | "busy" | "blocked";

export default function PushToggle() {
  const [state, setState] = useState<State>("hidden");
  const { t } = useLang();

  useEffect(() => {
    if (!pushSupported()) return;
    let live = true;
    void (async () => {
      try {
        const cfg = await getPushConfig().catch(() => null);
        if (!live) return;
        // Server push unconfigured: hide the toggle entirely.
        if (cfg && !cfg.enabled) return;
        if (Notification.permission === "denied") {
          setState("blocked");
          return;
        }
        setState((await pushStatus()) ? "on" : "off");
      } catch {
        if (live) setState("off");
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  if (state === "hidden") return null;

  async function toggle() {
    if (state === "busy" || state === "blocked") return;
    const was = state;
    setState("busy");
    try {
      if (was === "on") {
        await disablePush();
        setState("off");
      } else {
        setState((await enablePush()) ? "on" : Notification.permission === "denied" ? "blocked" : "off");
      }
    } catch {
      setState(was === "on" ? "on" : "off");
    }
  }

  const on = state === "on";
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm btn-circle"
      onClick={() => void toggle()}
      disabled={state === "busy" || state === "blocked"}
      aria-pressed={on}
      aria-label={on ? t("push.disable") : t("push.enable")}
      title={
        state === "blocked"
          ? t("push.blocked")
          : on
            ? t("push.onTitle")
            : t("push.offTitle")
      }
    >
      {on ? <Bell size={16} /> : <BellOff size={16} className={state === "blocked" ? "opacity-40" : ""} />}
    </button>
  );
}
