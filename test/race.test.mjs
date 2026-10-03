// Race safety: stale sockets, concurrent claims, inbound-vs-disconnect. Run: pnpm test:race
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-race-"));
process.env.PORT = "8498";
process.env.DATABASE_PATH = path.join(tmp, "race.db");
process.env.MEDIA_DIR = path.join(tmp, "media");
process.env.SESSION_SECRET = "race-test-secret-long-enough-0123456789abcd";
process.env.TELEGRAM_WEBHOOK_SECRET = "race-test-bot-secret-0123456789abcdef";
process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-race-test-fake-secret-0123456789ab";
process.env.NODE_ENV = "development";

const load = (p) => import(pathToFileURL(path.join(root, p)).href);
const base = "http://127.0.0.1:8498";
const BOT_SECRET = "race-test-bot-secret-0123456789abcdef";
const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` :: ${extra}` : ""}`);
};

const db = await load("apps/realtime/dist/db.js");
const { signSessionId } = await load("apps/realtime/dist/auth.js");
await load("apps/realtime/dist/index.js");
await new Promise((r) => setTimeout(r, 700));

function mkUser(id) {
  db.createUser(id, `sub-${id}`, `${id}@test.local`, id, null);
  const s = db.createSession(`sess-${id}`, id, 120_000);
  return {
    cookie: `cc_session=${encodeURIComponent(signSessionId(s.id))}`,
    sessionId: s.id,
  };
}
const a = mkUser("ra");
const b = mkUser("rb");
const c = mkUser("rc");
const d = mkUser("rd");
const botHeaders = { "content-type": "application/json", "x-bot-secret": BOT_SECRET };

// Pair user A so the socket has a room to send in.
const genA = await fetch(`${base}/api/pair/generate`, { method: "POST", headers: { cookie: a.cookie } }).then((r) => r.json());
await fetch(`${base}/api/pair/claim`, {
  method: "POST", headers: { cookie: a.cookie, ...botHeaders },
  body: JSON.stringify({ code: genA.code, telegramChatId: "race-chat" }),
});
const connA = db.findConnectionByUser("ra");

// 1. Socket sends fine, then the session dies (logout) -> next send rejected.
const { io: sockIo } = await load("apps/web/node_modules/socket.io-client/build/esm/index.js");
const sock = sockIo(base, { transports: ["websocket"], extraHeaders: { Cookie: a.cookie }, autoConnect: false });
const send = (payload) => new Promise((resolve) => {
  const t = setTimeout(() => resolve({ ok: false, error: "timeout" }), 3000);
  sock.emit("message:send", payload, (r) => { clearTimeout(t); resolve(r); });
});
await new Promise((resolve) => {
  sock.on("connect", () => resolve());
  sock.on("connect_error", () => resolve());
  sock.connect();
});
const before = await send({ connectionId: connA.id, kind: "text", text: "alive" });
check("socket send works with live session", before?.ok === true, JSON.stringify(before));
db.deleteSession(a.sessionId);
const after = await send({ connectionId: connA.id, kind: "text", text: "after logout" });
check("socket send rejected after session deleted", after?.ok === false && /session expired/i.test(after?.error ?? ""), JSON.stringify(after));
await new Promise((r) => setTimeout(r, 300));
check("stale socket was disconnected", sock.disconnected === true, String(sock.connected));
sock.close();

// 2. Two users race for the same bot-initiated code -> exactly one wins.
await fetch(`${base}/api/pair/create`, {
  method: "POST", headers: botHeaders,
  body: JSON.stringify({ code: "RACE-0001", telegramChatId: "race-chat-2" }),
});
const [winB, winC] = await Promise.all([
  fetch(`${base}/api/pair/claim`, {
    method: "POST", headers: { cookie: b.cookie, "content-type": "application/json" },
    body: JSON.stringify({ code: "RACE-0001" }),
  }),
  fetch(`${base}/api/pair/claim`, {
    method: "POST", headers: { cookie: c.cookie, "content-type": "application/json" },
    body: JSON.stringify({ code: "RACE-0001" }),
  }),
]);
const codes = [winB.status, winC.status].sort().join(",");
check("concurrent double-claim: one 201, one 404", codes === "201,404", codes);

// 3. Same user races two different codes -> one connection only.
await fetch(`${base}/api/pair/create`, {
  method: "POST", headers: botHeaders,
  body: JSON.stringify({ code: "RACE-0002", telegramChatId: "race-chat-3" }),
});
await fetch(`${base}/api/pair/create`, {
  method: "POST", headers: botHeaders,
  body: JSON.stringify({ code: "RACE-0003", telegramChatId: "race-chat-4" }),
});
const [r1, r2] = await Promise.all([
  fetch(`${base}/api/pair/claim`, {
    method: "POST", headers: { cookie: d.cookie, "content-type": "application/json" },
    body: JSON.stringify({ code: "RACE-0002" }),
  }),
  fetch(`${base}/api/pair/claim`, {
    method: "POST", headers: { cookie: d.cookie, "content-type": "application/json" },
    body: JSON.stringify({ code: "RACE-0003" }),
  }),
]);
const pair = [r1.status, r2.status].sort().join(",");
check("same-user concurrent claims: one wins", pair === "201,409" || pair === "201,404", pair);

// 4. Inbound racing a disconnect -> JSON 404, never a 500 crash page.
await fetch(`${base}/api/pair/disconnect`, {
  method: "POST", headers: botHeaders,
  body: JSON.stringify({ telegramChatId: "race-chat" }),
});
const late = await fetch(`${base}/api/telegram/inbound`, {
  method: "POST", headers: botHeaders,
  body: JSON.stringify({ chatId: "race-chat", kind: "text", text: "too late" }),
});
check("inbound after disconnect is 404", late.status === 404, String(late.status));
const lateBody = await late.json().catch(() => ({}));
check("late inbound body is json", lateBody.error === "connection not found", JSON.stringify(lateBody));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
try { db.db.close(); } catch {}
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }); } catch {}
process.exit(failed.length === 0 ? 0 : 1);
