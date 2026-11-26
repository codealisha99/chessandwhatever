import { randomUUID } from "node:crypto";
import pg from "pg";
import { config } from "./config.ts";
import { log } from "./logger.ts";
import { retry } from "./retry.ts";

export interface User {
  id: string;
  username: string;
  email?: string | null;
  emailVerified?: boolean;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  isGuest: boolean;
  createdAt: number;
}

export interface Session {
  id: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface ProviderIdentity {
  id: string;
  userId: string;
  provider: string;
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  createdAt: number;
  lastLoginAt: number;
}

export interface PasswordResetToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: number;
  usedAt: number | null;
  createdAt: number;
}

export interface StoredMove {
  san: string;
  uci: string;
  /** mover's remaining clock (ms) after the move */
  clock: number;
}

export interface GameRecord {
  id: string;
  whiteId: string;
  blackId: string;
  whiteName: string;
  blackName: string;
  whiteRating: number;
  blackRating: number;
  whiteDelta: number;
  blackDelta: number;
  tc: string;
  result: "1-0" | "0-1" | "1/2-1/2";
  reason: string;
  pgn: string;
  moves: StoredMove[];
  startedAt: number;
  endedAt: number;
}

// Neon (or any Postgres). One pool per instance; every instance shares the same database.
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  // Neon scales idle databases to zero; the first connection can take a few seconds to wake it
  connectionTimeoutMillis: 20_000,
});
pool.on("error", (err) => log.warn(`postgres pool: ${err.message}`));

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    email TEXT,
    password_hash TEXT,
    is_guest BOOLEAN NOT NULL DEFAULT FALSE,
    rating INTEGER NOT NULL DEFAULT 1200,
    games INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL
  );
  ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
  CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username));
  CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users (lower(email)) WHERE email IS NOT NULL;
  CREATE INDEX IF NOT EXISTS users_rating ON users (rating DESC) WHERE NOT is_guest;

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    revoked_at BIGINT,
    ip TEXT,
    user_agent TEXT
  );
  CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions (user_id);
  CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires_at);

  CREATE TABLE IF NOT EXISTS provider_identities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    email TEXT,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at BIGINT NOT NULL,
    last_login_at BIGINT NOT NULL,
    UNIQUE (provider, provider_user_id)
  );
  CREATE INDEX IF NOT EXISTS provider_identities_user_id ON provider_identities (user_id);
  CREATE INDEX IF NOT EXISTS provider_identities_email ON provider_identities (lower(email));

  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at BIGINT NOT NULL,
    used_at BIGINT,
    created_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS prt_user_id ON password_reset_tokens (user_id);
  CREATE UNIQUE INDEX IF NOT EXISTS prt_token_hash ON password_reset_tokens (token_hash);

  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    white_id TEXT NOT NULL REFERENCES users(id),
    black_id TEXT NOT NULL REFERENCES users(id),
    white_rating INTEGER NOT NULL,
    black_rating INTEGER NOT NULL,
    white_delta INTEGER NOT NULL,
    black_delta INTEGER NOT NULL,
    tc TEXT NOT NULL,
    result TEXT NOT NULL,
    reason TEXT NOT NULL,
    pgn TEXT NOT NULL,
    moves JSONB NOT NULL,
    started_at BIGINT NOT NULL,
    ended_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS games_white ON games (white_id, ended_at DESC);
  CREATE INDEX IF NOT EXISTS games_black ON games (black_id, ended_at DESC);
`;

/** Idempotent schema setup, retried while the database wakes up or the network settles. */
export function migrate(): Promise<void> {
  return retry("database migration", migrateOnce);
}

/**
 * The advisory lock stops several instances racing on first boot. It is transaction-scoped:
 * a session lock leaks behind a transaction-mode pooler (Neon's pooled endpoint) and blocks the next boot forever.
 */
async function migrateOnce(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(727274)");
    await client.query(SCHEMA);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

type Row = Record<string, unknown>;

const toUser = (r: Row): User => ({
  id: r.id as string,
  username: r.username as string,
  email: (r.email as string | null) ?? null,
  emailVerified: Boolean(r.email_verified),
  rating: Number(r.rating),
  games: Number(r.games),
  wins: Number(r.wins),
  losses: Number(r.losses),
  draws: Number(r.draws),
  isGuest: Boolean(r.is_guest),
  createdAt: Number(r.created_at),
});

const toSession = (r: Row): Session => ({
  id: r.id as string,
  userId: r.user_id as string,
  createdAt: Number(r.created_at),
  expiresAt: Number(r.expires_at),
  revokedAt: r.revoked_at ? Number(r.revoked_at) : null,
  ip: (r.ip as string | null) ?? null,
  userAgent: (r.user_agent as string | null) ?? null,
});

const toProviderIdentity = (r: Row): ProviderIdentity => ({
  id: r.id as string,
  userId: r.user_id as string,
  provider: r.provider as string,
  providerUserId: r.provider_user_id as string,
  email: (r.email as string | null) ?? null,
  emailVerified: Boolean(r.email_verified),
  createdAt: Number(r.created_at),
  lastLoginAt: Number(r.last_login_at),
});

const toGame = (r: Row): GameRecord => ({
  id: r.id as string,
  whiteId: r.white_id as string,
  blackId: r.black_id as string,
  whiteName: r.white_name as string,
  blackName: r.black_name as string,
  whiteRating: Number(r.white_rating),
  blackRating: Number(r.black_rating),
  whiteDelta: Number(r.white_delta),
  blackDelta: Number(r.black_delta),
  tc: r.tc as string,
  result: r.result as GameRecord["result"],
  reason: r.reason as string,
  pgn: r.pgn as string,
  moves: r.moves as StoredMove[],
  startedAt: Number(r.started_at),
  endedAt: Number(r.ended_at),
});

const USER_COLS = "id, username, email, COALESCE(email_verified, false) AS email_verified, rating, games, wins, losses, draws, is_guest, created_at";
const GAME_SELECT = `
  SELECT g.*, w.username AS white_name, b.username AS black_name
  FROM games g JOIN users w ON w.id = g.white_id JOIN users b ON b.id = g.black_id`;

async function one(sql: string, params: unknown[]): Promise<Row | null> {
  const { rows } = await pool.query(sql, params);
  return (rows[0] as Row | undefined) ?? null;
}

export const repo = {
  async findUserById(id: string): Promise<User | null> {
    const r = await one(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [id]);
    return r ? toUser(r) : null;
  },
  async findUserByName(username: string): Promise<User | null> {
    const r = await one(`SELECT ${USER_COLS} FROM users WHERE lower(username) = lower($1)`, [username]);
    return r ? toUser(r) : null;
  },
  async findUserByEmail(email: string): Promise<User | null> {
    const r = await one(`SELECT ${USER_COLS} FROM users WHERE lower(email) = lower($1)`, [email]);
    return r ? toUser(r) : null;
  },
  async findVerifiedUserByEmail(email: string): Promise<User | null> {
    const normalized = email.trim().toLowerCase();
    // 1. Direct match on users table where email_verified is true
    const direct = await one(
      `SELECT ${USER_COLS} FROM users WHERE lower(email) = $1 AND email_verified = TRUE`,
      [normalized],
    );
    if (direct) return toUser(direct);

    // 2. Match on provider_identities where email_verified is true
    const viaProvider = await one(
      `SELECT u.id, u.username, u.email, COALESCE(u.email_verified, false) AS email_verified,
              u.rating, u.games, u.wins, u.losses, u.draws, u.is_guest, u.created_at
       FROM users u
       JOIN provider_identities p ON p.user_id = u.id
       WHERE lower(p.email) = $1 AND p.email_verified = TRUE
       LIMIT 1`,
      [normalized],
    );
    if (viaProvider) return toUser(viaProvider);

    return null;
  },
  async setUserEmail(userId: string, email: string): Promise<void> {
    await pool.query(`UPDATE users SET email = $1 WHERE id = $2`, [email, userId]);
  },
  async findCredentials(username: string): Promise<{ id: string; passwordHash: string } | null> {
    const r = await one(`SELECT id, password_hash FROM users WHERE lower(username) = lower($1) AND NOT is_guest`, [username]);
    return r ? { id: r.id as string, passwordHash: r.password_hash as string } : null;
  },
  /** Returns null when the username is taken (case-insensitive). */
  async createUser(
    id: string,
    username: string,
    passwordHash: string | null,
    email: string | null = null,
    emailVerified: boolean = false,
  ): Promise<User | null> {
    const r = await one(
      `INSERT INTO users (id, username, password_hash, email, email_verified, is_guest, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING RETURNING ${USER_COLS}`,
      [id, username, passwordHash, email, emailVerified, passwordHash === null, Date.now()],
    );
    return r ? toUser(r) : null;
  },
  /**
   * Saves a finished game and both rating updates in one transaction.
   * Idempotent: if another instance already saved this game (failover), ratings are not applied twice.
   */
  async saveFinishedGame(g: GameRecord): Promise<boolean> {
    const score = g.result === "1-0" ? 1 : g.result === "0-1" ? 0 : 0.5;
    const outcome = (s: number) => [s === 1 ? 1 : 0, s === 0 ? 1 : 0, s === 0.5 ? 1 : 0];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO games (id, white_id, black_id, white_rating, black_rating, white_delta, black_delta,
           tc, result, reason, pgn, moves, started_at, ended_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [g.id, g.whiteId, g.blackId, g.whiteRating, g.blackRating, g.whiteDelta, g.blackDelta, g.tc, g.result, g.reason, g.pgn, JSON.stringify(g.moves), g.startedAt, g.endedAt],
      );
      if (inserted.rowCount === 0) {
        await client.query("ROLLBACK");
        return false;
      }
      const apply = `UPDATE users SET rating = GREATEST(100, rating + $1), games = games + 1,
        wins = wins + $2, losses = losses + $3, draws = draws + $4 WHERE id = $5`;
      await client.query(apply, [g.whiteDelta, ...outcome(score), g.whiteId]);
      await client.query(apply, [g.blackDelta, ...outcome(1 - score), g.blackId]);
      await client.query("COMMIT");
      return true;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },
  async findGame(id: string): Promise<GameRecord | null> {
    const r = await one(`${GAME_SELECT} WHERE g.id = $1`, [id]);
    return r ? toGame(r) : null;
  },
  async gamesForUser(userId: string, limit = 30): Promise<GameRecord[]> {
    const { rows } = await pool.query(`${GAME_SELECT} WHERE g.white_id = $1 OR g.black_id = $1 ORDER BY g.ended_at DESC LIMIT $2`, [userId, limit]);
    return (rows as Row[]).map(toGame);
  },
  async leaderboard(limit = 50): Promise<User[]> {
    const { rows } = await pool.query(`SELECT ${USER_COLS} FROM users WHERE NOT is_guest AND games > 0 ORDER BY rating DESC, wins DESC LIMIT $1`, [limit]);
    return (rows as Row[]).map(toUser);
  },
  async counts(): Promise<{ players: number; games: number }> {
    const r = (await one(`SELECT (SELECT COUNT(*) FROM users WHERE NOT is_guest) AS players, (SELECT COUNT(*) FROM games) AS games`, []))!;
    return { players: Number(r.players), games: Number(r.games) };
  },
  async createSession(id: string, userId: string, expiresAt: number, ip?: string | null, userAgent?: string | null): Promise<Session> {
    const r = (await one(
      `INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, userId, Date.now(), expiresAt, ip ?? null, userAgent ?? null],
    ))!;
    return toSession(r);
  },
  async findSession(id: string): Promise<Session | null> {
    const r = await one(`SELECT * FROM sessions WHERE id = $1`, [id]);
    return r ? toSession(r) : null;
  },
  async isSessionActive(id: string): Promise<boolean> {
    const r = await one(`SELECT 1 FROM sessions WHERE id = $1 AND revoked_at IS NULL AND expires_at > $2`, [id, Date.now()]);
    return r !== null;
  },
  async revokeSession(id: string): Promise<boolean> {
    const res = await pool.query(`UPDATE sessions SET revoked_at = $1 WHERE id = $2 AND revoked_at IS NULL`, [Date.now(), id]);
    return (res.rowCount ?? 0) > 0;
  },
  async revokeAllUserSessions(userId: string): Promise<number> {
    const res = await pool.query(`UPDATE sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL`, [Date.now(), userId]);
    return res.rowCount ?? 0;
  },
  async findProviderIdentitiesForUser(userId: string, provider?: string): Promise<ProviderIdentity[]> {
    const sql = provider
      ? `SELECT * FROM provider_identities WHERE user_id = $1 AND provider = $2`
      : `SELECT * FROM provider_identities WHERE user_id = $1`;
    const params = provider ? [userId, provider] : [userId];
    const { rows } = await pool.query(sql, params);
    return (rows as Row[]).map(toProviderIdentity);
  },
  async findProviderIdentity(provider: string, providerUserId: string): Promise<ProviderIdentity | null> {
    const r = await one(`SELECT * FROM provider_identities WHERE provider = $1 AND provider_user_id = $2`, [provider, providerUserId]);
    return r ? toProviderIdentity(r) : null;
  },
  async linkProviderIdentity(
    userId: string,
    provider: string,
    providerUserId: string,
    email: string | null,
    emailVerified: boolean,
  ): Promise<ProviderIdentity> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Concurrency protection: lock target user row
      const userRes = await client.query(`SELECT id, email, email_verified FROM users WHERE id = $1 FOR UPDATE`, [userId]);
      if (userRes.rows.length === 0) {
        throw new Error("User not found for account linking");
      }

      // Check if this provider identity already exists for another user
      const existingIdentRes = await client.query(
        `SELECT id, user_id FROM provider_identities WHERE provider = $1 AND provider_user_id = $2 FOR UPDATE`,
        [provider, providerUserId]
      );
      if (existingIdentRes.rows.length > 0 && existingIdentRes.rows[0].user_id !== userId) {
        throw new Error("This Google identity is already linked to another Gambit account");
      }

      // Check if user already has a different identity for this provider
      const userIdentRes = await client.query(
        `SELECT id, provider_user_id FROM provider_identities WHERE user_id = $1 AND provider = $2 FOR UPDATE`,
        [userId, provider]
      );
      if (userIdentRes.rows.length > 0 && userIdentRes.rows[0].provider_user_id !== providerUserId) {
        throw new Error("This Gambit account is already linked to a different Google account");
      }

      const now = Date.now();
      const id = randomUUID();
      const r = (await client.query(
        `INSERT INTO provider_identities (id, user_id, provider, provider_user_id, email, email_verified, created_at, last_login_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (provider, provider_user_id) DO UPDATE SET last_login_at = $8, email = COALESCE(EXCLUDED.email, provider_identities.email), email_verified = EXCLUDED.email_verified
         RETURNING *`,
        [id, userId, provider, providerUserId, email, emailVerified, now, now],
      )).rows[0];

      // Update users table with verified email
      if (email && emailVerified) {
        await client.query(
          `UPDATE users SET email = COALESCE(email, $1), email_verified = TRUE WHERE id = $2`,
          [email, userId]
        );
      }

      await client.query("COMMIT");
      return toProviderIdentity(r);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },
  async createProviderIdentity(
    id: string,
    userId: string,
    provider: string,
    providerUserId: string,
    email: string | null,
    emailVerified: boolean,
  ): Promise<ProviderIdentity> {
    const now = Date.now();
    const r = (await one(
      `INSERT INTO provider_identities (id, user_id, provider, provider_user_id, email, email_verified, created_at, last_login_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (provider, provider_user_id) DO UPDATE SET last_login_at = $8, email = COALESCE(EXCLUDED.email, provider_identities.email), email_verified = EXCLUDED.email_verified
       RETURNING *`,
      [id, userId, provider, providerUserId, email, emailVerified, now, now],
    ))!;
    return toProviderIdentity(r);
  },
  async createPasswordResetToken(id: string, userId: string, tokenHash: string, expiresAt: number): Promise<void> {
    await pool.query(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES ($1, $2, $3, $4, $5)`,
      [id, userId, tokenHash, expiresAt, Date.now()],
    );
  },
  async findValidResetToken(tokenHash: string): Promise<{ id: string; userId: string; expiresAt: number } | null> {
    const r = await one(
      `SELECT id, user_id, expires_at FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2`,
      [tokenHash, Date.now()],
    );
    return r ? { id: r.id as string, userId: r.user_id as string, expiresAt: Number(r.expires_at) } : null;
  },
  async consumeResetTokenAndSetPassword(tokenId: string, userId: string, newPasswordHash: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query(
        `UPDATE password_reset_tokens SET used_at = $1 WHERE id = $2 AND used_at IS NULL AND expires_at > $1`,
        [Date.now(), tokenId],
      );
      if (res.rowCount === 0) {
        await client.query("ROLLBACK");
        throw new Error("Reset token has already been used or expired");
      }
      await client.query(`UPDATE users SET password_hash = $1, email_verified = TRUE WHERE id = $2`, [newPasswordHash, userId]);
      await client.query(`UPDATE sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL`, [Date.now(), userId]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },
  async cleanupInactiveGuests(olderThanMs: number, batchSize = 100, dryRun = false): Promise<{ examined: number; deleted: number; dryRun: boolean; durationMs: number }> {
    const start = Date.now();
    const cutoff = start - olderThanMs;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const lockRes = await client.query("SELECT pg_try_advisory_xact_lock(727275) AS locked");
      if (!lockRes.rows[0]?.locked) {
        await client.query("ROLLBACK");
        return { examined: 0, deleted: 0, dryRun, durationMs: Date.now() - start };
      }
      const candidatesRes = await client.query(
        `SELECT id FROM users
         WHERE is_guest = TRUE AND games = 0 AND created_at < $1
         LIMIT $2 FOR UPDATE SKIP LOCKED`,
        [cutoff, batchSize],
      );
      const ids: string[] = candidatesRes.rows.map((r) => r.id as string);
      if (ids.length === 0 || dryRun) {
        await client.query("COMMIT");
        return { examined: ids.length, deleted: dryRun ? ids.length : 0, dryRun, durationMs: Date.now() - start };
      }
      await client.query(`DELETE FROM sessions WHERE user_id = ANY($1)`, [ids]);
      await client.query(`DELETE FROM password_reset_tokens WHERE user_id = ANY($1)`, [ids]);
      const delRes = await client.query(`DELETE FROM users WHERE id = ANY($1)`, [ids]);
      await client.query("COMMIT");
      return { examined: ids.length, deleted: delRes.rowCount ?? 0, dryRun: false, durationMs: Date.now() - start };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },
  async ping(): Promise<void> {
    await pool.query("SELECT 1");
  },
  close(): Promise<void> {
    return pool.end();
  },
};
