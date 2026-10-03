import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Menu,
  MessageCircle,
  MoreVertical,
  WifiOff,
  X,
  Check,
  Copy,
} from "lucide-react";
import {
  findPlatform,
  parsePairingCode,
  platformOrFallback,
  type ChatMessage,
  type Connection,
  type Platform,
} from "@crosschat/core";
import {
  ApiError,
  claimPairCode,
  deleteMessage,
  disconnect,
  generatePairCode,
  getConnection,
  getConnectionStats,
  getLoginUrl,
  uploadMedia,
  type ConnectionStats,
} from "../api";
import { connectSession, disconnectSocket, getSocket, joinChat, leaveChat, sendText } from "../socket";
import { usePlatforms } from "../platforms";
import { webConfig } from "../config";
import { FILE_LIMIT_LABEL, formatCountdown } from "../format";
import { useSession } from "../auth/session";
import { ThemeToggle } from "../theme";
import PlatformTipsDialog from "../components/PlatformTipsDialog";
import PlatformIcon from "../components/PlatformIcon";
import PlatformRail from "../components/PlatformRail";
import PairPanel from "../components/PairPanel";
import ClaimDialog from "../components/ClaimDialog";
import Composer from "../components/Composer";
import DeleteMessageDialog from "../components/DeleteMessageDialog";
import MessageList from "../components/MessageList";

type ChatStatus = "idle" | "loading" | "ready" | "error";

const DISCONNECT_CONFIRM = "Disconnect this chat? You can pair again any time.";

function errorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function appendUnique(prev: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  if (prev.some((m) => m.id === msg.id)) return prev;
  return [...prev, msg];
}

export default function ChatPage() {
  const { me, authLoading, logout } = useSession();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatStatus, setChatStatus] = useState<ChatStatus>("idle");
  const [chatError, setChatError] = useState("");

  const [pairCode, setPairCode] = useState("");
  const [pairExpiresAt, setPairExpiresAt] = useState("");
  const [pairLeft, setPairLeft] = useState(0);
  const [pairLoading, setPairLoading] = useState(false);
  const [pairError, setPairError] = useState("");
  const [copied, setCopied] = useState(false);

  const [claimOpen, setClaimOpen] = useState(false);
  const [claimInput, setClaimInput] = useState("");
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimError, setClaimError] = useState("");
  const [tipsPlatform, setTipsPlatform] = useState<Platform | null>(null);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sendError, setSendError] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ChatMessage | null>(null);
  const [stats, setStats] = useState<ConnectionStats | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const copyTimer = useRef<number | null>(null);
  const displayName = me?.name ?? me?.email ?? "Account";
  const connected = Boolean(connection);
  const platforms = usePlatforms();

  const activePlatform = useMemo(
    () => (connection ? platformOrFallback(connection.platformId ?? "telegram", platforms) : null),
    [connection, platforms],
  );
  const openTips = useCallback(
    (id: string) => setTipsPlatform(findPlatform(id, platforms) ?? platformOrFallback(id, platforms)),
    [platforms],
  );

  const loadConnection = useCallback(async () => {
    setChatStatus("loading");
    setChatError("");
    try {
      const state = await getConnection();
      setConnection(state.connection);
      setMessages(state.messages);
      setChatStatus("ready");
      stickRef.current = true;
    } catch (err) {
      setChatStatus("error");
      setChatError(errorText(err, "Could not load the conversation. Check your connection and try again."));
    }
  }, []);

  useEffect(() => {
    if (!me) {
      setChatStatus("idle");
      setConnection(null);
      setMessages([]);
      return;
    }
    void loadConnection();
  }, [me, loadConnection]);

  useEffect(() => {
    if (!me) return;
    connectSession(
      () => void loadConnection(),
      () => {
        setConnection((prev) => {
          if (prev) leaveChat(prev.id);
          return null;
        });
        setMessages([]);
      },
    );
    return () => {
      disconnectSocket();
    };
  }, [me, loadConnection]);

  const connectionId = connection?.id;

  useEffect(() => {
    if (!connectionId) {
      setStats(null);
      return;
    }
    let cancelled = false;
    void getConnectionStats(connectionId)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, messages.length]);

  useEffect(() => {
    if (!connectionId) return;
    joinChat(
      connectionId,
      (msg) => setMessages((prev) => appendUnique(prev, msg)),
      (payload) => setMessages((prev) => prev.filter((m) => m.id !== payload.id)),
    );
    return () => {
      leaveChat(connectionId);
    };
  }, [connectionId]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, connection, chatStatus]);

  useEffect(() => {
    if (!pairExpiresAt) return;
    const tick = () => {
      const left = Math.round((new Date(pairExpiresAt).getTime() - Date.now()) / 1000);
      setPairLeft(Math.max(0, left));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [pairExpiresAt]);

  useEffect(() => {
    return () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    };
  }, []);

  async function handleGenerate() {
    setPairLoading(true);
    setPairError("");
    setCopied(false);
    try {
      const res = await generatePairCode();
      setPairCode(res.code);
      setPairExpiresAt(res.expiresAt);
      setPairLeft(webConfig.pairTtlSeconds);
    } catch (err) {
      setPairError(errorText(err, "Could not create a code. Try again."));
    } finally {
      setPairLoading(false);
    }
  }

  async function handleCopy() {
    if (!pairCode) return;
    try {
      await navigator.clipboard.writeText(pairCode);
      setCopied(true);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setPairError("Copy failed. Select the code manually.");
    }
  }

  async function handleClaim() {
    const code = parsePairingCode(claimInput);
    if (!code) {
      setClaimError("That code looks short. It should look like AB12-CD34.");
      return;
    }
    setClaimLoading(true);
    setClaimError("");
    try {
      const res = await claimPairCode(code);
      setConnection(res.connection);
      setClaimInput("");
      setPairCode("");
      setClaimOpen(false);
      setMobileOpen(false);
      await loadConnection();
    } catch (err) {
      setClaimError(errorText(err, "That code is invalid or expired."));
    } finally {
      setClaimLoading(false);
    }
  }

  async function handleSendText() {
    const text = draft.trim();
    if (!text || !connection || sending) return;
    setSending(true);
    setSendError("");
    try {
      const msg = await sendText(getSocket(), connection.id, text);
      stickRef.current = true;
      setMessages((prev) => appendUnique(prev, msg));
      setDraft("");
    } catch (err) {
      setSendError(errorText(err, "Message failed to send. Try again."));
    } finally {
      setSending(false);
    }
  }

  async function handleFilePicked(file: File | undefined) {
    if (!file || !connection || uploading) return;
    if (file.size > webConfig.maxFileBytes) {
      setSendError(`Files are limited to ${FILE_LIMIT_LABEL}. Pick a smaller file.`);
      return;
    }
    setUploading(true);
    setSendError("");
    try {
      const up = await uploadMedia(file, connection.id, draft.trim() || undefined);
      stickRef.current = true;
      setMessages((prev) => appendUnique(prev, up.message));
    } catch (err) {
      setSendError(errorText(err, "File failed to send. Try again."));
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteMessage(m: ChatMessage) {
    if (deletingId) return;
    setDeletingId(m.id);
    setSendError("");
    const previous = messages;
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
    setPendingDelete(null);
    try {
      await deleteMessage(m.id);
    } catch (err) {
      setMessages(previous);
      setSendError(errorText(err, "Could not delete that message. Try again."));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDisconnect() {
    if (!window.confirm(DISCONNECT_CONFIRM)) return;
    try {
      await disconnect();
      if (connection) leaveChat(connection.id);
      setConnection(null);
      setMessages([]);
      setPairCode("");
    } catch (err) {
      setSendError(errorText(err, "Could not disconnect. Try again."));
    }
  }

  async function handleLogout() {
    disconnectSocket();
    await logout();
    setConnection(null);
    setMessages([]);
    setChatStatus("idle");
  }

  if (authLoading) {
    return (
      <div className="bg-base-200 flex h-dvh flex-col overflow-hidden">
        <main className="mx-auto flex w-full max-w-6xl flex-1 min-h-0 gap-4 p-4">
          <div className="bg-base-100 hidden w-[320px] shrink-0 rounded-2xl p-5 border border-base-300 lg:block">
            <div className="skeleton h-12 w-full" />
            <div className="skeleton mt-3 h-24 w-full" />
          </div>
          <div className="bg-base-100 flex flex-1 flex-col rounded-2xl p-5 border border-base-300">
            <div className="skeleton h-8 w-1/3" />
            <div className="skeleton mt-4 h-16 w-2/3" />
            <div className="skeleton mt-2 h-16 w-1/2 self-end" />
          </div>
        </main>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="bg-base-200 flex h-dvh flex-col overflow-hidden">
        <main className="grid flex-1 place-items-center p-4">
          <div className="bg-base-100 w-full max-w-md rounded-2xl p-8 text-center shadow-sm border border-base-300">
            <h1 className="mt-4 text-2xl font-bold tracking-tight">Sign in to open your chat</h1>
            <p className="mt-2 text-sm leading-relaxed opacity-70">
              Your private room lives at <span className="font-mono text-xs">/chat</span>. Sign in with Google, then
              link one platform.
            </p>
            <div className="mt-6 flex justify-center gap-2">
              <a className="btn btn-primary" href={getLoginUrl()}>
                Sign in with Google
              </a>
              <a className="btn btn-outline" href="/">
                Back
              </a>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const panel = (
    <PairPanel
      me={me}
      displayName={displayName}
      connected={connected}
      platform={activePlatform}
      platforms={platforms}
      messageCount={messages.length}
      stats={stats}
      connectionCreatedAt={connection?.createdAt}
      accountName={connection?.telegramUsername}
      accountId={connection?.telegramChatId}
      pairCode={pairCode}
      pairLeft={pairLeft}
      pairLoading={pairLoading}
      pairError={pairError}
      copied={copied}
      onGenerate={() => void handleGenerate()}
      onCopy={() => void handleCopy()}
      onClaimOpen={() => setClaimOpen(true)}
      onPlatformSelect={openTips}
      onDisconnect={() => void handleDisconnect()}
      onLogout={() => void handleLogout()}
    />
  );

  return (
    <div className="bg-base-200 text-base-content flex h-dvh flex-col overflow-hidden">
      <div className="mx-auto flex w-full max-w-6xl flex-1 min-h-0 gap-0 p-0 sm:gap-4 sm:p-4">
        <aside className="hidden w-[320px] shrink-0 overflow-y-auto pb-1 lg:block">{panel}</aside>

        <main className="bg-base-100 flex min-w-0 flex-1 flex-col overflow-hidden border-0 shadow-none rounded-none sm:rounded-2xl sm:shadow-sm sm:border sm:border-base-300">
          <header className="flex h-16 shrink-0 items-center gap-3 border-b border-base-content/10 px-3 sm:px-4">
            <button
              className="btn btn-ghost btn-sm btn-circle lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open pairing panel"
            >
              <Menu size={18} />
            </button>
            <span className="min-w-0 flex-1">
              {connected && activePlatform ? (
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-2 rounded-full pr-2 text-left"
                  onClick={() => setTipsPlatform(activePlatform)}
                  aria-label={`How to connect ${activePlatform.label}`}
                  title={`How to connect ${activePlatform.label}`}
                >
                  <PlatformIcon platform={activePlatform} size={16} />
                  <span className="block truncate text-[15px] font-semibold">{activePlatform.label}</span>
                </button>
              ) : (
                <span className="block truncate text-[15px] font-semibold">No platform linked</span>
              )}
            </span>
            <span className={`badge badge-sm hidden sm:inline-flex ${connected ? "badge-success badge-outline" : "badge-ghost"}`}>
              {connected ? "Connected" : "Not connected"}
            </span>
            <ThemeToggle />
            {connected && (
              <div className="dropdown dropdown-end">
                <button
                  tabIndex={0}
                  role="button"
                  className="btn btn-ghost btn-sm btn-circle"
                  aria-label="Chat options"
                >
                  <MoreVertical size={16} />
                </button>
                <ul
                  tabIndex={0}
                  className="dropdown-content menu bg-base-100 rounded-box z-10 mt-2 w-52 p-2 shadow-lg border border-base-300"
                >
                  <li>
                    <button className="text-error" onClick={() => void handleDisconnect()}>
                      <WifiOff size={15} />
                      Disconnect
                    </button>
                  </li>
                </ul>
              </div>
            )}
          </header>

          {chatStatus === "loading" && (
            <div className="flex-1 space-y-3 overflow-hidden p-4">
              <div className="skeleton h-14 w-2/3 rounded-2xl" />
              <div className="skeleton ml-auto h-14 w-1/2 rounded-2xl" />
              <div className="skeleton h-14 w-3/5 rounded-2xl" />
            </div>
          )}

          {chatStatus === "error" && (
            <div className="grid flex-1 place-items-center p-6">
              <div className="text-center">
                <p className="font-semibold">Couldn’t load the conversation</p>
                <p className="mt-1 text-sm opacity-65">{chatError}</p>
                <button className="btn btn-primary btn-sm mt-4" onClick={loadConnection}>
                  Retry
                </button>
              </div>
            </div>
          )}

          {!connected && chatStatus === "ready" && (
            <div className="grid flex-1 place-items-center overflow-y-auto p-6">
              <div className="w-full max-w-sm text-center">
                <span className="bg-base-200 mx-auto flex h-12 w-12 items-center justify-center rounded-full">
                  <MessageCircle size={22} className="opacity-60" />
                </span>
                <h1 className="mt-3 text-xl font-bold">Link a platform to start chatting</h1>
                <p className="mt-1 text-sm opacity-65">
                  Pick a platform for the steps, then generate a code to send it.
                </p>

                {pairCode ? (
                  <div className="bg-base-200 mt-4 rounded-xl border border-dashed border-base-content/20 p-4">
                    <p className="font-mono text-3xl font-bold tracking-[0.2em] tabular-nums select-all">{pairCode}</p>
                    <p className="mt-1 text-xs tabular-nums opacity-60">Expires in {formatCountdown(pairLeft)}</p>
                    <div className="mt-3 flex justify-center gap-2">
                      <button className="btn btn-outline btn-sm gap-1" onClick={() => void handleCopy()}>
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                        {copied ? "Copied" : "Copy"}
                      </button>
                      <button className="btn btn-outline btn-sm lg:hidden" onClick={() => setMobileOpen(true)}>
                        Details
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 flex justify-center gap-2">
                    <button className="btn btn-primary btn-sm" onClick={() => void handleGenerate()} disabled={pairLoading}>
                      {pairLoading ? "Creating…" : "Generate code"}
                    </button>
                    <button className="btn btn-outline btn-sm" onClick={() => setClaimOpen(true)}>
                      Enter code
                    </button>
                  </div>
                )}
                <button className="btn btn-outline btn-sm mt-2 lg:hidden" onClick={() => setMobileOpen(true)}>
                  Open pairing panel
                </button>
              </div>
            </div>
          )}

          {connected && chatStatus === "ready" && (
            <>
              <MessageList
                messages={messages}
                scrollRef={scrollRef}
                onScroll={handleScroll}
                onDelete={(m) => setPendingDelete(m)}
                deletingId={deletingId}
              />

              {sendError && (
                <p role="alert" className="text-error flex shrink-0 items-center gap-1.5 border-t border-base-content/10 px-4 pt-2 text-[13px]">
                  <X size={14} />
                  {sendError}
                </p>
              )}

              <Composer
                draft={draft}
                setDraft={setDraft}
                sending={sending}
                uploading={uploading}
                onSend={() => void handleSendText()}
                onFile={(f) => void handleFilePicked(f)}
              />
            </>
          )}
        </main>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Pairing panel">
          <button aria-label="Close pairing panel" className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="bg-base-200 absolute inset-y-0 left-0 flex w-[19rem] max-w-[85vw] flex-col gap-3 overflow-y-auto p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold">Pairing</span>
              <button className="btn btn-ghost btn-sm btn-circle" onClick={() => setMobileOpen(false)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            {panel}
          </div>
        </div>
      )}

      <ClaimDialog
        open={claimOpen}
        input={claimInput}
        setInput={setClaimInput}
        loading={claimLoading}
        error={claimError}
        onClose={() => setClaimOpen(false)}
        onSubmit={() => void handleClaim()}
      />
      <DeleteMessageDialog
        message={pendingDelete}
        deleting={deletingId !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) void handleDeleteMessage(pendingDelete);
        }}
      />
      <PlatformTipsDialog
        platform={tipsPlatform}
        onClose={() => setTipsPlatform(null)}
        onClaim={() => setClaimOpen(true)}
      />
    </div>
  );
}
