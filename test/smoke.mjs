// Smoke test: boots the built realtime server on a scratch port/db and
// exercises auth, pairing, media authorization and the fixed media path.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-smoke-"));
const load = (p) => import(pathToFileURL(path.join(root, p)).href);
process.env.PORT = "8477";
process.env.DATABASE_PATH = path.join(tmp, "smoke.db");
process.env.MEDIA_DIR = path.join(tmp, "media");
process.env.SESSION_SECRET = "smoke-test-secret-that-is-long-enough-1234567890";
process.env.TELEGRAM_WEBHOOK_SECRET = "smoke-bot-secret";
// Neutralise the real .env values: the startup guard rejects exposed secrets.
process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-test-fake-secret-0123456789abcdefghij";
process.env.TELEGRAM_BOT_TOKEN = "999999:AAHsmoke-test-token-not-a-real-credential";
process.env.NODE_ENV = "development";

const base = "http://127.0.0.1:8477";
const results = [];
function check(name, cond, extra = "") {
  results.push({ name, ok: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` :: ${extra}` : ""}`);
}

// Import server modules after env is set (db export gives us the connection).
const db = await load("apps/realtime/dist/db.js");
const Database = db.db.constructor;
await load("apps/realtime/dist/index.js");
await new Promise((r) => setTimeout(r, 700));

// Insert a user + session directly so we can exercise authenticated routes.
const raw = new Database(process.env.DATABASE_PATH);
raw.prepare("INSERT INTO users (id, google_sub, email, name, picture, created_at) VALUES (?,?,?,?,?,?)")
  .run("u1", "gsub1", "a@b.c", "Alice", null, Date.now());
const sess = db.createSession("sess-1", "u1", 60_000);
const { signSessionId } = await load("apps/realtime/dist/auth.js");
const cookie = `cc_session=${encodeURIComponent(signSessionId(sess.id))}`;

async function req(p, opts = {}) {
  const res = await fetch(base + p, { ...opts, headers: { cookie, ...(opts.headers ?? {}) } });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, json, text, headers: res.headers };
}

// 1. health
check("health ok", (await req("/api/health")).status === 200);

// 2. auth guard
check("connection requires auth", (await fetch(base + "/api/connection")).status === 401);

// 3. me
const me = await req("/api/auth/me");
check("auth/me returns user", me.json?.user?.id === "u1", JSON.stringify(me.json));

// 4. generate code (web-initiated)
const gen = await req("/api/pair/generate", { method: "POST" });
check("pair/generate returns code", /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(gen.json?.code ?? ""), gen.json?.code);
const webCode = gen.json.code;

// 5. bot claims web code
const bot = { "content-type": "application/json", "x-bot-secret": "smoke-bot-secret" };
const claim1 = await req("/api/pair/claim", {
  method: "POST", headers: bot,
  body: JSON.stringify({ code: webCode, telegramChatId: "chat-1", telegramUsername: "@alice" }),
});
check("bot claims web code", claim1.status === 201 && !!claim1.json?.connection?.id, JSON.stringify(claim1.json));

// 6. replay claim rejected
const claim2 = await req("/api/pair/claim", {
  method: "POST", headers: bot,
  body: JSON.stringify({ code: webCode, telegramChatId: "chat-2" }),
});
check("used code cannot be replayed", claim2.status === 404, String(claim2.status));

// 7. second user cannot claim foreign code
raw.prepare("INSERT INTO users (id, google_sub, email, created_at) VALUES (?,?,?,?)").run("u2", "gsub2", "x@y.z", Date.now());
const s2 = db.createSession("sess-2", "u2", 60_000);
const cookie2 = `cc_session=${encodeURIComponent(signSessionId(s2.id))}`;
const gen2 = await fetch(base + "/api/pair/generate", {
  method: "POST", headers: { cookie: cookie2 },
});
const gen2Json = await gen2.json();
// u2 owns this code but u2 has no connection yet; u1 already does -> claim as
// u1 must be refused as a foreign code (403), not silently succeed.
const foreign = await fetch(base + "/api/pair/claim", {
  method: "POST",
  headers: { cookie, "content-type": "application/json" },
  body: JSON.stringify({ code: gen2Json.code }),
});
check("other user's code -> 403", foreign.status === 403, String(foreign.status));

// 8. media: upload then fetch as owner
const conn = claim1.json.connection.id;
const up = await fetch(`${base}/api/media/upload?connectionId=${conn}`, {
  method: "POST", headers: { cookie, "content-type": "image/png", "X-Filename": "my%20photo.png" },
  body: Buffer.from([1, 2, 3, 4]),
});
const upJson = await up.json();
check("media upload 201", up.status === 201, JSON.stringify(upJson));
check("media path is /media/<id>", upJson?.message?.mediaPath === `/media/${upJson?.message?.id}`, upJson?.message?.mediaPath);

const relStored = db.findMessageById(upJson.message.id).media_path;
check("filename decoded (space kept as _)", relStored.endsWith("my_photo.png"), relStored);

// 9. owner can fetch media
const get = await fetch(`${base}${upJson.message.mediaPath}`, { headers: { cookie } });
check("owner fetches media 200", get.status === 200, String(get.status));
check("media served as attachment", get.headers.get("content-disposition") === "attachment", get.headers.get("content-disposition"));
check("nosniff header", get.headers.get("x-content-type-options") === "nosniff");

// 10. other user forbidden
const other = await fetch(`${base}${upJson.message.mediaPath}`, { headers: { cookie: cookie2 } });
check("non-owner media 403", other.status === 403, String(other.status));

// 11. traversal attempt
const trav = await fetch(`${base}/media/..%2F..%2F.env`, { headers: { cookie } });
check("traversal blocked (404/403)", trav.status === 404 || trav.status === 403, String(trav.status));

// 12. SVG rejected
const svg = await fetch(`${base}/api/media/upload?connectionId=${conn}`, {
  method: "POST", headers: { cookie, "content-type": "image/svg+xml", "X-Filename": "x.svg" },
  body: "<svg onload=alert(1)>",
});
check("svg upload rejected 415", svg.status === 415, String(svg.status));

// 13. telegram inbound without secret
const noSecret = await fetch(`${base}/api/telegram/inbound`, {
  method: "POST", headers: { cookie, "content-type": "application/json" },
  body: JSON.stringify({ chatId: "chat-1", kind: "text", text: "hi" }),
});
check("inbound without bot secret 401", noSecret.status === 401, String(noSecret.status));

// 14. telegram inbound with secret (text)
const inb = await fetch(`${base}/api/telegram/inbound`, {
  method: "POST", headers: bot,
  body: JSON.stringify({ chatId: "chat-1", kind: "text", text: "hello from tg" }),
});
check("telegram inbound 201", inb.status === 201, String(inb.status));

// 15. connection list shows messages, media contract respected
const list = await req("/api/connection");
check("connection lists messages", (list.json?.messages?.length ?? 0) >= 2, String(list.json?.messages?.length));
const mediaMsg = list.json.messages.find((m) => m.mediaPath);
check("list mediaPath uses /media/<id>", mediaMsg?.mediaPath === `/media/${mediaMsg?.id}`);

// 16. bot status endpoint
const st = await req("/api/pair/status?telegramChatId=chat-1", { headers: bot });
check("pair/status wired true", st.json?.wired === true, JSON.stringify(st.json?.stats));

// 17. pair/status unauthorized
const stBad = await fetch(`${base}/api/pair/status?telegramChatId=chat-1`);
check("pair/status needs bot secret", stBad.status === 401, String(stBad.status));

// 18. TG-initiated code claimed from web
const create = await req("/api/pair/create", {
  method: "POST", headers: bot,
  body: JSON.stringify({ code: "ZZZZ-9999", telegramChatId: "chat-9", telegramUsername: "bob" }),
});
check("pair/create 201", create.status === 201, String(create.status));
raw.prepare("INSERT INTO users (id, google_sub, email, created_at) VALUES (?,?,?,?)").run("u3", "gsub3", "c@d.e", Date.now());
const s3 = db.createSession("sess-3", "u3", 60_000);
const cookie3 = `cc_session=${encodeURIComponent(signSessionId(s3.id))}`;
const claimWeb = await fetch(`${base}/api/pair/claim`, {
  method: "POST", headers: { cookie: cookie3, "content-type": "application/json" },
  body: JSON.stringify({ code: "zzzz9999" }),
});
const claimWebJson = await claimWeb.json();
check("web claims tg code (normalizes)", claimWeb.status === 201 && claimWebJson?.connection?.telegramChatId === "chat-9", JSON.stringify(claimWebJson));

// 19. same user, different chat -> conflict
const create2 = await req("/api/pair/create", {
  method: "POST", headers: bot, body: JSON.stringify({ code: "YYYY-8888", telegramChatId: "chat-10" }),
});
check("pair/create 2 201", create2.status === 201);
const conflict = await fetch(`${base}/api/pair/claim`, {
  method: "POST", headers: { cookie: cookie3, "content-type": "application/json" },
  body: JSON.stringify({ code: "YYYY-8888" }),
});
check("same user already connected -> 409", conflict.status === 409, String(conflict.status));

// 20. disconnect removes media files
const dis = await req("/api/connection", { method: "DELETE" });
check("disconnect ok", dis.status === 200, String(dis.status));
const dir = path.join(process.env.MEDIA_DIR, conn);
check("media dir removed on disconnect", !fs.existsSync(dir), dir);

// 21. json error is JSON not HTML for bad payload
const bad = await req("/api/pair/claim", { method: "POST", headers: { "content-type": "application/json" }, body: "{oops" });
check("malformed json -> 400 json", bad.status === 400 && bad.json?.error !== undefined, bad.text.slice(0, 80));

// 22. REGRESSION: inbound photo ~2MB as base64 must pass (global limit is 1mb).
const big = Buffer.alloc(2 * 1024 * 1024, 7).toString("base64");
const bigRes = await req("/api/telegram/inbound", {
  method: "POST", headers: bot,
  body: JSON.stringify({ chatId: "chat-9", kind: "photo", fileBase64: big, filename: "big.png", mime: "image/png" }),
});
check("2MB inbound photo accepted (was blocked by 1mb limit)", bigRes.status === 201, `${bigRes.status} ${bigRes.text.slice(0, 90)}`);

// 23. over-limit inbound -> 413 as JSON, not HTML
const overRes = await req("/api/telegram/inbound", {
  method: "POST", headers: bot,
  body: JSON.stringify({ chatId: "chat-9", kind: "photo", fileBase64: Buffer.alloc(21 * 1024 * 1024, 7).toString("base64") }),
});
check("over-30mb inbound -> 413 json", overRes.status === 413 && overRes.json?.error !== undefined, `${overRes.status} ${overRes.text.slice(0, 60)}`);

raw.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
try {
  db.db.close();
} catch {
  // already closed
}
try {
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
} catch {
  // server may still hold the db file; temp dir is disposable
}
process.exit(failed.length === 0 ? 0 : 1);
