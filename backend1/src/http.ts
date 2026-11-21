import { randomBytes, randomUUID } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import {
  hashPassword,
  hashResetToken,
  issueToken,
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_RE,
  verifyPassword,
  verifyToken,
} from "./auth.ts";
import { config } from "./config.ts";
import { repo, type GameRecord, type Session, type User } from "./db.ts";
import { emailService } from "./email.ts";
import type { GameManager } from "./GameManager.ts";
import { log } from "./logger.ts";
import { createAuthorizationRequest, exchangeAndVerifyCode } from "./oauth.ts";
import { KEYS, rateLimited, redis } from "./redis.ts";

type Json = Record<string, unknown> | unknown[];

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MAX_BODY = 4 * 1024;
const AUTH_WINDOW_MS = 60_000;
const AUTH_MAX_PER_WINDOW = 20;

/** Real client IP. Behind Vercel/Railway the socket address is the proxy, so use the first X-Forwarded-For hop. */
function clientIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
  return (config.trustProxy && first) || req.socket.remoteAddress || "unknown";
}

/** Cluster-wide (Redis) limit so attempts can't be spread across instances. */
async function rateLimitAuth(req: IncomingMessage): Promise<void> {
  const ip = clientIp(req);
  if (await rateLimited("auth", ip, AUTH_MAX_PER_WINDOW, AUTH_WINDOW_MS)) {
    throw new HttpError(429, "Too many attempts. Try again in a minute.");
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "Request too large");
    chunks.push(chunk as Buffer);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new HttpError(400, "Invalid JSON body");
}

function send(res: ServerResponse, status: number, body: Json): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

const ok = (res: ServerResponse, data: unknown) => send(res, 200, { ok: true, data });

async function authSession(req: IncomingMessage): Promise<{ user: User; session: Session }> {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const verified = verifyToken(token);
  if (!verified) throw new HttpError(401, "Please sign in again.");

  const user = await repo.findUserById(verified.userId);
  if (!user) throw new HttpError(401, "User not found.");

  if (verified.sessionId) {
    const active = await repo.isSessionActive(verified.sessionId);
    if (!active) throw new HttpError(401, "Session has been revoked or expired.");
    const sess = await repo.findSession(verified.sessionId);
    if (!sess) throw new HttpError(401, "Session not found.");
    return { user, session: sess };
  }

  // Fallback for legacy tokens without sessionId
  const expiresAt = Date.now() + config.tokenTtlMs;
  const sess = await repo.createSession(randomUUID(), user.id, expiresAt, clientIp(req), (req.headers["user-agent"] as string) ?? null);
  return { user, session: sess };
}

async function authUser(req: IncomingMessage): Promise<User> {
  const { user } = await authSession(req);
  return user;
}

function credentials(body: Record<string, unknown>): { username: string; password: string } {
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!USERNAME_RE.test(username)) throw new HttpError(400, "Username must be 3–20 letters, numbers or underscores.");
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new HttpError(400, `Password must be at least ${PASSWORD_MIN} characters.`);
  }
  return { username, password };
}

async function createAuthSession(user: User, req: IncomingMessage) {
  const expiresAt = Date.now() + config.tokenTtlMs;
  const sess = await repo.createSession(randomUUID(), user.id, expiresAt, clientIp(req), (req.headers["user-agent"] as string) ?? null);
  const token = issueToken(user.id, sess.id);
  return { token, user };
}

const gameSummary = (g: GameRecord) => {
  const { moves, pgn, ...rest } = g;
  return { ...rest, plies: moves.length };
};

type Handler = (req: IncomingMessage, res: ServerResponse, params: string[]) => Promise<void> | void;

export function createHttpHandler(manager: GameManager) {
  const routes: [string, RegExp, Handler][] = [
    ["POST", /^\/api\/auth\/signup$/, async (req, res) => {
      await rateLimitAuth(req);
      const { username, password } = credentials(await readJson(req));
      if (/^guest_/i.test(username)) throw new HttpError(400, "That username is reserved.");
      const user = await repo.createUser(randomUUID(), username, await hashPassword(password));
      if (!user) throw new HttpError(409, "That username is taken.");
      ok(res, await createAuthSession(user, req));
    }],
    ["POST", /^\/api\/auth\/login$/, async (req, res) => {
      await rateLimitAuth(req);
      const body = await readJson(req);
      const username = typeof body.username === "string" ? body.username.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const creds = username && password ? await repo.findCredentials(username) : null;
      if (!creds || !(await verifyPassword(password, creds.passwordHash))) {
        throw new HttpError(401, "Wrong username or password.");
      }
      const user = await repo.findUserById(creds.id);
      if (!user) throw new HttpError(401, "Wrong username or password.");
      ok(res, await createAuthSession(user, req));
    }],
    ["POST", /^\/api\/auth\/guest$/, async (req, res) => {
      await rateLimitAuth(req);
      for (let i = 0; i < 5; i++) {
        const user = await repo.createUser(randomUUID(), `Guest_${Math.floor(Math.random() * 1e6)}`, null);
        if (user) return ok(res, await createAuthSession(user, req));
      }
      throw new HttpError(503, "Could not create a guest account. Try again.");
    }],
    ["POST", /^\/api\/auth\/ticket$/, async (req, res) => {
      const { user, session } = await authSession(req);
      const ticket = randomUUID();
      const ttlSeconds = Math.max(1, Math.ceil(config.ticketTtlMs / 1000));
      await redis.set(
        KEYS.ticket(ticket),
        JSON.stringify({ userId: user.id, sessionId: session.id }),
        "EX",
        ttlSeconds,
      );
      ok(res, { ticket, expiresIn: ttlSeconds });
    }],
    ["POST", /^\/api\/auth\/logout$/, async (req, res) => {
      const { user, session } = await authSession(req);
      await repo.revokeSession(session.id);
      await manager.revokeUserSessions(user.id, session.id);
      ok(res, { message: "Logged out successfully" });
    }],
    ["POST", /^\/api\/auth\/logout-all$/, async (req, res) => {
      const { user } = await authSession(req);
      await repo.revokeAllUserSessions(user.id);
      await manager.revokeUserSessions(user.id);
      ok(res, { message: "All sessions logged out successfully" });
    }],
    ["GET", /^\/api\/auth\/google$/, async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const authReq = await createAuthorizationRequest();
      if (url.searchParams.get("format") === "json") {
        return ok(res, { url: authReq.url });
      }
      res.writeHead(302, { Location: authReq.url });
      res.end();
    }],
    ["GET", /^\/api\/auth\/google\/callback$/, async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(302, { Location: `${config.frontendUrl}/auth?error=${encodeURIComponent(error)}` });
        res.end();
        return;
      }
      if (!code || !state) {
        res.writeHead(302, { Location: `${config.frontendUrl}/auth?error=${encodeURIComponent("Missing authorization code or state")}` });
        res.end();
        return;
      }

      try {
        const payload = await exchangeAndVerifyCode(code, state);
        if (!payload.sub) {
          throw new Error("Invalid ID token: missing sub");
        }

        let user: User | null = null;
        const identity = await repo.findProviderIdentity("google", payload.sub);
        if (identity) {
          user = await repo.findUserById(identity.userId);
        } else if (payload.email && payload.emailVerified) {
          // Auto-link if verified email matches existing account
          const existingUser = await repo.findUserByEmail(payload.email);
          if (existingUser) {
            await repo.createProviderIdentity(randomUUID(), existingUser.id, "google", payload.sub, payload.email, payload.emailVerified);
            user = existingUser;
          }
        }

        if (!user) {
          let baseName = ((payload.name || (payload.email ? payload.email.split("@")[0] : "Player")) ?? "Player")
            .replace(/[^a-zA-Z0-9_]/g, "_")
            .slice(0, 15);
          if (baseName.length < 3) baseName = `user_${baseName}`;
          let created: User | null = null;
          for (let i = 0; i < 5; i++) {
            const candidate = i === 0 ? baseName : `${baseName}_${Math.floor(Math.random() * 1000)}`;
            created = await repo.createUser(randomUUID(), candidate, null, payload.email ?? undefined);
            if (created) break;
          }
          if (!created) {
            throw new Error("Failed to generate unique username for OAuth account");
          }
          await repo.createProviderIdentity(randomUUID(), created.id, "google", payload.sub, payload.email, payload.emailVerified);
          user = created;
        }

        const authData = await createAuthSession(user, req);
        res.writeHead(302, {
          Location: `${config.frontendUrl}/auth/callback?token=${encodeURIComponent(authData.token)}`,
        });
        res.end();
      } catch (err: any) {
        log.error("Google OAuth callback error", err);
        res.writeHead(302, {
          Location: `${config.frontendUrl}/auth?error=${encodeURIComponent(err.message || "OAuth authentication failed")}`,
        });
        res.end();
      }
    }],
    ["POST", /^\/api\/auth\/forgot-password$/, async (req, res) => {
      await rateLimitAuth(req);
      const body = await readJson(req);
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (email && email.includes("@")) {
        const user = await repo.findUserByEmail(email);
        if (user) {
          const rawToken = randomBytes(32).toString("hex");
          const hashed = hashResetToken(rawToken);
          const expiresAt = Date.now() + config.resetTokenTtlMs;
          await repo.createPasswordResetToken(randomUUID(), user.id, hashed, expiresAt);
          const resetUrl = `${config.frontendUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
          await emailService.sendPasswordResetEmail(user.email ?? email, resetUrl);
        }
      }
      ok(res, { message: "If that email is registered, a password reset link has been sent." });
    }],
    ["POST", /^\/api\/auth\/reset-password$/, async (req, res) => {
      await rateLimitAuth(req);
      const body = await readJson(req);
      const token = typeof body.token === "string" ? body.token.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!token) throw new HttpError(400, "Reset token is required.");
      if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
        throw new HttpError(400, `Password must be at least ${PASSWORD_MIN} characters.`);
      }

      const hashed = hashResetToken(token);
      const tokenRecord = await repo.findValidResetToken(hashed);
      if (!tokenRecord) {
        throw new HttpError(400, "Invalid or expired reset token.");
      }

      const newHash = await hashPassword(password);
      await repo.consumeResetTokenAndSetPassword(tokenRecord.id, tokenRecord.userId, newHash);

      await repo.revokeAllUserSessions(tokenRecord.userId);
      await manager.revokeUserSessions(tokenRecord.userId);

      ok(res, { message: "Password updated successfully. You can now sign in with your new password." });
    }],
    ["GET", /^\/api\/me$/, async (req, res) => ok(res, await authUser(req))],
    ["PATCH", /^\/api\/me$/, async (req, res) => {
      const user = await authUser(req);
      const body = await readJson(req);
      if (typeof body.email === "string") {
        const email = body.email.trim().toLowerCase();
        if (!email.includes("@")) throw new HttpError(400, "Invalid email address.");
        const existing = await repo.findUserByEmail(email);
        if (existing && existing.id !== user.id) {
          throw new HttpError(409, "Email is already associated with another account.");
        }
        await repo.setUserEmail(user.id, email);
      }
      ok(res, await repo.findUserById(user.id));
    }],
    ["GET", /^\/api\/health$/, async (_req, res) => ok(res, { status: "ok", instance: config.instanceId, ...(await manager.stats()) })],
    ["GET", /^\/api\/stats$/, async (_req, res) => ok(res, { ...(await manager.stats()), ...(await repo.counts()) })],
    ["GET", /^\/api\/leaderboard$/, async (_req, res) => ok(res, await repo.leaderboard(100))],
    ["GET", /^\/api\/games\/live$/, async (_req, res) => ok(res, await manager.liveGames())],
    ["GET", /^\/api\/games\/([\w-]{1,40})$/, async (_req, res, [id]) => {
      const game = await repo.findGame(id!);
      if (!game) throw new HttpError(404, "Game not found.");
      ok(res, game);
    }],
    ["GET", /^\/api\/users\/(\w{1,30})$/, async (_req, res, [name]) => {
      const user = await repo.findUserByName(name!);
      if (!user) throw new HttpError(404, "Player not found.");
      ok(res, { user, online: await manager.isOnline(user.id), games: (await repo.gamesForUser(user.id)).map(gameSummary) });
    }],
  ];

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) {
        const origin = req.headers.origin;
        if (origin && config.corsOrigins.has(origin)) {
          res.setHeader("Access-Control-Allow-Origin", origin);
          res.setHeader("Vary", "Origin");
        }
        if (req.method === "OPTIONS") {
          res.writeHead(204, {
            "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Max-Age": "600",
          });
          return res.end();
        }
        for (const [method, re, handler] of routes) {
          const m = re.exec(url.pathname);
          if (m && req.method === method) return await handler(req, res, m.slice(1));
        }
        throw new HttpError(404, "Not found");
      }
      if (req.method === "GET" || req.method === "HEAD") return serveStatic(url.pathname, res);
      throw new HttpError(405, "Method not allowed");
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { ok: false, error: err.message });
      log.error(`${req.method} ${url.pathname} failed`, err);
      send(res, 500, { ok: false, error: "Something went wrong. Please try again." });
    }
  };
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
};

/** Serves the built frontend (production). SPA fallback to index.html. */
function serveStatic(pathname: string, res: ServerResponse): void {
  const root = config.staticDir;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, "Malformed URL");
  }
  const safe = normalize(decoded).replace(/^([/\\])+/, "");
  let file = join(root, safe);
  if (!file.startsWith(root + sep) && file !== root) throw new HttpError(403, "Forbidden");
  const isFile = (p: string) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  };
  if (!isFile(file)) file = join(root, "index.html");
  if (!isFile(file)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Frontend not built. Run `npm run build` in frontend/, or use the Vite dev server.");
    return;
  }
  const immutable = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  createReadStream(file).pipe(res);
}
