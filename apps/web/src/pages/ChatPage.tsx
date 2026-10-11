import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Menu,
  MessageCircle,
  Settings,
  WifiOff,
  X,
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
  getAnonStatus,
  getConnection,
  getConnectionStats,
  joinAnonQueue,
  leaveAnonQueue,
  nextAnonPartner,
  uploadMedia,
  type AnonSession,
  type ConnectionStats,
} from "../api";
import { connectSession, disconnectSocket, getSocket, joinChat, leaveChat, onAnonEnded, onAnonFound, onAnonMessage, onSocketStatus, sendAnonText, sendText } from "../socket";
import { navigate } from "../router";
import { usePlatforms } from "../platforms";
import { useLang } from "../i18n";
import SettingsDialog from "../components/SettingsDialog";
import ProfileDialog from "../components/ProfileDialog";
import BrandIcon from "../components/BrandIcon";
import { webConfig } from "../config";
import { FILE_LIMIT_LABEL } from "../format";
import { useSession } from "../auth/session";
import PushToggle from "../components/PushToggle";
import PlatformTipsDialog from "../components/PlatformTipsDialog";
import PlatformIcon from "../components/PlatformIcon";
import PlatformRail from "../components/PlatformRail";
import PairPanel from "../components/PairPanel";
import ClaimDialog from "../components/ClaimDialog";
import { buildPairingLink, takePairCodeParam, takeStashedPairCode } from "../pairingLink";
import Composer from "../components/Composer";
import DeleteMessageDialog from "../components/DeleteMessageDialog";
import MessageList from "../components/MessageList";
import AnonChat from "../components/AnonChat";

type ChatStatus = "idle" | "loading" | "ready" | "error";

function errorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function appendUnique(prev: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  if (prev.some((m) => m.id === msg.id)) return prev;
  return [...prev, msg];
}

function newTempId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function ChatPage() {
  const { me, authLoading, logout } = useSession();
  const { t } = useLang();
  const ttlLabel = t("common.minutes", { n: Math.round(webConfig.pairTtlSeconds / 60) });
  const pairSteps = [
    { title: t("chat.pair1t"), text: t("chat.pair1x", { ttl: ttlLabel }) },
    { title: t("chat.pair2t"), text: t("chat.pair2x") },
    { title: t("chat.pair3t"), text: t("chat.pair3x") },
  ];
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
  const [linkCopied, setLinkCopied] = useState(false);

  const [claimOpen, setClaimOpen] = useState(false);
  const [claimInput, setClaimInput] = useState("");
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimError, setClaimError] = useState("");
  const [tipsPlatform, setTipsPlatform] = useState<Platform | null>(null);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  const [sendError, setSendError] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ChatMessage | null>(null);
  const [stats, setStats] = useState<ConnectionStats | null>(null);
  const [socketOnline, setSocketOnline] = useState(true);
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());
  // Real message ids the platform confirmed receiving. Never reset: uuids can't
  // collide across connections, and a reload shouldn't demote ✓✓ back to ✓.
  const [deliveredIds, setDeliveredIds] = useState<ReadonlySet<string>>(() => new Set());
  const pendingRef = useRef<Set<string>>(new Set());
  const failedRef = useRef<Set<string>>(new Set());
  const inflightRef = useRef<Set<string>>(new Set());
  const connectionRef = useRef<Connection | null>(null);
  connectionRef.current = connection;

  const [anonSession, setAnonSession] = useState<AnonSession | null>(null);
  const [anonSearching, setAnonSearching] = useState(false);
  const [anonMessages, setAnonMessages] = useState<ChatMessage[]>([]);
  const [anonDraft, setAnonDraft] = useState("");
  const [anonSending, setAnonSending] = useState(false);
  const [anonError, setAnonError] = useState("");
  const anonOwnIds = useRef<Set<string>>(new Set());
  const anonRef = useRef<AnonSession | null>(null);
  anonRef.current = anonSession;
  const anonActive = anonSession !== null || anonSearching;

  function anonToChat(sessionId: string, m: { id: string; sender: string; text?: string | null; createdAt: string }): ChatMessage {
    return {
      id: m.id,
      connectionId: `anon:${sessionId}`,
      sender: m.sender as ChatMessage["sender"],
      kind: "text",
      text: m.text ?? "",
      createdAt: m.createdAt,
    };
  }

  function resetAnon(): void {
    setAnonSession(null);
    setAnonSearching(false);
    setAnonMessages([]);
    setAnonDraft("");
    setAnonError("");
    anonOwnIds.current.clear();
  }

  function mergeLocal(server: ChatMessage[], local: ChatMessage[]): ChatMessage[] {
    const ids = new Set(server.map((m) => m.id));
    return [
      ...server,
      ...local.filter(
        (m) => (pendingRef.current.has(m.id) || failedRef.current.has(m.id)) && !ids.has(m.id),
      ),
    ];
  }

  function setFailed(next: Set<string>): void {
    failedRef.current = next;
    setFailedIds(next);
  }

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const copyTimer = useRef<number | null>(null);
  const linkConsumed = useRef(false);
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
      setMessages((prev) => mergeLocal(state.messages, prev));
      setChatStatus("ready");
      stickRef.current = true;
    } catch (err) {
      setChatStatus("error");
      setChatError(errorText(err, t("chat.loadFailed")));
    }
  }, []);

  useEffect(() => {
    if (!me) {
      setChatStatus("idle");
      setConnection(null);
      setMessages([]);
      setFailed(new Set());
      setPendingIds(new Set());
      pendingRef.current.clear();
      resetAnon();
      return;
    }
    void loadConnection();
  }, [me, loadConnection]);

  useEffect(() => {
    if (!authLoading && !me) navigate("/");
  }, [authLoading, me]);

  useEffect(() => {
    if (!me) return;
    const offStatus = onSocketStatus(setSocketOnline);
    const offFound = onAnonFound((f) => {
      setAnonSession({ id: f.sessionId, partnerPlatform: f.partnerPlatform });
      setAnonSearching(false);
      setAnonMessages([]);
      anonOwnIds.current.clear();
      setAnonError("");
    });
    const offEnded = onAnonEnded((p) => {
      if (anonRef.current?.id !== p.sessionId) return;
      setAnonSession(null);
      setAnonError(t("anon.ended"));
    });
    const offMsg = onAnonMessage((m) => {
      if (anonRef.current?.id !== m.sessionId) return;
      if (m.kind !== "text" || !m.text) return;
      setAnonMessages((prev) => appendUnique(prev, anonToChat(m.sessionId, m)));
    });
    connectSession(
      () => void loadConnection(),
      () => {
        setConnection((prev) => {
          if (prev) leaveChat(prev.id);
          return null;
        });
        setMessages([]);
        setFailed(new Set());
        setPendingIds(new Set());
        pendingRef.current.clear();
      },
    );
    // A reload mid-session resumes the room (messages start empty: v1 keeps
    // no anon history).
    void getAnonStatus()
      .then((s) => {
        if (s.session) {
          setAnonSession(s.session);
          setAnonSearching(false);
        } else if (s.inQueue) {
          setAnonSearching(true);
        }
      })
      .catch(() => {});
    return () => {
      offStatus();
      offFound();
      offEnded();
      offMsg();
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
      (msgs) => {
        // Preserve locally-pending bubbles across history replaces so an
        // in-flight send is never wiped (and its retry target never orphaned).
        setMessages((prev) => mergeLocal(msgs, prev));
      },
      (payload) => {
        // The message is saved server-side (✓ stays); only the platform leg
        // failed, so surface it instead of silently keeping a single tick.
        if (!payload.ok) {
          setSendError(t("chat.platformMissed"));
          return;
        }
        setDeliveredIds((prev) => {
          if (prev.has(payload.id)) return prev;
          const next = new Set(prev);
          next.add(payload.id);
          return next;
        });
      },
    );
    return () => {
      leaveChat(connectionId);
    };
  }, [connectionId]);

  // Pairing-link handoff (?code= or stashed across OAuth): prefill the claim
  // dialog once, only when there is no room to hijack.
  useEffect(() => {
    if (chatStatus !== "ready" || connected || linkConsumed.current) return;
    linkConsumed.current = true;
    const code = takePairCodeParam() ?? takeStashedPairCode();
    if (code) {
      setClaimInput(code);
      setClaimOpen(true);
    }
  }, [chatStatus, connected]);

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
      if (window.matchMedia?.("(max-width: 1023.5px)").matches) setMobileOpen(true);
    } catch (err) {
      setPairError(errorText(err, t("chat.genFailed")));
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
      setPairError(t("common.copyFailedSelect"));
    }
  }

  async function handleCopyLink() {
    if (!pairCode) return;
    try {
      await navigator.clipboard.writeText(buildPairingLink(pairCode));
      setLinkCopied(true);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      setPairError(t("common.copyFailedManual"));
    }
  }

  async function handleClaim() {
    const code = parsePairingCode(claimInput);
    if (!code) {
      setClaimError(t("chat.claimShort", { ex: "AB12-CD34" }));
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
      setFailed(new Set());
      setPendingIds(new Set());
      pendingRef.current.clear();
      await loadConnection();
    } catch (err) {
      setClaimError(errorText(err, t("chat.claimFailed")));
    } finally {
      setClaimLoading(false);
    }
  }

  async function sendTextOnce(text: string, tempId: string): Promise<boolean> {
    const connId = connection?.id;
    if (!connId || inflightRef.current.has(tempId)) return false;
    inflightRef.current.add(tempId);
    const pending: ChatMessage = {
      id: tempId,
      connectionId: connId,
      sender: "web",
      kind: "text",
      text,
      createdAt: new Date().toISOString(),
    };
    pendingRef.current.add(tempId);
    setMessages((prev) => [...prev.filter((m) => m.id !== tempId), pending]);
    setPendingIds(new Set(pendingRef.current));
    if (failedRef.current.has(tempId)) {
      const next = new Set(failedRef.current);
      next.delete(tempId);
      setFailed(next);
    }
    try {
      const msg = await sendText(getSocket(), connId, text);
      // Drop late acks from a previous connection (disconnect/claim mid-send):
      // the bubble belongs to a room we no longer show.
      if (connectionRef.current?.id !== connId) {
        pendingRef.current.delete(tempId);
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setPendingIds(new Set(pendingRef.current));
        return false;
      }
      stickRef.current = true;
      pendingRef.current.delete(tempId);
      // The broadcast may arrive before the ack; dedupe on both ids.
      setMessages((prev) => [...prev.filter((m) => m.id !== tempId && m.id !== msg.id), msg]);
      setPendingIds(new Set(pendingRef.current));
      return true;
    } catch {
      pendingRef.current.delete(tempId);
      setPendingIds(new Set(pendingRef.current));
      // Failed on a room we already left: drop instead of offering a retry
      // that would send into the wrong connection.
      if (connectionRef.current?.id !== connId) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        return false;
      }
      const next = new Set(failedRef.current);
      next.add(tempId);
      setFailed(next);
      return false;
    } finally {
      inflightRef.current.delete(tempId);
    }
  }

  async function handleSendText() {
    const text = draft.trim();
    if (!text || !connection || sending) return;
    setSending(true);
    setSendError("");
    try {
      // The attempt is recorded as a bubble either way, so the draft is
      // always cleared (keeping it would double-send on the next Enter).
      await sendTextOnce(text, newTempId());
    } finally {
      setDraft("");
      setSending(false);
    }
  }

  async function handleFilePicked(file: File | undefined) {
    const connId = connection?.id;
    if (!file || !connId || uploading) return;
    if (file.size > webConfig.maxFileBytes) {
      setSendError(t("chat.fileTooBig", { limit: FILE_LIMIT_LABEL }));
      return;
    }
    setUploading(true);
    setUploadProgress(null);
    setSendError("");
    const ctrl = new AbortController();
    uploadAbort.current = ctrl;
    try {
      const up = await uploadMedia(file, connId, draft.trim() || undefined, {
        signal: ctrl.signal,
        onProgress: (r) => setUploadProgress(r),
      });
      if (connectionRef.current?.id !== connId) return;
      stickRef.current = true;
      setMessages((prev) => appendUnique(prev, up.message));
    } catch (err) {
      // Cancel is intentional: no error banner, just reset.
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setSendError(errorText(err, t("chat.fileFailed")));
      }
    } finally {
      uploadAbort.current = null;
      setUploadProgress(null);
      setUploading(false);
    }
  }

  function handleCancelUpload() {
    uploadAbort.current?.abort();
  }

  async function handleDeleteMessage(m: ChatMessage) {
    if (deletingId) return;
    // Failed sends never reached the server: dismiss locally, no REST call
    // (the temp id would 404 and roll the bubble back).
    if (failedIds.has(m.id)) {
      setMessages((prev) => prev.filter((x) => x.id !== m.id));
      const next = new Set(failedRef.current);
      next.delete(m.id);
      setFailed(next);
      setPendingDelete(null);
      return;
    }
    setDeletingId(m.id);
    setSendError("");
    const wasFailed = failedIds.has(m.id);
    const previous = messages;
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
    setPendingDelete(null);
    try {
      await deleteMessage(m.id);
    } catch (err) {
      // A retry that started after confirm replaces the temp id; restoring
      // it then would resurrect a ghost bubble.
      if (!(wasFailed && !failedRef.current.has(m.id))) {
        setMessages(previous);
        setSendError(errorText(err, t("chat.deleteFailed")));
      }
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDisconnect() {
    if (!window.confirm(t("chat.disconnectConfirm"))) return;
    try {
      await disconnect();
      resetRoom();
    } catch (err) {
      setSendError(errorText(err, t("chat.disconnectFailed")));
    }
  }

  // One-click platform switch: drop the room and immediately stage a fresh
  // code, so the user only has to send it to the next bot. No confirm — the
  // same destructive step as Disconnect, minus the extra round-trip.
  async function handleSwitchPlatform() {
    try {
      await disconnect();
    } catch (err) {
      setSendError(errorText(err, t("chat.disconnectFailed")));
      return;
    }
    resetRoom();
    setMobileOpen(true);
    await handleGenerate();
  }

  function resetRoom(): void {
    if (connectionRef.current) leaveChat(connectionRef.current.id);
    setConnection(null);
    setMessages([]);
    setFailed(new Set());
    setPendingIds(new Set());
    pendingRef.current.clear();
    setPairCode("");
    setPairExpiresAt("");
    setPairLeft(0);
    setPairError("");
  }

  async function handleAnonFind() {
    setAnonError("");
    try {
      const res = await joinAnonQueue();
      if (res.matched && res.session) {
        setAnonSession(res.session);
        setAnonSearching(false);
        setAnonMessages([]);
        anonOwnIds.current.clear();
      } else {
        setAnonSearching(true);
      }
    } catch (err) {
      setAnonError(errorText(err, t("anon.sendFailed")));
    }
  }

  async function handleAnonNext() {
    setAnonError("");
    try {
      const res = await nextAnonPartner();
      setAnonMessages([]);
      anonOwnIds.current.clear();
      if (res.matched && res.session) {
        setAnonSession(res.session);
        setAnonSearching(false);
      } else {
        setAnonSession(null);
        setAnonSearching(true);
      }
    } catch (err) {
      setAnonError(errorText(err, t("anon.sendFailed")));
    }
  }

  async function handleAnonStop() {
    try {
      await leaveAnonQueue();
    } catch {
      // Best effort: local state clears either way.
    }
    resetAnon();
  }

  async function handleAnonSend() {
    const text = anonDraft.trim();
    const session = anonRef.current;
    if (!text || !session || anonSending) return;
    setAnonSending(true);
    setAnonError("");
    try {
      const res = await sendAnonText(text);
      // Unlike the private room there is no failed bubble to preserve the
      // text, so a failed send keeps the draft for a retry.
      if (!res.ok || !res.message) {
        setAnonError(errorText(res.error ? new Error(res.error) : null, t("anon.sendFailed")));
        return;
      }
      if (anonRef.current?.id !== session.id) return;
      anonOwnIds.current.add(res.message.id);
      setAnonMessages((prev) => appendUnique(prev, res.message!));
      setAnonDraft("");
    } finally {
      setAnonSending(false);
    }
  }

  async function handleLogout() {
    disconnectSocket();
    try {
      await leaveAnonQueue();
    } catch {
      // Best effort: the queue row TTLs out on its own.
    }
    await logout();
    setConnection(null);
    setMessages([]);
    setFailed(new Set());
    setPendingIds(new Set());
    pendingRef.current.clear();
    resetAnon();
    setSocketOnline(true);
    setChatStatus("idle");
  }

  if (authLoading) {
    return (
      <div className="bg-base-100 flex h-dvh overflow-hidden">
        <div className="bg-base-200 hidden w-[320px] shrink-0 flex-col gap-3 border-r border-base-content/10 p-4 lg:flex">
          <div className="skeleton h-10 w-full" />
          <div className="skeleton h-24 w-full" />
          <div className="skeleton h-32 w-full" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col p-4">
          <div className="skeleton h-8 w-1/3" />
          <div className="skeleton mt-4 h-16 w-2/3" />
          <div className="skeleton mt-2 h-16 w-1/2 self-end" />
        </div>
      </div>
    );
  }

  if (!me) return null;

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
      onCopyLink={() => void handleCopyLink()}
      linkCopied={linkCopied}
      onClaimOpen={() => setClaimOpen(true)}
      onPlatformSelect={openTips}
      onSwitch={() => void handleSwitchPlatform()}
      onDisconnect={() => void handleDisconnect()}
      onProfileOpen={() => setProfileOpen(true)}
      anonActive={anonActive}
      onAnonFind={() => void (anonActive ? handleAnonNext() : handleAnonFind())}
    />
  );

  const anonPartnerLabel = anonSession
    ? (anonSession.partnerPlatform === "web"
      ? "Web"
      : (findPlatform(anonSession.partnerPlatform, platforms)?.label ?? anonSession.partnerPlatform))
    : "";

  const sidebarTools = (
    <>
      <PushToggle />
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-circle"
        onClick={() => setSettingsOpen(true)}
        aria-label={t("settings.title")}
        title={t("settings.title")}
      >
        <Settings size={17} />
      </button>
    </>
  );

  const sidebarHead = (
    <div className="flex h-14 shrink-0 items-center gap-1 px-3">
      <span className="flex min-w-0 flex-1 items-center gap-2 font-bold tracking-tight">
        <BrandIcon size={18} />
        Crosschat
      </span>
      {sidebarTools}
    </div>
  );

  return (
    <div className="bg-base-200 text-base-content flex h-dvh gap-0 overflow-hidden lg:gap-3 lg:p-3">
      <aside className="bg-base-100 hidden w-[320px] shrink-0 flex-col overflow-hidden lg:flex lg:rounded-3xl">
        {sidebarHead}
        <div className="chat-scroll min-h-0 flex-1 overflow-y-auto p-3">{panel}</div>
      </aside>

      <main className="bg-base-100 flex min-w-0 flex-1 flex-col overflow-hidden lg:rounded-3xl">
        <header className="flex h-14 shrink-0 items-center gap-2 px-3 sm:px-4">
            <button
              className="btn btn-ghost btn-sm btn-circle lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label={t("chat.openPanel")}
            >
              <Menu size={18} />
            </button>
            <span className="min-w-0 flex-1">
              {connected && activePlatform ? (
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-2 rounded-full pr-2 text-left"
                  onClick={() => setTipsPlatform(activePlatform)}
                  aria-label={t("chat.howToConnect", { label: activePlatform.label })}
                  title={t("chat.howToConnect", { label: activePlatform.label })}
                >
                  <PlatformIcon platform={activePlatform} size={16} />
                  <span className="block truncate text-[15px] font-semibold">{activePlatform.label}</span>
                </button>
              ) : (
                <span className="block truncate text-[15px] font-semibold">{t("chat.noPlatform")}</span>
              )}
            </span>
            <span className={`hidden items-center gap-1.5 text-xs font-medium sm:inline-flex ${connected ? "" : "opacity-60"}`}>
              <span className={`h-2 w-2 rounded-full ${connected ? "bg-success" : "bg-base-content/30"}`} />
              {connected ? t("chat.connected") : t("chat.notConnected")}
            </span>
            {connected && (
              <button
                className="btn btn-ghost btn-sm btn-circle text-error"
                onClick={() => void handleDisconnect()}
                aria-label={t("chat.disconnect")}
                title={t("chat.disconnect")}
              >
                <WifiOff size={16} />
              </button>
            )}
          </header>

          {!socketOnline && (
            <p role="status" className="bg-warning/15 text-warning flex shrink-0 items-center gap-1.5 px-4 py-1.5 text-[13px] font-medium">
              <WifiOff size={14} />
              {t("chat.offline")}
            </p>
          )}

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
                <p className="font-semibold">{t("chat.loadTitle")}</p>
                <p className="mt-1 text-sm opacity-65">{chatError}</p>
                <button className="btn btn-primary btn-sm mt-4" onClick={loadConnection}>
                  {t("common.retry")}
                </button>
              </div>
            </div>
          )}

          {!connected && chatStatus === "ready" && !anonActive && (
            <div className="grid flex-1 place-items-center overflow-y-auto p-6">
              <div className="w-full max-w-sm text-center">
                <span className="bg-base-200 mx-auto flex h-12 w-12 items-center justify-center rounded-full">
                  <MessageCircle size={22} className="opacity-60" />
                </span>
                <h1 className="mt-3 text-xl font-bold tracking-tight">{t("chat.emptyTitle")}</h1>
                <p className="mt-1 text-sm opacity-65">
                  {t("chat.emptySub")}
                </p>
                <ol className="mx-auto mt-5 max-w-xs space-y-3 text-left">
                  {pairSteps.map((s, i) => (
                    <li key={s.title} className="flex gap-3">
                      <span className="font-mono text-sm opacity-40">{i + 1}.</span>
                      <span>
                        <span className="block text-sm font-semibold">{s.title}</span>
                        <span className="block text-[13px] opacity-65">{s.text}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                <button className="btn btn-primary btn-sm mt-5 lg:hidden" onClick={() => setMobileOpen(true)}>
                  {t("chat.openPanel")}
                </button>
                <p className="mt-3 hidden text-[13px] opacity-55 lg:block">
                  {t("chat.emptyDesktop")}
                </p>
              </div>
            </div>
          )}

          {anonActive && chatStatus === "ready" && (
            anonSession ? (
              <AnonChat
                session={anonSession}
                partnerLabel={anonPartnerLabel}
                messages={anonMessages}
                isMine={(m) => anonOwnIds.current.has(m.id)}
                draft={anonDraft}
                setDraft={setAnonDraft}
                sending={anonSending}
                error={anonError}
                onSend={() => void handleAnonSend()}
                onNext={() => void handleAnonNext()}
                onStop={() => void handleAnonStop()}
              />
            ) : (
              <div className="grid flex-1 place-items-center p-6">
                <div className="w-full max-w-xs text-center">
                  {anonSearching ? (
                    <>
                      <span className="loading loading-spinner loading-lg mx-auto" />
                      <p className="mt-3 text-sm font-semibold">{t("anon.searching")}</p>
                      <button className="btn btn-outline btn-sm mt-4" onClick={() => void handleAnonStop()}>
                        {t("anon.cancel")}
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-semibold">{anonError || t("anon.ended")}</p>
                      <button className="btn btn-primary btn-sm mt-4" onClick={() => void handleAnonFind()}>
                        {t("anon.find")}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          )}

          {connected && chatStatus === "ready" && !anonActive && (
            <>
              <MessageList
                messages={messages}
                scrollRef={scrollRef}
                onScroll={handleScroll}
                onDelete={(m) => setPendingDelete(m)}
                deletingId={deletingId}
                failedIds={failedIds}
                pendingIds={pendingIds}
                deliveredIds={deliveredIds}
                onRetry={(m) => void sendTextOnce(m.text ?? "", m.id)}
              />

              {sendError && (
                <p role="alert" className="text-error flex shrink-0 items-center gap-1.5 px-4 pt-2 text-[13px]">
                  <X size={14} />
                  {sendError}
                </p>
              )}

              <Composer
                draft={draft}
                setDraft={setDraft}
                sending={sending}
                uploading={uploading}
                uploadProgress={uploadProgress}
                onSend={() => void handleSendText()}
                onFile={(f) => void handleFilePicked(f)}
                onCancelUpload={handleCancelUpload}
              />
            </>
          )}
        </main>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label={t("chat.drawerTitle")}>
          <button aria-label={t("chat.drawerClose")} className="backdrop-enter absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="drawer-enter bg-base-100 absolute inset-y-0 left-0 flex w-[19rem] max-w-[85vw] flex-col overflow-hidden rounded-r-3xl shadow-xl">
            <div className="flex items-center justify-between border-b border-base-content/10 py-1 pl-3 pr-1">
              <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-bold">
                <BrandIcon size={16} />
                {t("chat.drawerTitle")}
              </span>
              <PushToggle />
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-circle"
                onClick={() => setSettingsOpen(true)}
                aria-label={t("settings.title")}
              >
                <Settings size={16} />
              </button>
              <button className="btn btn-ghost btn-sm btn-circle" onClick={() => setMobileOpen(false)} aria-label={t("common.close")}>
                <X size={16} />
              </button>
            </div>
            <div className="chat-scroll min-h-0 flex-1 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {panel}
            </div>
          </div>
        </div>
      )}

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ProfileDialog
        open={profileOpen}
        me={me}
        displayName={displayName}
        status={connected && activePlatform ? t("panel.linkedIs", { label: activePlatform.label }) : t("panel.noLink")}
        onClose={() => setProfileOpen(false)}
        onLogout={() => void handleLogout()}
      />
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
