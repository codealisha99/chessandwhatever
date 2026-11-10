import { randomUUID } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { hashPassword, issueToken, PASSWORD_MAX, PASSWORD_MIN, USERNAME_RE, verifyPassword, verifyToken } from "./auth.ts";
import { config } from "./config.ts";
import { repo, type GameRecord, type User } from "./db.ts";
import type { GameManager } from "./GameManager.ts";
import { log } from "./logger.ts";

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
const authHits = new Map<string, { count: number; resetAt: number }>();

function rateLimitAuth(req: IncomingMessage): void {
  const ip = req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  const hit = authHits.get(ip);
  if (!hit || hit.resetAt < now) {
    authHits.set(ip, { count: 1, resetAt: now + AUTH_WINDOW_MS });
    return;
  }
  hit.count++;
  if (hit.count > AUTH_MAX_PER_WINDOW) throw new HttpError(429, "Too many attempts. Try again in a minute.");
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

function authUser(req: IncomingMessage): User {
  const header = req.headers.authorization ?? "";
  const userId = verifyToken(header.startsWith("Bearer ") ? header.slice(7) : null);
  const user = userId ? repo.findUserById(userId) : null;
  if (!user) throw new HttpError(401, "Please sign in again.");
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

const session = (user: User) => ({ token: issueToken(user.id), user });

const gameSummary = (g: GameRecord) => {
  const { moves, pgn, ...rest } = g;
  return { ...rest, plies: moves.length };
};

type Handler = (req: IncomingMessage, res: ServerResponse, params: string[]) => Promise<void> | void;

export function createHttpHandler(manager: GameManager) {
  const routes: [string, RegExp, Handler][] = [
    ["POST", /^\/api\/auth\/signup$/, async (req, res) => {
      rateLimitAuth(req);
      const { username, password } = credentials(await readJson(req));
      if (/^guest_/i.test(username)) throw new HttpError(400, "That username is reserved.");
      const user = repo.createUser(randomUUID(), username, await hashPassword(password));
      if (!user) throw new HttpError(409, "That username is taken.");
      ok(res, session(user));
    }],
    ["POST", /^\/api\/auth\/login$/, async (req, res) => {
      rateLimitAuth(req);
      const body = await readJson(req);
      const username = typeof body.username === "string" ? body.username.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const creds = username && password ? repo.findCredentials(username) : null;
      if (!creds || !(await verifyPassword(password, creds.passwordHash))) {
        throw new HttpError(401, "Wrong username or password.");
      }
      ok(res, session(repo.findUserById(creds.id)!));
    }],
    ["POST", /^\/api\/auth\/guest$/, (req, res) => {
      rateLimitAuth(req);
      for (let i = 0; i < 5; i++) {
        const user = repo.createUser(randomUUID(), `Guest_${Math.floor(Math.random() * 1e6)}`, null);
        if (user) return ok(res, session(user));
      }
      throw new HttpError(503, "Could not create a guest account. Try again.");
    }],
    ["GET", /^\/api\/me$/, (req, res) => ok(res, authUser(req))],
    ["GET", /^\/api\/stats$/, (_req, res) => ok(res, { ...manager.stats(), ...repo.counts() })],
    ["GET", /^\/api\/leaderboard$/, (_req, res) => ok(res, repo.leaderboard(100))],
    ["GET", /^\/api\/games\/live$/, (_req, res) => ok(res, manager.liveGames())],
    ["GET", /^\/api\/games\/([\w-]{1,40})$/, (_req, res, [id]) => {
      const game = repo.findGame(id!);
      if (!game) throw new HttpError(404, "Game not found.");
      ok(res, game);
    }],
    ["GET", /^\/api\/users\/(\w{1,30})$/, (_req, res, [name]) => {
      const user = repo.findUserByName(name!);
      if (!user) throw new HttpError(404, "Player not found.");
      ok(res, { user, online: manager.isOnline(user.id), games: repo.gamesForUser(user.id).map(gameSummary) });
    }],
  ];

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) {
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
  const safe = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
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
