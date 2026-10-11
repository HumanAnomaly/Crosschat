import * as arctic from "arctic";
import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import {
  createSession,
  createUser,
  deleteSession,
  deleteExpiredSessions,
  findSession,
  findUserById,
  findUserBySub,
  updateUserProfile,
} from "./db.js";
import { appBaseUrl, config, webBaseUrl } from "./env.js";

export const SESSION_COOKIE = "cc_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OAUTH_STATE_COOKIE = "cc_oauth_state";
const OAUTH_VERIFIER_COOKIE = "cc_oauth_verifier";

export interface SessionUser {
  id: string;
  email: string | null;
  name: string | null;
  picture: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export function signSessionId(id: string): string {
  const sig = crypto.createHmac("sha256", config.sessionSecret).update(id).digest("hex");
  return `${id}.${sig}`;
}

export function parseSignedSessionId(value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = crypto.createHmac("sha256", config.sessionSecret).update(id).digest("hex");
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return id;
}

export function resolveSessionUser(signedValue: string | undefined): SessionUser | null {
  const id = parseSignedSessionId(signedValue);
  if (!id) return null;
  const session = findSession(id);
  if (!session || session.expires_at < Date.now()) {
    if (session) deleteSession(id);
    return null;
  }
  const user = findUserById(session.user_id);
  if (!user) {
    deleteSession(id);
    return null;
  }
  return { id: user.id, email: user.email, name: user.name, picture: user.picture };
}

export function attachSession(req: Request, _res: Response, next: NextFunction): void {
  const user = resolveSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (user) req.user = user;
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "login required" });
    return;
  }
  next();
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.isProd,
    path: "/",
    maxAge: SESSION_TTL_MS,
  };
}

function oauthCookieOptions() {
  return { ...sessionCookieOptions(), maxAge: 10 * 60 * 1000 };
}

function googleClient(): arctic.Google {
  return new arctic.Google(
    config.googleClientId,
    config.googleClientSecret,
    `${appBaseUrl()}/api/auth/callback/google`,
  );
}


interface GoogleUserInfo {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

export function createAuthRouter(): Router {
  const router = Router();
  router.use(cookieParser());

  router.get("/api/auth/login", (req: Request, res: Response) => {
    if (!config.googleClientId || !config.googleClientSecret) {
      res.status(500).json({ error: "google oauth not configured" });
      return;
    }
    const state = arctic.generateState();
    const codeVerifier = arctic.generateCodeVerifier();
    const url = googleClient().createAuthorizationURL(state, codeVerifier, [
      "openid",
      "profile",
      "email",
    ]);
    url.searchParams.set("access_type", "offline");
    res.cookie(OAUTH_STATE_COOKIE, state, oauthCookieOptions());
    res.cookie(OAUTH_VERIFIER_COOKIE, codeVerifier, oauthCookieOptions());
    res.redirect(url.toString());
  });

  router.get("/api/auth/callback/google", async (req: Request, res: Response) => {
    const code = req.query.code;
    const state = req.query.state;
    const storedState = req.cookies?.[OAUTH_STATE_COOKIE];
    const codeVerifier = req.cookies?.[OAUTH_VERIFIER_COOKIE];
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/" });
    res.clearCookie(OAUTH_VERIFIER_COOKIE, { path: "/" });
    if (typeof code !== "string" || typeof state !== "string" || !storedState || !codeVerifier) {
      res.status(400).json({ error: "invalid oauth callback" });
      return;
    }
    if (state !== storedState) {
      res.status(400).json({ error: "state mismatch" });
      return;
    }
    let tokens: arctic.OAuth2Tokens;
    try {
      tokens = await googleClient().validateAuthorizationCode(code, codeVerifier);
    } catch {
      res.status(400).json({ error: "authorization code exchange failed" });
      return;
    }
    let info: GoogleUserInfo;
    try {
      const resp = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${tokens.accessToken()}` },
      });
      if (!resp.ok) throw new Error(`userinfo status ${resp.status}`);
      info = (await resp.json()) as GoogleUserInfo;
    } catch {
      res.status(502).json({ error: "failed to fetch google profile" });
      return;
    }
    if (!info.sub) {
      res.status(502).json({ error: "google profile missing subject" });
      return;
    }
    let user = findUserBySub(info.sub);
    const email = info.email ?? null;
    const name = info.name ?? null;
    const picture = info.picture ?? null;
    if (!user) user = createUser(randomUUID(), info.sub, email, name, picture);
    else updateUserProfile(user.id, email, name, picture);
    deleteExpiredSessions();
    const session = createSession(randomUUID(), user.id, SESSION_TTL_MS);
    res.cookie(SESSION_COOKIE, signSessionId(session.id), sessionCookieOptions());
    // Back to the UI origin (vite in dev, same origin in prod). The callback
    // itself must stay on appBaseUrl because Google registered that URL.
    res.redirect(`${webBaseUrl()}/`);
  });

  router.get("/api/auth/me", requireAuth, (req: Request, res: Response) => {
    res.json({ user: req.user });
  });


  router.post("/api/auth/logout", (req: Request, res: Response) => {
    const id = parseSignedSessionId(req.cookies?.[SESSION_COOKIE]);
    if (id) deleteSession(id);
    res.clearCookie(SESSION_COOKIE, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: config.isProd,
    });
    res.json({ ok: true });
  });

  return router;
}
