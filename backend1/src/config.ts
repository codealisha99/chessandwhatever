import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(process.env.DATA_DIR ?? join(root, "data"));
mkdirSync(dataDir, { recursive: true });

const isProd = process.env.NODE_ENV === "production";

function loadSecret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (isProd) throw new Error("AUTH_SECRET must be set in production");
  // Dev convenience: persist a random secret so logins survive restarts.
  const file = join(dataDir, ".auth-secret");
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
  return readFileSync(file, "utf8").trim();
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  dbFile: join(dataDir, "chess.db"),
  authSecret: loadSecret(),
  tokenTtlMs: 30 * 24 * 3600_000,
  staticDir: resolve(process.env.STATIC_DIR ?? join(root, "..", "frontend", "dist")),
  firstMoveTimeoutMs: 30_000,
  abandonTimeoutMs: 60_000,
  finishedGameTtlMs: 10 * 60_000,
};
