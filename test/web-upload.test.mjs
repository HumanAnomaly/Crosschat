// End-to-end check of the web -> Telegram media path, exactly as the browser
// does it: POST /api/media/upload, then verify what reaches the Bot API.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-web-"));
const load = (p) => import(pathToFileURL(path.join(root, p)).href);

process.env.PORT = "8494";
process.env.DATABASE_PATH = path.join(tmp, "web.db");
process.env.MEDIA_DIR = path.join(tmp, "media");
process.env.SESSION_SECRET = "web-media-check-secret-long-enough-0123456789";
process.env.TELEGRAM_WEBHOOK_SECRET = "web-media-check-bot-secret-0123456789";
process.env.TELEGRAM_BOT_TOKEN = "999999:AAHfake-token-to-capture-the-outbound-request";
process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-web-media-check-fake-0123456789abcdef";
process.env.NODE_ENV = "development";

const base = "http://127.0.0.1:8494";
const BOT_SECRET = "web-media-check-bot-secret-0123456789";

let db;
let cookie;
let connectionId;
let sent = [];
const originalFetch = globalThis.fetch;

before(async () => {
  db = await load("apps/realtime/dist/db.js");
  await load("apps/realtime/dist/index.js");
  await new Promise((r) => setTimeout(r, 700));

  db.createUser("wu", "sub-wu", "w@test.local", "Web Tester", null);
  const session = db.createSession("ws", "wu", 300_000);
  const { signSessionId } = await load("apps/realtime/dist/auth.js");
  cookie = `cc_session=${encodeURIComponent(signSessionId(session.id))}`;

  const gen = await fetch(`${base}/api/pair/generate`, { method: "POST", headers: { cookie } }).then((r) => r.json());
  const claim = await fetch(`${base}/api/pair/claim`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", "x-bot-secret": BOT_SECRET },
    body: JSON.stringify({ code: gen.code, telegramChatId: "999888777" }),
  }).then((r) => r.json());
  connectionId = claim.connection.id;

  // Intercept the outbound Bot API call.
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith("https://api.telegram.org/bot")) {
      const body = init?.body;
      const file = body instanceof FormData
        ? body.get("photo") ?? body.get("video") ?? body.get("document")
        : null;
      sent.push({
        method: u.split("/").pop(),
        chatId: body instanceof FormData ? body.get("chat_id") : null,
        caption: body instanceof FormData ? body.get("caption") : null,
        fileBytes: file ? file.size : null,
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return originalFetch(url, init);
  };
});

after(() => {
  globalThis.fetch = originalFetch;
  try { db.db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  setTimeout(() => process.exit(0), 50).unref();
});

async function upload(bytes, filename, type, caption) {
  const headers = { cookie, "content-type": type, "X-Filename": filename };
  if (caption) headers["X-Caption"] = caption;
  const res = await fetch(`${base}/api/media/upload?connectionId=${connectionId}`, {
    method: "POST",
    headers,
    body: bytes,
  });
  return { status: res.status, body: await res.json() };
}

describe("web upload to Telegram", () => {
  it("stores a photo and forwards it as sendPhoto", async () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 5]);
    sent = [];
    const up = await upload(png, "my holiday photo.png", "image/png", "from the web");

    assert.equal(up.status, 201);
    assert.equal(up.body.message.kind, "photo");
    assert.equal(up.body.message.text, "from the web");
    assert.equal(up.body.message.size, png.length);
    assert.equal(up.body.message.mediaPath, `/media/${up.body.message.id}`);

    const row = db.findMessageById(up.body.message.id);
    assert.ok(row.media_path.endsWith("-my_holiday_photo.png"), row.media_path);
    assert.ok(!row.media_path.includes("%"), "no double-encoded percent signs");

    const abs = path.join(process.env.MEDIA_DIR, row.media_path);
    assert.ok(fs.existsSync(abs), abs);
    assert.equal(Buffer.compare(fs.readFileSync(abs), png), 0, "bytes on disk match the upload");

    const fetched = await fetch(`${base}${up.body.message.mediaPath}`, { headers: { cookie } });
    assert.equal(fetched.status, 200);
    assert.equal(Buffer.compare(Buffer.from(await fetched.arrayBuffer()), png), 0);

    await new Promise((r) => setTimeout(r, 400));
    const photo = sent.find((s) => s.method === "sendPhoto");
    assert.ok(photo, `expected sendPhoto, saw: ${sent.map((s) => s.method).join(",") || "nothing"}`);
    assert.equal(photo.chatId, "999888777");
    assert.equal(photo.caption, "from the web");
    assert.equal(photo.fileBytes, png.length);
  });

  it("routes video to sendVideo", async () => {
    sent = [];
    const up = await upload(Buffer.alloc(2048, 9), "clip.mp4", "video/mp4");
    assert.equal(up.body.message.kind, "video");
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(sent.some((s) => s.method === "sendVideo"), sent.map((s) => s.method).join(","));
  });

  it("routes documents to sendDocument", async () => {
    sent = [];
    const up = await upload(Buffer.from([37, 80, 68, 70]), "notes.pdf", "application/pdf");
    assert.equal(up.body.message.kind, "document");
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(sent.some((s) => s.method === "sendDocument"), sent.map((s) => s.method).join(","));
  });

  it("routes audio to sendDocument with the voice bytes", async () => {
    sent = [];
    const up = await upload(Buffer.from([79, 103, 103, 83, 0, 2]), "voice.ogg", "audio/ogg");
    assert.equal(up.body.message.kind, "voice");
    await new Promise((r) => setTimeout(r, 400));
    const call = sent.find((s) => s.method === "sendDocument");
    assert.ok(call, sent.map((s) => s.method).join(","));
    assert.equal(call.fileBytes, 6);
  });

  it("refuses svg but allows a real image", async () => {
    const bad = await upload("<svg onload=alert(1)></svg>", "x.svg", "image/svg+xml");
    assert.equal(bad.status, 415);
    const good = await upload(Buffer.from([1, 2, 3]), "ok.png", "image/png");
    assert.equal(good.status, 201);
  });

  it("keeps inbound telegram messages in the same room", async () => {
    const res = await fetch(`${base}/api/telegram/inbound`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bot-secret": BOT_SECRET },
      body: JSON.stringify({ chatId: "999888777", kind: "text", text: "hi from telegram" }),
    });
    assert.equal(res.status, 201);
    assert.ok(db.listMessages(connectionId, 50).some((m) => m.text === "hi from telegram"));
  });
});
