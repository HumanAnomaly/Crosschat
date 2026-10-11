// Direct P2P bridge: telegram <-> discord without web. Run: node test/direct.test.mjs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-direct-"));
process.env.PORT = "8499";
process.env.DATABASE_PATH = path.join(tmp, "direct.db");
process.env.MEDIA_DIR = path.join(tmp, "media");
process.env.SESSION_SECRET = "direct-test-secret-long-enough-0123456789abcd";
process.env.TELEGRAM_WEBHOOK_SECRET = "direct-test-bot-secret-0123456789abcd";
process.env.TELEGRAM_BOT_TOKEN = "12345:FAKE-DIRECT-TEST";
process.env.DISCORD_BOT_TOKEN = "FAKE.DISCORD.TOKEN";
process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-direct-test-fake-secret-0123456789ab";
process.env.NODE_ENV = "development";

const load = (p) => import(pathToFileURL(path.join(root, p)).href);
const base = "http://127.0.0.1:8499";
const BOT_SECRET = "direct-test-bot-secret-0123456789abcd";
const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` :: ${extra}` : ""}`);
};

const db = await load("apps/realtime/dist/db.js");
await load("apps/realtime/dist/index.js");
await new Promise((r) => setTimeout(r, 700));

const botHeaders = { "content-type": "application/json", "x-bot-secret": BOT_SECRET };

// Capture outbound peer sends, pass localhost through.
const peerCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith("https://api.telegram.org/bot")) {
    peerCalls.push({ url: u, init });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 777 } }), { status: 200 });
  }
  if (u.startsWith("https://discord.com/api/v10/")) {
    peerCalls.push({ url: u, init });
    if (u.includes("/users/@me/channels")) {
      return new Response(JSON.stringify({ id: "dm-chan-1" }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: "discord-msg-1" }), { status: 200 });
  }
  if (u.includes("/api/whatsapp/send") || u.includes("/api/whatsapp/delete")) {
    peerCalls.push({ url: u, init });
    return new Response(JSON.stringify({ ok: true, whatsappMessageId: "wa-msg-1", id: "wa-msg-1" }), { status: 200 });
  }
  return realFetch(url, init);
};

// 1. Telegram creates a code (initiator).
const create = await fetch(`${base}/api/pair/create`, {
  method: "POST", headers: botHeaders,
  body: JSON.stringify({ code: "DIRC-0001", telegramChatId: "tg-111", telegramUsername: "tguser" }),
});
check("telegram pair/create 201", create.status === 201, String(create.status));

// 2. Discord claims it via direct (P2P, no web).
const claim = await fetch(`${base}/api/direct/claim`, {
  method: "POST", headers: botHeaders,
  body: JSON.stringify({ code: "DIRC-0001", discordChatId: "dc-222", platformId: "discord", discordUsername: "discuser" }),
});
const claimBody = await claim.json().catch(() => ({}));
check("discord direct/claim 201", claim.status === 201, `${claim.status} ${JSON.stringify(claimBody).slice(0, 120)}`);
check("link has both sides", claimBody.link?.aChat === "tg-111" && claimBody.link?.bChat === "dc-222", JSON.stringify(claimBody.link ?? {}));

// 3. Reusing the same code fails.
const reuse = await fetch(`${base}/api/direct/claim`, {
  method: "POST", headers: botHeaders,
  body: JSON.stringify({ code: "DIRC-0001", discordChatId: "dc-333", platformId: "discord" }),
});
check("code reuse rejected", reuse.status === 404, String(reuse.status));

// 4. Cannot link to self.
await fetch(`${base}/api/pair/create`, {
  method: "POST", headers: botHeaders,
  body: JSON.stringify({ code: "DIRC-0002", telegramChatId: "tg-111", telegramUsername: "tguser" }),
});
const selfLink = await fetch(`${base}/api/direct/claim`, {
  method: "POST", headers: botHeaders,
  body: JSON.stringify({ code: "DIRC-0002", telegramChatId: "tg-111" }),
});
check("self-link rejected", selfLink.status === 400, String(selfLink.status));

// 5. Status shows wired on both sides (so bots treat it as linked).
const stTg = await fetch(`${base}/api/pair/status?telegramChatId=tg-111`, { headers: { "x-bot-secret": BOT_SECRET } }).then((r) => r.json());
check("telegram status wired via direct", stTg.wired === true && stTg.mode === "direct", JSON.stringify(stTg).slice(0, 100));
const stDc = await fetch(`${base}/api/pair/status?chatId=dc-222&platformId=discord`, { headers: { "x-bot-secret": BOT_SECRET } }).then((r) => r.json());
check("discord status wired via direct", stDc.wired === true && stDc.mode === "direct", JSON.stringify(stDc).slice(0, 100));

// 6. Telegram -> Discord text forwards without a web connection.
peerCalls.length = 0;
const inboundTg = await fetch(`${base}/api/telegram/inbound`, {
  method: "POST", headers: botHeaders,
  body: JSON.stringify({ chatId: "tg-111", kind: "text", text: "halo discord", telegramUsername: "tguser", platformMsgId: "5001" }),
});
check("tg inbound 201 (no web needed)", inboundTg.status === 201, String(inboundTg.status));
await new Promise((r) => setTimeout(r, 400));
const toDiscord = peerCalls.find((c) => c.url.includes("/channels/dm-chan-1/messages"));
check("tg text reaches discord", !!toDiscord, peerCalls.map((c) => c.url.split("/").pop()).join(",") || "no calls");

// 7. Discord -> Telegram text forwards back.
peerCalls.length = 0;
const inboundDc = await fetch(`${base}/api/discord/inbound`, {
  method: "POST", headers: botHeaders,
  body: JSON.stringify({ chatId: "dc-222", kind: "text", text: "halo telegram", discordUsername: "discuser", platformMsgId: "dc-msg-9" }),
});
check("discord inbound 201", inboundDc.status === 201, String(inboundDc.status));
await new Promise((r) => setTimeout(r, 400));
const toTelegram = peerCalls.find((c) => c.url.includes("sendMessage"));
check("discord text reaches telegram", !!toTelegram, peerCalls.map((c) => c.url.split("/").pop()).join(",") || "no calls");

// 8. Delete propagates through the direct mapping.
const del = await fetch(`${base}/api/telegram/delete`, {
  method: "POST", headers: botHeaders,
  body: JSON.stringify({ chatId: "tg-111", platformMsgId: "5001" }),
});
const delBody = await del.json().catch(() => ({}));
check("direct delete ok", del.status === 200 && delBody.deleted === true, `${del.status} ${JSON.stringify(delBody).slice(0, 80)}`);

// 9. Disconnect from one side clears the link (peer status unwired).
const disc = await fetch(`${base}/api/pair/disconnect`, {
  method: "POST", headers: botHeaders,
  body: JSON.stringify({ telegramChatId: "tg-111" }),
});
check("disconnect 200", disc.status === 200, String(disc.status));
const stAfter = await fetch(`${base}/api/pair/status?chatId=dc-222&platformId=discord`, { headers: { "x-bot-secret": BOT_SECRET } }).then((r) => r.json());
check("peer unwired after disconnect", stAfter.wired === false, JSON.stringify(stAfter).slice(0, 60));
const inboundAfter = await fetch(`${base}/api/telegram/inbound`, {
  method: "POST", headers: botHeaders,
  body: JSON.stringify({ chatId: "tg-111", kind: "text", text: "should fail" }),
});
check("inbound 404 after disconnect", inboundAfter.status === 404, String(inboundAfter.status));

globalThis.fetch = realFetch;
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
try { db.db.close(); } catch {}
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }); } catch {}
process.exit(failed.length === 0 ? 0 : 1);
