import { useRef } from "react";
import { ArrowRight, Star, Timer, Upload, Users, X } from "lucide-react";
import { getLoginUrl } from "../api";
import { useSession } from "../auth/session";
import { useNavigate } from "../router";
import BrandIcon from "../components/BrandIcon";

const LIMITS = [
  { icon: Timer, label: "5-minute code" },
  { icon: Users, label: "Private 1:1 room" },
  { icon: Upload, label: "Media up to 20MB" },
] as const;

export default function LandingPage() {
  const { me, authLoading } = useSession();
  const go = useNavigate();
  const howRef = useRef<HTMLDialogElement>(null);

  return (
    <div className="bg-base-200 text-base-content flex min-h-screen flex-col">
      <main className="mx-auto flex w-full max-w-5xl flex-1 items-center justify-center p-4 sm:p-6">
        <div className="hero bg-base-100 border border-base-300 w-full rounded-2xl shadow-sm">
          <div className="hero-content w-full flex-col gap-8 px-6 py-8 sm:px-10 sm:py-10 lg:flex-row lg:items-center lg:gap-12">
            <div className="order-1 w-full max-w-lg lg:flex-1">
              <span className="bg-primary/10 text-primary inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold">
                <BrandIcon size={14} />
                Private 1:1 bridge
              </span>
              <h1 className="mt-3 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
                Welcome to <span className="text-primary">Crosschat</span>
              </h1>
              <p className="mt-4 max-w-md text-base leading-relaxed opacity-70">
                CrossChat connects you with people on other platforms without 
                requiring you to use their apps. 
                Pair once, then chat from your browser.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-2">
                {authLoading ? (
                  <span className="skeleton h-9 w-36" />
                ) : me ? (
                  <button className="btn btn-primary btn-sm gap-1.5 px-4" onClick={() => go("/chat")}>
                    Open chat
                    <ArrowRight size={14} />
                  </button>
                ) : (
                  <a className="btn btn-primary btn-sm px-4" href={getLoginUrl()}>
                    Sign in with Google
                  </a>
                )}
                <button
                  className="btn btn-outline btn-sm px-3"
                  onClick={() => howRef.current?.showModal()}
                >
                  See how linking works
                </button>
                <a
                  className="btn btn-outline btn-sm gap-1.5 px-3"
                  href="https://github.com/HumanAnomaly/Crosschat"
                  target="_blank"
                  rel="noreferrer"
                >
                  <Star size={14} />
                  Source code
                </a>
              </div>

            </div>

            <div className="order-2 w-full max-w-md lg:flex-1" aria-label="Cross Chat">
              <div className="card bg-base-200 border border-base-300 shadow-none">
                <div className="card-body gap-1 p-4 sm:p-5">
                  <p className="text-xs font-semibold uppercase tracking-wider opacity-50">
                    Cross Chat
                  </p>
                  <div className="chat chat-end">
                    <div className="chat-header mb-1 text-xs opacity-60">You on the web</div>
                    <div className="chat-bubble chat-bubble-primary font-mono text-sm tracking-widest">
                      AB12-CD34
                    </div>
                    <div className="chat-footer mt-1 text-xs opacity-60">One-time code, valid 5 minutes</div>
                  </div>
                  <div className="chat chat-start">
                    <div className="chat-header mb-1 text-xs opacity-60">Telegram bot</div>
                    <div className="chat-bubble text-sm">Linked. Say hi from either side.</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <dialog ref={howRef} className="modal modal-bottom sm:modal-middle">
        <div className="modal-box bg-base-100 text-base-content border border-base-300">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold">Link in two steps</h3>
              <p className="mt-1 text-sm opacity-70">From landing to chat in under a minute.</p>
            </div>
            <form method="dialog">
              <button className="btn btn-ghost btn-sm btn-circle" aria-label="Close">
                <X size={15} />
              </button>
            </form>
          </div>
          <ol className="mt-4 space-y-3 text-sm">
            <li className="flex gap-3">
              <span className="badge badge-primary badge-sm mt-0.5 shrink-0">1</span>
              <span>
                <span className="block font-semibold">Get a one-time code</span>
                <span className="mt-0.5 block opacity-70">
                  Open <span className="font-mono text-xs">/chat</span> and generate one, or ask the
                  bot for one.
                </span>
              </span>
            </li>
            <li className="flex gap-3">
              <span className="badge badge-primary badge-sm mt-0.5 shrink-0">2</span>
              <span>
                <span className="block font-semibold">Confirm on the other side</span>
                <span className="mt-0.5 block opacity-70">
                  Type it into Telegram or the web. Both sides open at once.
                </span>
              </span>
            </li>
          </ol>
          <div className="modal-action">
            <form method="dialog" className="flex gap-2">
              <button className="btn btn-outline btn-sm">Close</button>
              {me ? (
                <button className="btn btn-primary btn-sm gap-1.5" onClick={() => go("/chat")}>
                  Open /chat
                  <ArrowRight size={14} />
                </button>
              ) : (
                <a className="btn btn-primary btn-sm" href={getLoginUrl()}>
                  Sign in first
                </a>
              )}
            </form>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </div>
  );
}
