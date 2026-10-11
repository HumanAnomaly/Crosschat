// Regression test for CRITICAL bug: web media was never forwarded to Telegram.
// The bridge used to bail out on `/media/<id>` paths instead of resolving them.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-bridge-"));
process.env.DATABASE_PATH = path.join(tmp, "bridge.db");
process.env.MEDIA_DIR = path.join(tmp, "media");
process.env.SESSION_SECRET = "bridge-secret-long-enough-for-regression-tests-1234";
process.env.TELEGRAM_WEBHOOK_SECRET = "bridge-bot-secret";
process.env.TELEGRAM_BOT_TOKEN = "12345:FAKE-TOKEN-FOR-TEST";
// Neutralise the real .env values: the startup guard rejects exposed secrets.
process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-test-fake-secret-0123456789abcdefghij";
process.env.NODE_ENV = "development";

const load = (p) => import(pathToFileURL(path.join(root, p)).href);
const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` :: ${extra}` : ""}`);
};

const db = await load("apps/realtime/dist/db.js");
const { notifyTelegram } = await load("apps/realtime/dist/telegram-bridge.js");

// Seed a user + connection.
const user = db.createUser("bu1", "sub-b1", "b@test.local", "Bob", null);
const conn = db.createConnection("11111111-2222-3333-4444-555555555555", user.id, "chat-bridge", "bob");

// Write a real file on disk like the media router does.
const dir = path.join(process.env.MEDIA_DIR, conn.id);
fs.mkdirSync(dir, { recursive: true });
const storedName = "abcd-photo.png";
fs.writeFileSync(path.join(dir, storedName), Buffer.from([137, 80, 78, 71]));

// Insert the message row exactly like media.ts does.
const msgId = "99999999-8888-7777-6666-555555555555";
db.insertMessage({
  id: msgId,
  connectionId: conn.id,
  sender: "web",
  kind: "photo",
  mediaPath: path.join(conn.id, storedName),
  mime: "image/png",
  size: 4,
  createdAt: Date.now(),
});

// Stub global fetch and capture Telegram calls.
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith("https://api.telegram.org/bot")) {
    calls.push({ url: u, method: init?.method ?? "GET", body: init?.body });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }
  return realFetch(url, init);
};

// 1. The exact payload the media router emits: mediaPath = "/media/<id>".
const webMediaMessage = {
  id: msgId,
  connectionId: conn.id,
  sender: "web",
  kind: "photo",
  mediaPath: `/media/${msgId}`,
  mime: "image/png",
  size: 4,
  createdAt: new Date().toISOString(),
};
await notifyTelegram(conn.id, webMediaMessage);

const photoCall = calls.find((c) => c.url.includes("sendPhoto"));
check("web photo reaches sendPhoto (was silently dropped)", !!photoCall, calls.map((c) => c.url.split("/").pop()).join(",") || "no calls");
check("sendPhoto is a POST", photoCall?.method === "POST", photoCall?.method);
check("form carries the file blob", !!photoCall?.body && typeof FormData !== "undefined" && photoCall.body instanceof FormData);

// 2. Video uses sendVideo, not sendDocument.
calls.length = 0;
const vidId = "99999999-8888-7777-6666-555555555556";
fs.writeFileSync(path.join(dir, "clip.mp4"), Buffer.alloc(64, 2));
db.insertMessage({
  id: vidId, connectionId: conn.id, sender: "web", kind: "video",
  mediaPath: path.join(conn.id, "clip.mp4"), mime: "video/mp4", size: 64, createdAt: Date.now(),
});
await notifyTelegram(conn.id, {
  id: vidId, connectionId: conn.id, sender: "web", kind: "video",
  mediaPath: `/media/${vidId}`, mime: "video/mp4", size: 64, createdAt: new Date().toISOString(),
});
check("web video uses sendVideo", calls.some((c) => c.url.includes("sendVideo")), calls.map((c) => c.url.split("/").pop()).join(","));

// 3. Document uses sendDocument.
calls.length = 0;
const docId = "99999999-8888-7777-6666-555555555557";
fs.writeFileSync(path.join(dir, "notes.pdf"), Buffer.alloc(32, 3));
db.insertMessage({
  id: docId, connectionId: conn.id, sender: "web", kind: "document",
  mediaPath: path.join(conn.id, "notes.pdf"), mime: "application/pdf", size: 32, createdAt: Date.now(),
});
await notifyTelegram(conn.id, {
  id: docId, connectionId: conn.id, sender: "web", kind: "document",
  mediaPath: `/media/${docId}`, mime: "application/pdf", size: 32, createdAt: new Date().toISOString(),
});
check("web document uses sendDocument", calls.some((c) => c.url.includes("sendDocument")));

// 4. Text still uses sendMessage with the body text.
calls.length = 0;
await notifyTelegram(conn.id, {
  id: "text-1", connectionId: conn.id, sender: "web", kind: "text",
  text: "hello telegram", createdAt: new Date().toISOString(),
});
const msgCall = calls.find((c) => c.url.includes("sendMessage"));
check("text uses sendMessage", !!msgCall);
check("text body carries text", String(msgCall?.body ?? "").includes("hello telegram"));

// 5. Caption is passed as a caption field for media.
calls.length = 0;
await notifyTelegram(conn.id, { ...webMediaMessage, text: "my caption" });
const capCall = calls.find((c) => c.url.includes("sendPhoto"));
const capOk = capCall?.body instanceof FormData && String(capCall.body.get("caption")) === "my caption";
check("media caption forwarded", capOk);

// 6. A /media/<id> whose row belongs to ANOTHER connection must never leak the
// file. It may fall back to a plain text note, but no media upload may happen.
calls.length = 0;
const otherConn = db.createConnection("11111111-2222-3333-4444-666666666666", db.createUser("bu2", "sub-b2", "c@t.local", "Cid", null).id, "chat-other");
await notifyTelegram(otherConn.id, webMediaMessage);
const leaked = calls.filter((c) => /sendPhoto|sendVideo|sendDocument/.test(c.url));
check("cross-connection media file not leaked", leaked.length === 0, calls.map((c) => c.url.split("/").pop()).join(",") || "no calls");

// 7. Missing file falls back to a text note instead of throwing.
calls.length = 0;
const ghostId = "99999999-8888-7777-6666-555555555558";
db.insertMessage({
  id: ghostId, connectionId: conn.id, sender: "web", kind: "photo",
  mediaPath: path.join(conn.id, "gone.png"), mime: "image/png", size: 10, createdAt: Date.now(),
});
await notifyTelegram(conn.id, {
  id: ghostId, connectionId: conn.id, sender: "web", kind: "photo",
  mediaPath: `/media/${ghostId}`, mime: "image/png", createdAt: new Date().toISOString(),
});
check("missing file falls back to text", calls.some((c) => c.url.includes("sendMessage")));

// 8. Unknown connection id is a no-op (no crash).
calls.length = 0;
await notifyTelegram("does-not-exist", webMediaMessage);
check("unknown connection no-op", calls.length === 0);

globalThis.fetch = realFetch;
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
try { db.db.close(); } catch {}
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }); } catch {}
process.exit(failed.length === 0 ? 0 : 1);
