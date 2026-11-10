import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(process.env.DATA_DIR ?? join(root, "data"));

const isProd = process.env.NODE_ENV === "production";

function loadSecret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (isProd) throw new Error("AUTH_SECRET must be set in production");
  // Dev convenience: persist a random secret so logins survive restarts.
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, ".auth-secret");
  // 'wx' = create only if missing, so concurrently starting instances agree on one secret
  try {
    writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  return readFileSync(file, "utf8").trim();
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  /** Postgres (Neon) connection string. Read lazily so code that never touches the DB (unit tests) doesn't need it. */
  get databaseUrl(): string {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set — point it at your Neon (or any Postgres) database");
    return url;
  },
  /**
   * Browser origins allowed to call the API cross-origin (comma-separated), e.g. the Vercel frontend.
   * The SPA calls Railway directly rather than through a Vercel rewrite, so Railway's edge reports
   * the real client IP to the auth rate limiter. Empty = same-origin only.
   */
  corsOrigins: new Set((process.env.CORS_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean)),
  /** behind Vercel/Railway proxies the client IP arrives in X-Forwarded-For */
  trustProxy: process.env.TRUST_PROXY === "1" || isProd,
  authSecret: loadSecret(),
  tokenTtlMs: 30 * 24 * 3600_000,
  staticDir: resolve(process.env.STATIC_DIR ?? join(root, "..", "frontend", "dist")),
  firstMoveTimeoutMs: 30_000,
  abandonTimeoutMs: 60_000,
  finishedGameTtlMs: 10 * 60_000,
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  /** namespace for every key/channel, so several deployments (or tests) can share one Redis */
  redisPrefix: process.env.REDIS_PREFIX ?? "gambit:",
  instanceId: `${hostname()}-${process.pid}-${randomBytes(3).toString("hex")}`,
  /** an instance must renew game ownership within this window or another instance takes the game over */
  leaseMs: Number(process.env.LEASE_MS ?? 15_000),
  heartbeatMs: Number(process.env.HEARTBEAT_MS ?? 5_000),
};
