import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { attachSession, createAuthRouter } from "./auth.js";
import { config, allowedOrigins, isProd, repoRoot } from "./env.js";
import { createConfigRouter } from "./config.js";
import { createMediaRouter } from "./media.js";
import { createMessagesRouter } from "./messages.js";
import { createPairingRouter } from "./pairing.js";
import { createDirectRouter } from "./direct.js";
import { createAnonRouter, deleteExpiredAnonQueue } from "./anon.js";
import { createInboundRouters } from "./inbound.js";
import { createPushRouter } from "./push.js";
import { attachSocket, setWebMessageHandler } from "./socket.js";
import { forwardWebMessage } from "./forward.js";
import { createLogger, printBanner } from "@crosschat/core";
import { securityHeaders } from "./security.js";
import { deleteExpiredCodes, deleteExpiredSessions } from "./db.js";

const log = createLogger("realtime");

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(securityHeaders);
app.use(cors({ origin: allowedOrigins(), credentials: true }));
app.use(cookieParser());
app.post("/api/telegram/webhook", express.raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
  try {
    const upstream = await fetch(`${config.telegramServiceUrl}/api/telegram/webhook`, {
      method: "POST",
      headers: {
        "content-type": req.get("content-type") ?? "application/json",
        "x-telegram-bot-api-secret-token": req.get("x-telegram-bot-api-secret-token") ?? "",
      },
      body: req.body as unknown as BodyInit,
    });
    res.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    res.status(502).json({ error: "telegram service unreachable" });
  }
});

const json1mb = express.json({ limit: "1mb" });
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === "/api/telegram/inbound" || req.path === "/api/discord/inbound" || req.path === "/api/whatsapp/inbound") return next();
  return json1mb(req, res, next);
});
app.use(attachSession);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use(createAuthRouter());
app.use(createConfigRouter());
app.use(createPairingRouter());
app.use(createDirectRouter());
app.use(createAnonRouter());
app.use(createInboundRouters());
app.use(createPushRouter());
app.use(createMediaRouter());
app.use(createMessagesRouter());

const webDist = path.join(repoRoot, "apps", "web", "dist");
if (!isProd) {
  // Dev: the UI lives on the vite server. Bounce browser traffic there so
  // there is exactly one UI origin and nobody reads a stale dist build.
  app.get(/^(?!\/api\/|\/media\/|\/socket\.io\/).*/, (req, res) => {
    res.redirect(`${config.webUrlLocal}${req.originalUrl}`);
  });
} else if (fs.existsSync(webDist)) {
  app.use(express.static(webDist, { maxAge: "1h", index: false }));
  app.get(/^(?!\/api\/|\/media\/|\/socket\.io\/).*/, (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const e = err as { status?: number; type?: string };
  if (e?.type === "entity.too.large") {
    res.status(413).json({ error: "payload too large" });
    return;
  }
  if (e?.status === 400) {
    res.status(400).json({ error: "invalid json" });
    return;
  }
  log.error("unhandled error", err);
  if (!res.headersSent) res.status(500).json({ error: "internal error" });
});

setInterval(() => {
  try {
    deleteExpiredSessions();
    deleteExpiredCodes();
    deleteExpiredAnonQueue();
  } catch (err) {
    log.error("cleanup failed", err);
  }
}, 5 * 60 * 1000).unref?.();

const httpServer = createServer(app);
attachSocket(httpServer);
setWebMessageHandler(forwardWebMessage);

httpServer.listen(config.port, () => {
  printBanner("realtime", [["port", String(config.port)]]);
});
