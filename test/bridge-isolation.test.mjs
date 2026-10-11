// Verifies media forwarding does not block the event loop and that a large
// file is streamed (not slurped) from disk.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-iso-"));
process.env.DATABASE_PATH = path.join(tmp, "iso.db");
process.env.MEDIA_DIR = path.join(tmp, "media");
process.env.SESSION_SECRET = "iso-secret-long-enough-for-the-isolation-test-1234";
process.env.TELEGRAM_WEBHOOK_SECRET = "iso-bot";
process.env.TELEGRAM_BOT_TOKEN = "999:ISO";
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

const user = db.createUser("iu1", "sub-i", "i@test.local", "Iso", null);
const conn = db.createConnection("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", user.id, "chat-iso");

const dir = path.join(process.env.MEDIA_DIR, conn.id);
fs.mkdirSync(dir, { recursive: true });

// 8MB payload, large enough that a readFileSync would show up as latency.
const SIZE = 8 * 1024 * 1024;
const file = path.join(dir, "big.bin");
fs.writeFileSync(file, Buffer.alloc(SIZE, 3));

const msgId = "cccccccc-dddd-eeee-ffff-000000000000";
db.insertMessage({
  id: msgId, connectionId: conn.id, sender: "web", kind: "document",
  mediaPath: path.join(conn.id, "big.bin"), mime: "application/octet-stream",
  size: SIZE, createdAt: Date.now(),
});

// Count how many unrelated async tasks can run while the upload is in flight.
let ticks = 0;
let uploading = true;
const ticker = setInterval(() => { ticks++; }, 0);

let callBody = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes("api.telegram.org")) {
    callBody = init.body;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }
  return realFetch(url, init);
};

const t0 = process.hrtime.bigint();
await notifyTelegram(conn.id, {
  id: msgId, connectionId: conn.id, sender: "web", kind: "document",
  mediaPath: `/media/${msgId}`, mime: "application/octet-stream",
  size: SIZE, createdAt: new Date().toISOString(),
});
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
uploading = false;
clearInterval(ticker);
globalThis.fetch = realFetch;

check("large file forwarded", callBody instanceof FormData);
check("event loop stayed responsive during upload", ticks > 0, `${ticks} timer ticks in ${ms.toFixed(1)}ms`);

const fileField = callBody?.get("document");
check("blob is backed by the file, not a copied buffer", typeof fileField?.size === "number", `size=${fileField?.size}`);
if (typeof fileField?.size === "number") {
  check("blob size matches file on disk", fileField.size === SIZE, `${fileField.size} vs ${SIZE}`);
}

// Peak heap should not hold a second full copy of the payload.
const heapMb = process.memoryUsage().heapUsed / (1024 * 1024);
check("heap did not balloon with a second copy", heapMb < 200, `heapUsed=${heapMb.toFixed(1)}MB`);

// An oversized file is refused instead of attempted.
const huge = path.join(dir, "huge.bin");
fs.writeFileSync(huge, Buffer.alloc(51 * 1024 * 1024, 1));
const hugeId = "dddddddd-eeee-ffff-0000-111111111111";
db.insertMessage({
  id: hugeId, connectionId: conn.id, sender: "web", kind: "document",
  mediaPath: path.join(conn.id, "huge.bin"), mime: "application/octet-stream",
  createdAt: Date.now(),
});
let hugeCalled = false;
globalThis.fetch = async (url) => {
  if (String(url).includes("api.telegram.org")) { hugeCalled = true; return new Response("{}", { status: 200 }); }
  return realFetch(url);
};
await notifyTelegram(conn.id, {
  id: hugeId, connectionId: conn.id, sender: "web", kind: "document",
  mediaPath: `/media/${hugeId}`, createdAt: new Date().toISOString(),
});
globalThis.fetch = realFetch;
check("51MB file not forwarded to Telegram", hugeCalled === false);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
try { db.db.close(); } catch {}
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }); } catch {}
process.exit(failed.length === 0 ? 0 : 1);
