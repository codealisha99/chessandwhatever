import { DatabaseSync } from "node:sqlite";
import { config } from "./config.ts";

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

const db = new DatabaseSync(config.dbFile);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT,
    is_guest INTEGER NOT NULL DEFAULT 0,
    rating INTEGER NOT NULL DEFAULT 1200,
    games INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
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
    moves TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS games_white ON games(white_id, ended_at DESC);
  CREATE INDEX IF NOT EXISTS games_black ON games(black_id, ended_at DESC);
  CREATE INDEX IF NOT EXISTS users_rating ON users(rating DESC);
`);

type Row = Record<string, unknown>;

const toUser = (r: Row): User => ({
  id: r.id as string,
  username: r.username as string,
  rating: Number(r.rating),
  games: Number(r.games),
  wins: Number(r.wins),
  losses: Number(r.losses),
  draws: Number(r.draws),
  isGuest: Number(r.is_guest) === 1,
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
  moves: JSON.parse(r.moves as string) as StoredMove[],
  startedAt: Number(r.started_at),
  endedAt: Number(r.ended_at),
});

const USER_COLS = "id, username, rating, games, wins, losses, draws, is_guest, created_at";
const GAME_SELECT = `
  SELECT g.*, w.username AS white_name, b.username AS black_name
  FROM games g JOIN users w ON w.id = g.white_id JOIN users b ON b.id = g.black_id`;

const q = {
  userById: db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`),
  userByName: db.prepare(`SELECT ${USER_COLS} FROM users WHERE username = ?`),
  credsByName: db.prepare(`SELECT id, password_hash FROM users WHERE username = ? AND is_guest = 0`),
  insertUser: db.prepare(
    `INSERT INTO users (id, username, password_hash, is_guest, created_at) VALUES (?, ?, ?, ?, ?)`,
  ),
  applyResult: db.prepare(`
    UPDATE users SET rating = MAX(100, rating + ?), games = games + 1,
      wins = wins + ?, losses = losses + ?, draws = draws + ? WHERE id = ?`),
  insertGame: db.prepare(`
    INSERT INTO games (id, white_id, black_id, white_rating, black_rating, white_delta, black_delta,
      tc, result, reason, pgn, moves, started_at, ended_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  gameById: db.prepare(`${GAME_SELECT} WHERE g.id = ?`),
  gamesByUser: db.prepare(
    `${GAME_SELECT} WHERE g.white_id = ? OR g.black_id = ? ORDER BY g.ended_at DESC LIMIT ?`,
  ),
  leaderboard: db.prepare(
    `SELECT ${USER_COLS} FROM users WHERE is_guest = 0 AND games > 0 ORDER BY rating DESC, wins DESC LIMIT ?`,
  ),
  counts: db.prepare(`SELECT (SELECT COUNT(*) FROM users WHERE is_guest = 0) AS players, (SELECT COUNT(*) FROM games) AS games`),
};

export const repo = {
  findUserById(id: string): User | null {
    const r = q.userById.get(id) as Row | undefined;
    return r ? toUser(r) : null;
  },
  findUserByName(username: string): User | null {
    const r = q.userByName.get(username) as Row | undefined;
    return r ? toUser(r) : null;
  },
  findCredentials(username: string): { id: string; passwordHash: string } | null {
    const r = q.credsByName.get(username) as Row | undefined;
    return r ? { id: r.id as string, passwordHash: r.password_hash as string } : null;
  },
  /** Returns null when the username is taken. */
  createUser(id: string, username: string, passwordHash: string | null): User | null {
    try {
      q.insertUser.run(id, username, passwordHash, passwordHash ? 0 : 1, Date.now());
    } catch (err) {
      if (String(err).includes("UNIQUE")) return null;
      throw err;
    }
    return repo.findUserById(id);
  },
  /** Saves a finished game and both rating updates atomically. */
  saveFinishedGame(g: GameRecord): void {
    const score = g.result === "1-0" ? 1 : g.result === "0-1" ? 0 : 0.5;
    const outcome = (s: number) => [s === 1 ? 1 : 0, s === 0 ? 1 : 0, s === 0.5 ? 1 : 0] as const;
    db.exec("BEGIN");
    try {
      q.insertGame.run(
        g.id, g.whiteId, g.blackId, g.whiteRating, g.blackRating, g.whiteDelta, g.blackDelta,
        g.tc, g.result, g.reason, g.pgn, JSON.stringify(g.moves), g.startedAt, g.endedAt,
      );
      q.applyResult.run(g.whiteDelta, ...outcome(score), g.whiteId);
      q.applyResult.run(g.blackDelta, ...outcome(1 - score), g.blackId);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  },
  findGame(id: string): GameRecord | null {
    const r = q.gameById.get(id) as Row | undefined;
    return r ? toGame(r) : null;
  },
  gamesForUser(userId: string, limit = 30): GameRecord[] {
    return (q.gamesByUser.all(userId, userId, limit) as Row[]).map(toGame);
  },
  leaderboard(limit = 50): User[] {
    return (q.leaderboard.all(limit) as Row[]).map(toUser);
  },
  counts(): { players: number; games: number } {
    const r = q.counts.get() as Row;
    return { players: Number(r.players), games: Number(r.games) };
  },
  close(): void {
    db.close();
  },
};
