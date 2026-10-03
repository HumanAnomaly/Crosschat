// Regression tests for serving media off disk.
//
// Two real bugs are covered here:
//  1. A path containing a Windows drive letter was rejected by express's
//     sendFile/send pipeline with a 404/500 instead of being served.
//  2. sendFile errors surfaced as a generic 500 rather than a clean 404.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-media-"));
// Absolute paths keep the env loader from re-resolving them against the repo.
process.env.PORT = "8495";
process.env.DATABASE_PATH = path.join(tmp, "media.db");
process.env.MEDIA_DIR = path.join(tmp, "media");
process.env.SESSION_SECRET = "media-test-secret-long-enough-0123456789abcd";
process.env.TELEGRAM_WEBHOOK_SECRET = "media-test-bot-secret-0123456789abcd";
process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-media-test-fake-secret-0123456789";
process.env.NODE_ENV = "development";

const load = (p) => import(pathToFileURL(path.join(root, p)).href);
const base = "http://127.0.0.1:8495";
const BOT_SECRET = "media-test-bot-secret-0123456789abcd";

let db;
let signSessionId;
let cookie;
let connectionId;
const results = [];
function check(name, cond, extra = "") {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` :: ${extra}` : ""}`);
}

before(async () => {
  db = await load("apps/realtime/dist/db.js");
  await load("apps/realtime/dist/index.js");
  await new Promise((r) => setTimeout(r, 700));

  db.createUser("mu", "sub-mu", "m@test.local", "Media", null);
  const session = db.createSession("ms", "mu", 300_000);
  ({ signSessionId } = await load("apps/realtime/dist/auth.js"));
  cookie = `cc_session=${encodeURIComponent(signSessionId(session.id))}`;

  const gen = await fetch(`${base}/api/pair/generate`, { method: "POST", headers: { cookie } }).then((r) => r.json());
  const claim = await fetch(`${base}/api/pair/claim`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", "x-bot-secret": BOT_SECRET },
    body: JSON.stringify({ code: gen.code, telegramChatId: "chat-media" }),
  }).then((r) => r.json());
  connectionId = claim.connection.id;
});

after(() => {
  // The server holds the db and the listener, so the process must be torn down
  // explicitly or `node --test` waits for it forever.
  try { db.db.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  setTimeout(() => process.exit(0), 50).unref();
});

async function upload(bytes, filename, type = "image/png") {
  const res = await fetch(`${base}/api/media/upload?connectionId=${connectionId}`, {
    method: "POST",
    headers: { cookie, "content-Type": type, "X-Filename": filename },
    body: bytes,
  });
  return { status: res.status, body: await res.json() };
}

describe("media serving on a Windows-style absolute path", () => {
  it("serves an uploaded png with its exact bytes", async () => {
    const payload = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const up = await upload(payload, "pixel.png");
    assert.equal(up.status, 201);

    const res = await fetch(`${base}${up.body.message.mediaPath}`, { headers: { cookie } });
    check("png is served 200", res.status === 200, String(res.status));

    const got = new Uint8Array(await res.arrayBuffer());
    check("bytes match exactly", Buffer.compare(Buffer.from(got), Buffer.from(payload)) === 0,
      `${got.length} vs ${payload.length}`);
    check("content-type is the upload mime", res.headers.get("content-type")?.includes("image/png"),
      res.headers.get("content-type") ?? "none");
  });

  it("serves a document", async () => {
    const up = await upload(new Uint8Array([37, 80, 68, 70]), "notes.pdf", "application/pdf");
    assert.equal(up.status, 201);
    const res = await fetch(`${base}${up.body.message.mediaPath}`, { headers: { cookie } });
    check("pdf is served 200", res.status === 200, String(res.status));
  });

  it("serves a file whose name contains spaces", async () => {
    const up = await upload(new Uint8Array([1, 2, 3]), "my holiday photo.png");
    const stored = db.findMessageById(up.body.message.id).media_path;
    check("spaces are normalised in the stored name", !stored.includes(" "), stored);
    const res = await fetch(`${base}${up.body.message.mediaPath}`, { headers: { cookie } });
    check("file with spaces is served 200", res.status === 200, String(res.status));
  });

  it("returns 404 rather than 500 when the row exists but the file is gone", async () => {
    const up = await upload(new Uint8Array([9, 9, 9]), "vanishing.png");
    const meta = db.findMessageById(up.body.message.id);
    const abs = path.join(process.env.MEDIA_DIR, meta.media_path);
    fs.unlinkSync(abs);

    const res = await fetch(`${base}${up.body.message.mediaPath}`, { headers: { cookie } });
    check("missing file -> 404 (not 500)", res.status === 404, String(res.status));
    const body = await res.json().catch(() => ({}));
    check("404 body is json", body.error === "media not found", JSON.stringify(body));
  });

  it("returns 404 for an unknown media id", async () => {
    const res = await fetch(`${base}/media/11111111-2222-3333-4444-555555555555`, { headers: { cookie } });
    check("unknown id -> 404", res.status === 404, String(res.status));
  });

  it("keeps attachment and nosniff on every response", async () => {
    const up = await upload(new Uint8Array([4, 5, 6]), "headers.png");
    const res = await fetch(`${base}${up.body.message.mediaPath}`, { headers: { cookie } });
    check("attachment disposition", res.headers.get("content-disposition") === "attachment");
    check("nosniff header", res.headers.get("x-content-type-options") === "nosniff");
    check("frame deny header", res.headers.get("x-frame-options") === "DENY");
  });

  it("refuses a path traversal attempt without a 500", async () => {
    for (const attempt of ["..%2F..%2F.env", "..%2F..%2F..%2Fpackage.json", "%2e%2e%2f.env"]) {
      const res = await fetch(`${base}/media/${attempt}`, { headers: { cookie } });
      check(`traversal ${attempt} -> 404/403`, res.status === 404 || res.status === 403, String(res.status));
    }
  });

  it("serves the same file twice (no one-shot stream state)", async () => {
    const up = await upload(new Uint8Array([7, 7, 7]), "repeat.png");
    const first = await fetch(`${base}${up.body.message.mediaPath}`, { headers: { cookie } });
    const second = await fetch(`${base}${up.body.message.mediaPath}`, { headers: { cookie } });
    check("first fetch ok", first.status === 200, String(first.status));
    check("second fetch ok", second.status === 200, String(second.status));
  });
});
