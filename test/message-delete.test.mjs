// Web deletion, unsend-own rule. Run: pnpm test:delete
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-del-"));
process.env.PORT = "8496";
process.env.DATABASE_PATH = path.join(tmp, "del.db");
process.env.MEDIA_DIR = path.join(tmp, "media");
process.env.SESSION_SECRET = "delete-test-secret-long-enough-0123456789abcd";
process.env.TELEGRAM_WEBHOOK_SECRET = "delete-test-bot-secret-0123456789abcd";
process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-delete-test-fake-secret-0123456789";
process.env.NODE_ENV = "development";

const load = (p) => import(pathToFileURL(path.join(root, p)).href);
const base = "http://127.0.0.1:8496";
const BOT_SECRET = "delete-test-bot-secret-0123456789abcd";
const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` :: ${extra}` : ""}`);
};

const db = await load("apps/realtime/dist/db.js");
const { signSessionId } = await load("apps/realtime/dist/auth.js");
await load("apps/realtime/dist/index.js");
await new Promise((r) => setTimeout(r, 700));

db.createUser("du", "sub-du", "d@test.local", "Deleter", null);
const session = db.createSession("ds", "du", 300_000);
const cookie = `cc_session=${encodeURIComponent(signSessionId(session.id))}`;

db.createUser("other", "sub-other", "o@test.local", "Other", null);

const gen = await fetch(`${base}/api/pair/generate`, { method: "POST", headers: { cookie } }).then((r) => r.json());
const claim = await fetch(`${base}/api/pair/claim`, {
  method: "POST",
  headers: { cookie, "content-type": "application/json", "x-bot-secret": BOT_SECRET },
  body: JSON.stringify({ code: gen.code, telegramChatId: "chat-del" }),
}).then((r) => r.json());
const connectionId = claim.connection.id;

// Seed: one own web text, one own web media (file on disk), one telegram message.
const textId = crypto.randomUUID();
db.insertMessage({
  id: textId, connectionId, sender: "web", kind: "text", text: "to delete",
  createdAt: Date.now(),
});
const mediaId = crypto.randomUUID();
const dir = path.join(process.env.MEDIA_DIR, connectionId);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "gone.png"), Buffer.from([1, 2, 3, 4]));
db.insertMessage({
  id: mediaId, connectionId, sender: "web", kind: "photo", text: "pic",
  mediaPath: path.join(connectionId, "gone.png"), mime: "image/png", size: 4,
  createdAt: Date.now(),
});
const tgId = crypto.randomUUID();
db.insertMessage({
  id: tgId, connectionId, sender: "telegram", kind: "text", text: "not yours",
  createdAt: Date.now(), telegramMsgId: "777",
});

// 1. Owner deletes own web text -> 200 JSON, row gone.
const del = await fetch(`${base}/api/messages/${textId}`, { method: "DELETE", headers: { cookie } });
check("owner deletes own message: 200 json", del.status === 200, String(del.status));
const delBody = await del.json().catch(() => ({}));
check("delete body carries id", delBody.id === textId, JSON.stringify(delBody));
check("row removed from db", db.findMessageById(textId) === undefined);

// 2. Deleting the same id again -> JSON 404 (not an HTML fallback).
const del2 = await fetch(`${base}/api/messages/${textId}`, { method: "DELETE", headers: { cookie } });
check("second delete is 404", del2.status === 404, String(del2.status));
const del2Body = await del2.json().catch(() => ({}));
check("404 body is json with error", del2Body.error === "message not found", JSON.stringify(del2Body));

// 3. Own media delete also removes the file from disk.
const del3 = await fetch(`${base}/api/messages/${mediaId}`, { method: "DELETE", headers: { cookie } });
check("own media delete returns 200", del3.status === 200, String(del3.status));
check("media file removed", !fs.existsSync(path.join(dir, "gone.png")));
check("media row removed", db.findMessageById(mediaId) === undefined);

// 4. Web cannot delete the platform side's message -> 403, row kept.
const del4 = await fetch(`${base}/api/messages/${tgId}`, { method: "DELETE", headers: { cookie } });
check("web deleting telegram message is 403", del4.status === 403, String(del4.status));
check("telegram row untouched", !!db.findMessageById(tgId));

// 5. Another user's message cannot be deleted by me -> 403.
const otherConn = db.createConnection(crypto.randomUUID(), "other", "chat-other");
const otherMsg = crypto.randomUUID();
db.insertMessage({
  id: otherMsg, connectionId: otherConn.id, sender: "web", kind: "text", text: "mine",
  createdAt: Date.now(),
});
const del5 = await fetch(`${base}/api/messages/${otherMsg}`, { method: "DELETE", headers: { cookie } });
check("foreign delete is 403", del5.status === 403, String(del5.status));
check("foreign row untouched", !!db.findMessageById(otherMsg));

// 6. No session -> 401 JSON.
const del6 = await fetch(`${base}/api/messages/${otherMsg}`, { method: "DELETE" });
check("anonymous delete is 401", del6.status === 401, String(del6.status));

// 7. Telegram /delete for its own message -> deleted.
const botHeaders = { "content-type": "application/json", "x-bot-secret": BOT_SECRET };
const botDel = await fetch(`${base}/api/telegram/delete`, {
  method: "POST", headers: botHeaders,
  body: JSON.stringify({ chatId: "chat-del", platformMsgId: "777" }),
});
check("telegram deletes own message: 200", botDel.status === 200, String(botDel.status));
check("telegram row removed", db.findMessageById(tgId) === undefined);

// 8. Telegram /delete aimed at a web message -> 403, web row kept.
const webId = crypto.randomUUID();
db.insertMessage({
  id: webId, connectionId, sender: "web", kind: "text", text: "web says hi",
  createdAt: Date.now(), telegramMsgId: "888",
});
const botDel2 = await fetch(`${base}/api/telegram/delete`, {
  method: "POST", headers: botHeaders,
  body: JSON.stringify({ chatId: "chat-del", platformMsgId: "888" }),
});
check("telegram deleting web message is 403", botDel2.status === 403, String(botDel2.status));
check("web row untouched by telegram delete", !!db.findMessageById(webId));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
try { db.db.close(); } catch {}
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }); } catch {}
process.exit(failed.length === 0 ? 0 : 1);
