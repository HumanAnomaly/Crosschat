// Bot-initiated codes keep their platform (Discord codes paired as Telegram). Run: pnpm test:pair
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pair-"));
process.env.PORT = "8497";
process.env.DATABASE_PATH = path.join(tmp, "pair.db");
process.env.MEDIA_DIR = path.join(tmp, "media");
process.env.SESSION_SECRET = "pair-test-secret-long-enough-0123456789abcd";
process.env.TELEGRAM_WEBHOOK_SECRET = "pair-test-bot-secret-0123456789abcd";
process.env.TELEGRAM_BOT_TOKEN = "";
process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-pair-test-fake-secret-0123456789ab";
process.env.NODE_ENV = "development";

const load = (p) => import(pathToFileURL(path.join(root, p)).href);
const base = "http://127.0.0.1:8497";
const BOT_SECRET = "pair-test-bot-secret-0123456789abcd";
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
  return `cc_session=${encodeURIComponent(signSessionId(s.id))}`;
}
const cookieA = mkUser("pa");
const cookieB = mkUser("pb");
const cookieC = mkUser("pc");
const botHeaders = { "content-type": "application/json", "x-bot-secret": BOT_SECRET };

// 1. Discord creates a code, web claims it -> connection is discord.
const dc = await fetch(`${base}/api/pair/create`, {
  method: "POST", headers: botHeaders,
  body: JSON.stringify({ code: "DDDD-1111", discordChatId: "123456789", platformId: "discord", discordUsername: "discuser" }),
});
check("discord pair/create 201", dc.status === 201, String(dc.status));
const claimDc = await fetch(`${base}/api/pair/claim`, {
  method: "POST", headers: { cookie: cookieA, "content-type": "application/json" },
  body: JSON.stringify({ code: "DDDD-1111" }),
});
const claimDcBody = await claimDc.json();
check("discord code claims 201", claimDc.status === 201, `${claimDc.status} ${JSON.stringify(claimDcBody).slice(0, 120)}`);
check("claimed connection is discord", claimDcBody.connection?.platformId === "discord", claimDcBody.connection?.platformId);
check("discord chat id preserved", claimDcBody.connection?.telegramChatId === "123456789", claimDcBody.connection?.telegramChatId);

// 2. Same numeric id on telegram is a different room (platform-aware, no false conflict).
const tg = await fetch(`${base}/api/pair/create`, {
  method: "POST", headers: botHeaders,
  body: JSON.stringify({ code: "TTTT-2222", telegramChatId: "123456789", telegramUsername: "tguser" }),
});
check("telegram pair/create 201", tg.status === 201, String(tg.status));
const claimTg = await fetch(`${base}/api/pair/claim`, {
  method: "POST", headers: { cookie: cookieB, "content-type": "application/json" },
  body: JSON.stringify({ code: "TTTT-2222" }),
});
const claimTgBody = await claimTg.json();
check("same numeric id pairs on telegram too", claimTg.status === 201, `${claimTg.status}`);
check("telegram connection is telegram", claimTgBody.connection?.platformId === "telegram", claimTgBody.connection?.platformId);

// 3. Telegram code still pairs as telegram (legacy path unchanged).
const tg2 = await fetch(`${base}/api/pair/create`, {
  method: "POST", headers: botHeaders,
  body: JSON.stringify({ code: "TTTT-3333", telegramChatId: "999000111", telegramUsername: "tg2" }),
});
check("second telegram create 201", tg2.status === 201, String(tg2.status));
const claimTg2 = await fetch(`${base}/api/pair/claim`, {
  method: "POST", headers: { cookie: cookieC, "content-type": "application/json" },
  body: JSON.stringify({ code: "TTTT-3333" }),
});
const claimTg2Body = await claimTg2.json();
check("telegram code stays telegram", claimTg2Body.connection?.platformId === "telegram", claimTg2Body.connection?.platformId);

// 4. Room lookup is platform-scoped.
const stD = await fetch(`${base}/api/pair/status?chatId=123456789&platformId=discord`, { headers: { "x-bot-secret": BOT_SECRET } }).then((r) => r.json());
check("discord status wired", stD.wired === true && stD.platformId === "discord", JSON.stringify(stD).slice(0, 80));
const stT = await fetch(`${base}/api/pair/status?telegramChatId=123456789`, { headers: { "x-bot-secret": BOT_SECRET } }).then((r) => r.json());
check("telegram status wired", stT.wired === true, JSON.stringify(stT).slice(0, 80));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
try { db.db.close(); } catch {}
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }); } catch {}
process.exit(failed.length === 0 ? 0 : 1);
