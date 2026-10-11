import { Router, type Request, type Response as ExpressResponse } from "express";
import { createPrivateKey, createSign } from "node:crypto";
import { createLogger } from "@crosschat/core";
import { requireAuth } from "./auth.js";
import { config } from "./env.js";
import {
  deletePushSubscription,
  deletePushSubscriptionByEndpoint,
  listPushSubscriptions,
  upsertPushSubscription,
} from "./db.js";
import { userOnline } from "./socket.js";

const log = createLogger("realtime");

export function pushEnabled(): boolean {
  return config.pushVapidPublic.length > 0 && config.pushVapidPrivate.length > 0;
}

function b64url(data: Buffer | string): string {
  return typeof data === "string" ? Buffer.from(data).toString("base64url") : data.toString("base64url");
}

/**
 * VAPID Authorization header for a push endpoint. Payload-less delivery:
 * no message content is encrypted or sent, the ping itself is the signal.
 * Returns null when keys are missing or malformed.
 */
function vapidHeaders(endpoint: string): Record<string, string> | null {
  let pubBytes: Buffer;
  try {
    pubBytes = Buffer.from(config.pushVapidPublic, "base64url");
    if (pubBytes.length !== 65 || pubBytes[0] !== 0x04) return null;
    new URL(endpoint);
  } catch {
    return null;
  }
  const unsigned =
    `${b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }))}.` +
    b64url(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: config.pushSubject,
      }),
    );
  let jwt: string;
  try {
    const key = createPrivateKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: b64url(pubBytes.subarray(1, 33)),
        y: b64url(pubBytes.subarray(33)),
        d: config.pushVapidPrivate,
      },
      format: "jwk",
    });
    const sig = createSign("SHA256").update(unsigned).sign({ key, dsaEncoding: "ieee-p1363" });
    jwt = `${unsigned}.${b64url(sig)}`;
  } catch (err) {
    log.error("vapid sign failed", err);
    return null;
  }
  return {
    Authorization: `vapid t=${jwt}, k=${config.pushVapidPublic}`,
    TTL: "86400",
    Urgency: "normal",
    "Content-Length": "0",
  };
}

async function sendPush(endpoint: string): Promise<boolean> {
  const headers = vapidHeaders(endpoint);
  if (!headers) return false;
  let res: Response;
  try {
    res = (await fetch(endpoint, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(10_000),
    })) as unknown as Response;
  } catch (err) {
    log.error("push send failed", err);
    return false;
  }
  if (res.status === 404 || res.status === 410) {
    try {
      deletePushSubscriptionByEndpoint(endpoint);
    } catch (err) {
      log.error("push prune failed", err);
    }
    return false;
  }
  return res.ok;
}

/**
 * Ping the user's devices about a new inbound message. Skips users with a
 * live socket (they already see it) and no-ops when push is unconfigured.
 */
export async function notifyUserPush(userId: string): Promise<void> {
  if (!pushEnabled() || userOnline(userId)) return;
  let subs;
  try {
    subs = listPushSubscriptions(userId);
  } catch (err) {
    log.error("push list failed", err);
    return;
  }
  await Promise.all(subs.map((s) => sendPush(s.endpoint)));
}

export function createPushRouter(): Router {
  const router = Router();

  router.get("/api/push/config", requireAuth, (_req: Request, res: ExpressResponse) => {
    res.json({ enabled: pushEnabled(), publicKey: pushEnabled() ? config.pushVapidPublic : "" });
  });

  router.post("/api/push/subscribe", requireAuth, (req: Request, res: ExpressResponse) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const keys = (body.keys ?? {}) as Record<string, unknown>;
    const endpoint = body.endpoint;
    const p256dh = keys.p256dh;
    const auth = keys.auth;
    if (typeof endpoint !== "string" || !endpoint.startsWith("https://") || endpoint.length > 2000) {
      res.status(400).json({ error: "valid https endpoint required" });
      return;
    }
    if (typeof p256dh !== "string" || p256dh.length === 0 || typeof auth !== "string" || auth.length === 0) {
      res.status(400).json({ error: "subscription keys required" });
      return;
    }
    try {
      upsertPushSubscription(req.user!.id, endpoint, p256dh, auth);
    } catch (err) {
      log.error("push subscribe failed", err);
      res.status(500).json({ error: "could not save subscription" });
      return;
    }
    res.status(201).json({ ok: true });
  });

  router.delete("/api/push/subscribe", requireAuth, (req: Request, res: ExpressResponse) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.endpoint !== "string") {
      res.status(400).json({ error: "endpoint required" });
      return;
    }
    try {
      deletePushSubscription(req.user!.id, body.endpoint);
    } catch (err) {
      log.error("push unsubscribe failed", err);
      res.status(500).json({ error: "could not delete subscription" });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
