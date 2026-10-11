// Regression tests for the fixes made during the security/correctness audit.
// Run with: pnpm test:realtime  (requires `pnpm build` first)
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-rt-"));
process.env.PORT = "8478";
process.env.DATABASE_PATH = path.join(tmp, "rt.db");
process.env.MEDIA_DIR = path.join(tmp, "media");
process.env.SESSION_SECRET = "regression-secret-long-enough-for-tests-1234567890";
process.env.TELEGRAM_WEBHOOK_SECRET = "rt-bot-secret";
process.env.TELEGRAM_BOT_TOKEN = "";
// Neutralise the real .env values: the startup guard rejects exposed secrets.
process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-test-fake-secret-0123456789abcdefghij";
process.env.NODE_ENV = "development";

const load = (p) => import(pathToFileURL(path.join(root, p)).href);
const base = "http://127.0.0.1:8478";
const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` :: ${extra}` : ""}`);
};

const db = await load("apps/realtime/dist/db.js");
const { signSessionId } = await load("apps/realtime/dist/auth.js");
const { resolveStoredMediaPath, isBotRequest } = await load("apps/realtime/dist/security.js");
await load("apps/realtime/dist/index.js");
await new Promise((r) => setTimeout(r, 700));

function mkUser(id) {
  db.createUser(id, `sub-${id}`, `${id}@test.local`, id, null);
  const s = db.createSession(`sess-${id}`, id, 120_000);
  return `cc_session=${encodeURIComponent(signSessionId(s.id))}`;
}
const jar = {};
jar.a = mkUser("ra");
jar.b = mkUser("rb");

const botHeaders = { "content-type": "application/json", "x-bot-secret": "rt-bot-secret" };
const post = (p, body, headers) =>
  fetch(base + p, { method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });

// A. pairing code must come from a CSPRNG and be canonical
const gen = await (await post("/api/pair/generate", undefined, { cookie: jar.a })).json();
check("generate returns canonical code", /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(gen.code), gen.code);

// B. bot claims it -> connection
const claim = await (await post("/api/pair/claim",
  { code: gen.code, telegramChatId: "chatA", telegramUsername: "@User_A" },
  botHeaders)).json();
check("bot claim creates connection", !!claim.connection?.id);
check("username normalized", claim.connection?.telegramUsername === "User_A", claim.connection?.telegramUsername);
const connA = claim.connection.id;

// C. legacy alias header must NOT authenticate (single secret contract)
const alias = await fetch(base + "/api/pair/status?telegramChatId=chatA", {
  headers: { "x-telegram-secret": "rt-bot-secret" },
});
check("legacy x-telegram-secret rejected", alias.status === 401, String(alias.status));

// D. rate limit on claim for authenticated web users
let limited = false;
for (let i = 0; i < 12 && !limited; i++) {
  const r = await post("/api/pair/claim", { code: "ZZZZ-9999" }, { cookie: jar.b, "content-type": "application/json" });
  if (r.status === 429) limited = true;
}
check("web claim is rate limited", limited);

// E. media path traversal helper rejects escapes
check("resolveStoredMediaPath blocks ../", resolveStoredMediaPath("../secret") === null);
check("resolveStoredMediaPath blocks absolute", resolveStoredMediaPath("/etc/passwd") === null);
check("resolveStoredMediaPath blocks windows sep", resolveStoredMediaPath("..\\secret") === null);
const okRel = resolveStoredMediaPath("abc/def.png");
check("resolveStoredMediaPath allows normal path", okRel !== null && okRel.includes("abc"));

// F. socket must reject client-supplied media paths (traversal/spoof vector)
const { io: sockIo } = await load("apps/web/node_modules/socket.io-client/build/esm/index.js");
const sock = sockIo(base, { transports: ["websocket"], extraHeaders: { Cookie: jar.a }, autoConnect: false });
const sockRes = await new Promise((resolve) => {
  sock.on("connect", () => {
    sock.emit("message:send", { connectionId: connA, kind: "text", text: "hi", mediaPath: "../../.env" }, (r) => resolve(r));
  });
  sock.on("connect_error", () => resolve({ ok: false, error: "connect_error" }));
  sock.connect();
});
check("socket rejects mediaPath smuggling", sockRes?.ok === false && /media upload/i.test(sockRes?.error ?? ""), JSON.stringify(sockRes));

const spoof = await new Promise((resolve) => {
  sock.emit("message:send", { connectionId: connA, kind: "photo", mediaPath: "/media/whatever" }, (r) => resolve(r));
});
check("socket rejects non-text kind", spoof?.ok === false, JSON.stringify(spoof));

// G. socket send from another user's connection is refused
const sockB = sockIo(base, { transports: ["websocket"], extraHeaders: { Cookie: jar.b }, autoConnect: false });
const idor = await new Promise((resolve) => {
  sockB.on("connect", () => {
    sockB.emit("message:send", { connectionId: connA, kind: "text", text: "steal" }, (r) => resolve(r));
  });
  sockB.on("connect_error", () => resolve({ ok: true, error: "rejected" }));
  sockB.connect();
});
check("socket blocks cross-connection send", idor?.ok === false, JSON.stringify(idor));
sock.close();
sockB.close();

// H. expired session cannot use the API
db.createSession("sess-exp", "ra", -1000);
const expCookie = `cc_session=${encodeURIComponent(signSessionId("sess-exp"))}`;
const expRes = await fetch(base + "/api/connection", { headers: { cookie: expCookie } });
check("expired session 401", expRes.status === 401, String(expRes.status));

// I. tampered session signature rejected
const tampered = `cc_session=${encodeURIComponent("ra." + "0".repeat(64))}`;
const tamRes = await fetch(base + "/api/connection", { headers: { cookie: tampered } });
check("tampered signature 401", tamRes.status === 401, String(tamRes.status));

// J. HTML/SVG content types rejected even with image-ish naming
const htmlUp = await fetch(`${base}/api/media/upload?connectionId=${connA}`, {
  method: "POST",
  headers: { cookie: jar.a, "content-type": "text/html", "X-Filename": "x.html" },
  body: "<script>alert(1)</script>",
});
check("text/html upload rejected", htmlUp.status === 415, String(htmlUp.status));

// K. oversized media upload -> JSON 413
const overUp = await fetch(`${base}/api/media/upload?connectionId=${connA}`, {
  method: "POST",
  headers: { cookie: jar.a, "content-type": "application/octet-stream", "X-Filename": "big.bin" },
  body: Buffer.alloc(21 * 1024 * 1024, 1),
});
check("oversized upload -> 413 json", overUp.status === 413 && (await overUp.clone().json()).error !== undefined, String(overUp.status));

// L. media for a connection the user does not own is refused
const bUp = await fetch(`${base}/api/media/upload?connectionId=${connA}`, {
  method: "POST",
  headers: { cookie: jar.b, "content-type": "image/png", "X-Filename": "x.png" },
  body: Buffer.from([1, 2, 3]),
});
check("upload to foreign connection 403", bUp.status === 403, String(bUp.status));

// M. security headers present
const hRes = await fetch(base + "/api/health");
check("nosniff header set", hRes.headers.get("x-content-type-options") === "nosniff");
check("x-powered-by disabled", hRes.headers.get("x-powered-by") === null);
check("frame deny header", hRes.headers.get("x-frame-options") === "DENY");

// N. messages paginate newest-first window, ordered ascending on return
const conn = db.findConnectionById(connA);
for (let i = 0; i < 60; i++) {
  db.insertMessage({ id: crypto.randomUUID(), connectionId: connA, sender: "web", kind: "text", text: `m${i}`, createdAt: Date.now() - (60 - i) * 1000 });
}
const page = await (await fetch(base + "/api/connection?limit=10", { headers: { cookie: jar.a } })).json();
check("limit respected", page.messages.length === 10, String(page.messages.length));
const times = page.messages.map((m) => new Date(m.createdAt).getTime());
check("page returned ascending", times.every((t, i) => i === 0 || t >= times[i - 1]));
check("page contains newest", page.messages.at(-1).text === "m59", page.messages.at(-1).text);

// O. stats still correct with mixed senders
db.insertMessage({ id: crypto.randomUUID(), connectionId: connA, sender: "telegram", kind: "text", text: "tg", createdAt: Date.now() });
const st = await (await fetch(base + "/api/pair/status?telegramChatId=chatA", { headers: botHeaders })).json();
check("stats fromTelegram counted", st.stats.fromTelegram >= 1, JSON.stringify(st.stats.stats ?? st.stats));

// P. tg-pending legacy user is gone
const legacy = db.findUserById("tg-pending");
check("no fake tg-pending user", legacy === undefined);

// Q. disconnect by bot clears connection + media
const st2 = await fetch(base + "/api/pair/disconnect", {
  method: "POST", headers: botHeaders, body: JSON.stringify({ telegramChatId: "chatA" }),
});
check("bot disconnect 200", st2.status === 200, String(st2.status));
check("connection removed", db.findConnectionById(connA) === undefined);
check("media dir removed", !fs.existsSync(path.join(process.env.MEDIA_DIR, connA)));

// R. reconnect after disconnect works (no stale uniqueness state)
const gen2 = await (await post("/api/pair/generate", undefined, { cookie: jar.a })).json();
const claim2 = await (await post("/api/pair/claim", { code: gen2.code, telegramChatId: "chatA2" }, botHeaders)).json();
check("can re-pair after disconnect", !!claim2.connection?.id, JSON.stringify(claim2).slice(0, 80));

// S. used codes are purged by cleanup
db.insertPairingCode("TEST-1111", null, Date.now() - 1000);
db.deleteExpiredCodes();
check("expired code removed", db.findPairingCode("TEST-1111") === undefined);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
try { db.db.close(); } catch {}
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }); } catch {}
process.exit(failed.length === 0 ? 0 : 1);
