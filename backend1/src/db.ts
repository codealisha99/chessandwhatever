import pg from "pg";
import { config } from "./config.ts";
import { log } from "./logger.ts";

export interface User {
  id: string;
  username: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  isGuest: boolean;
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
const pool = new pg.Pool({
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
    password_hash TEXT,
    is_guest BOOLEAN NOT NULL DEFAULT FALSE,
    rating INTEGER NOT NULL DEFAULT 1200,
    games INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username));
  CREATE INDEX IF NOT EXISTS users_rating ON users (rating DESC) WHERE NOT is_guest;
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

const MIGRATE_ATTEMPTS = 6;

/** Idempotent schema setup, retried while the database wakes up or the network settles. */
export async function migrate(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await migrateOnce();
    } catch (err) {
      if (attempt >= MIGRATE_ATTEMPTS) throw err;
      const wait = Math.min(1000 * 2 ** attempt, 15_000);
      log.warn(`database not ready (${(err as Error).message}), retrying in ${wait / 1000}s`, { attempt });
      await new Promise((r) => setTimeout(r, wait));
    }
  }
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
  rating: Number(r.rating),
  games: Number(r.games),
  wins: Number(r.wins),
  losses: Number(r.losses),
  draws: Number(r.draws),
  isGuest: Boolean(r.is_guest),
  createdAt: Number(r.created_at),
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

const USER_COLS = "id, username, rating, games, wins, losses, draws, is_guest, created_at";
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
  async findCredentials(username: string): Promise<{ id: string; passwordHash: string } | null> {
    const r = await one(`SELECT id, password_hash FROM users WHERE lower(username) = lower($1) AND NOT is_guest`, [username]);
    return r ? { id: r.id as string, passwordHash: r.password_hash as string } : null;
  },
  /** Returns null when the username is taken (case-insensitive). */
  async createUser(id: string, username: string, passwordHash: string | null): Promise<User | null> {
    const r = await one(
      `INSERT INTO users (id, username, password_hash, is_guest, created_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING RETURNING ${USER_COLS}`,
      [id, username, passwordHash, passwordHash === null, Date.now()],
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
  async ping(): Promise<void> {
    await pool.query("SELECT 1");
  },
  close(): Promise<void> {
    return pool.end();
  },
};
