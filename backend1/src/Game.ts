import { randomBytes } from "node:crypto";
import { Chess } from "chess.js";
import { config } from "./config.ts";
import type { GameRecord, StoredMove } from "./db.ts";
import { eloDelta } from "./elo.ts";
import type { Color, MoveInput, TimeControl } from "./protocol.ts";

export interface PlayerInfo {
  id: string;
  username: string;
  rating: number;
  games: number;
}

export interface GameResult {
  winner: Color | null;
  reason: string;
  whiteDelta: number;
  blackDelta: number;
}

interface PlayedMove extends MoveInput {
  san: string;
  clock: number;
}

interface ChatLine {
  from: string;
  text: string;
  ts: number;
}

/**
 * Everything needed to rebuild a game on another server instance.
 * Times are absolute epoch ms so a takeover resumes the clocks exactly.
 */
export interface GameSnapshot {
  id: string;
  white: PlayerInfo;
  black: PlayerInfo;
  tc: TimeControl;
  moves: PlayedMove[];
  fen: string;
  clocks: Record<Color, number>;
  turnStartedAt: number;
  startedAt: number;
  status: "active" | "finished";
  result: GameResult | null;
  drawOfferFrom: Color | null;
  rematchFrom: Color | null;
  chat: ChatLine[];
  connected: Record<Color, boolean>;
  abandonAt: Record<Color, number | null>;
}

/** to: undefined = players + spectators, otherwise a single userId. */
export type Emit = (msg: object, to?: string) => void;

const other = (c: Color): Color => (c === "white" ? "black" : "white");
const MAX_CHAT_HISTORY = 50;

/** True if `color` cannot possibly deliver mate (lone king, or king + one minor piece). */
export function cannotMate(chess: Chess, color: Color): boolean {
  const side = color === "white" ? "w" : "b";
  const pieces = chess.board().flat().filter((p) => p && p.color === side && p.type !== "k");
  return pieces.length === 0 || (pieces.length === 1 && (pieces[0]!.type === "n" || pieces[0]!.type === "b"));
}

// ---------- pure snapshot readers (usable on any instance, no Game object needed) ----------

const turnOf = (s: GameSnapshot): Color => (s.moves.length % 2 === 0 ? "white" : "black");
/** Clocks only run once both sides have made their first move. */
const clockRunning = (s: GameSnapshot) => s.status === "active" && s.moves.length >= 2;

export function remainingOf(s: GameSnapshot, c: Color, now = Date.now()): number {
  const spent = clockRunning(s) && turnOf(s) === c ? now - s.turnStartedAt : 0;
  return Math.max(0, s.clocks[c] - spent);
}

export function clocksOf(s: GameSnapshot, now = Date.now()) {
  return {
    white: remainingOf(s, "white", now),
    black: remainingOf(s, "black", now),
    ticking: clockRunning(s) ? turnOf(s) : null,
    firstMoveMs:
      s.status === "active" && s.moves.length < 2
        ? Math.max(0, config.firstMoveTimeoutMs - (now - s.turnStartedAt))
        : null,
  };
}

/** The client-facing game view. `forUser` decides the `you` field. */
export function viewOf(s: GameSnapshot, forUser: string | null, spectators: number, now = Date.now()) {
  const pub = (p: PlayerInfo) => ({ id: p.id, username: p.username, rating: p.rating });
  const left = (at: number | null) => (at === null ? null : Math.max(0, at - now));
  return {
    id: s.id,
    tc: s.tc.id,
    white: pub(s.white),
    black: pub(s.black),
    you: forUser === s.white.id ? "white" : forUser === s.black.id ? "black" : null,
    moves: s.moves.map(({ san, from, to, promotion }) => ({ san, from, to, promotion })),
    status: s.status,
    clocks: clocksOf(s, now),
    result: s.result,
    drawOfferFrom: s.drawOfferFrom,
    rematchFrom: s.rematchFrom,
    chat: s.chat,
    connected: s.connected,
    abandonMs: { white: left(s.abandonAt.white), black: left(s.abandonAt.black) },
    spectators,
  };
}

// ---------- the live game, owned by exactly one server instance ----------

export class Game {
  readonly chess = new Chess();
  /** set when a rated game finishes; what gets written to the database */
  record: GameRecord | null = null;
  private s: GameSnapshot;
  private turnTimer: NodeJS.Timeout | null = null;
  private abandonTimers: Partial<Record<Color, NodeJS.Timeout>> = {};
  private readonly emit: Emit;
  private readonly onFinish: (g: Game) => void;

  constructor(
    init: { white: PlayerInfo; black: PlayerInfo; tc: TimeControl } | GameSnapshot,
    emit: Emit,
    onFinish: (g: Game) => void,
  ) {
    this.emit = emit;
    this.onFinish = onFinish;
    const now = Date.now();
    this.s =
      "id" in init
        ? structuredClone(init)
        : {
            id: randomBytes(6).toString("base64url"),
            white: init.white,
            black: init.black,
            tc: init.tc,
            moves: [],
            fen: this.chess.fen(),
            clocks: { white: init.tc.initialMs, black: init.tc.initialMs },
            turnStartedAt: now,
            startedAt: now,
            status: "active",
            result: null,
            drawOfferFrom: null,
            rematchFrom: null,
            chat: [],
            connected: { white: true, black: true },
            abandonAt: { white: null, black: null },
          };
    const { white, black, tc } = this.s;
    this.chess.setHeader("Event", `Rated ${tc.id} game`);
    this.chess.setHeader("Site", "Gambit");
    this.chess.setHeader("Date", new Date(this.s.startedAt).toISOString().slice(0, 10).replaceAll("-", "."));
    this.chess.setHeader("White", white.username);
    this.chess.setHeader("Black", black.username);
    this.chess.setHeader("WhiteElo", String(white.rating));
    this.chess.setHeader("BlackElo", String(black.rating));
    this.chess.setHeader("TimeControl", `${tc.initialMs / 1000}+${tc.incrementMs / 1000}`);
    for (const m of this.s.moves) this.chess.move({ from: m.from, to: m.to, promotion: m.promotion });
  }

  get id(): string {
    return this.s.id;
  }
  get whiteId(): string {
    return this.s.white.id;
  }
  get blackId(): string {
    return this.s.black.id;
  }
  get tcId(): string {
    return this.s.tc.id;
  }
  get status() {
    return this.s.status;
  }
  get result() {
    return this.s.result;
  }
  get moves(): readonly PlayedMove[] {
    return this.s.moves;
  }
  get drawOfferFrom() {
    return this.s.drawOfferFrom;
  }
  get rematchFrom() {
    return this.s.rematchFrom;
  }
  set rematchFrom(c: Color | null) {
    this.s.rematchFrom = c;
  }
  get connected(): Readonly<Record<Color, boolean>> {
    return this.s.connected;
  }

  snapshot(): GameSnapshot {
    return structuredClone(this.s);
  }

  colorOf(userId: string): Color | null {
    return userId === this.s.white.id ? "white" : userId === this.s.black.id ? "black" : null;
  }

  get turn(): Color {
    return turnOf(this.s);
  }

  remaining(c: Color, now = Date.now()): number {
    return remainingOf(this.s, c, now);
  }

  view(forUser: string | null, spectators = 0) {
    return viewOf(this.s, forUser, spectators);
  }

  start(): void {
    this.s.turnStartedAt = Date.now();
    this.scheduleTurnTimer();
    this.emit({ type: "game_state", game: this.view(this.whiteId) }, this.whiteId);
    this.emit({ type: "game_state", game: this.view(this.blackId) }, this.blackId);
  }

  /** Re-arm timers after restoring from a snapshot on a new owner. Fires immediately if a deadline already passed. */
  resume(): void {
    if (this.s.status !== "active") return;
    const now = Date.now();
    for (const c of ["white", "black"] as const) {
      const at = this.s.abandonAt[c];
      if (at !== null) this.armAbandon(c, Math.max(0, at - now));
    }
    if (this.s.status === "active") this.scheduleTurnTimer();
  }

  /** Returns an error message, or null on success. */
  move(userId: string, input: MoveInput): string | null {
    if (this.s.status !== "active") return "Game is over";
    const color = this.colorOf(userId);
    if (!color) return "You are not playing in this game";
    if (color !== this.turn) return "Not your turn";

    const now = Date.now();
    const wasRunning = clockRunning(this.s);
    if (wasRunning && this.remaining(color, now) <= 0) {
      this.s.clocks[color] = 0;
      this.flag(color);
      return "Out of time";
    }

    let played;
    try {
      played = this.chess.move(input);
    } catch {
      return "Illegal move";
    }
    if (wasRunning) {
      this.s.clocks[color] = this.s.clocks[color] - (now - this.s.turnStartedAt) + this.s.tc.incrementMs;
    }

    const promotion = played.promotion as MoveInput["promotion"];
    const record: PlayedMove = { san: played.san, from: played.from, to: played.to, clock: this.s.clocks[color] };
    if (promotion) record.promotion = promotion;
    this.s.moves.push(record);
    this.s.fen = this.chess.fen();
    this.s.turnStartedAt = now;
    if (this.s.drawOfferFrom && this.s.drawOfferFrom !== color) this.s.drawOfferFrom = null;

    this.emit({
      type: "move",
      gameId: this.id,
      move: { san: record.san, from: record.from, to: record.to, promotion: record.promotion },
      ply: this.s.moves.length,
      clocks: clocksOf(this.s, now),
      drawOfferFrom: this.s.drawOfferFrom,
    });

    if (this.chess.isCheckmate()) this.finish(color, "checkmate");
    else if (this.chess.isStalemate()) this.finish(null, "stalemate");
    else if (this.chess.isInsufficientMaterial()) this.finish(null, "insufficient material");
    else if (this.chess.isThreefoldRepetition()) this.finish(null, "threefold repetition");
    else if (this.chess.isDrawByFiftyMoves()) this.finish(null, "fifty-move rule");
    else this.scheduleTurnTimer();
    return null;
  }

  private scheduleTurnTimer(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.s.status !== "active") return;
    const side = this.turn;
    if (this.s.moves.length < 2) {
      const left = config.firstMoveTimeoutMs - (Date.now() - this.s.turnStartedAt);
      this.turnTimer = setTimeout(() => this.finish(null, "aborted"), Math.max(0, left));
    } else {
      // +5ms so remaining() is already <= 0 when it fires
      this.turnTimer = setTimeout(() => this.checkFlag(side), this.remaining(side) + 5);
    }
  }

  private checkFlag(side: Color): void {
    if (this.s.status !== "active" || this.turn !== side) return;
    if (this.remaining(side) > 0) return this.scheduleTurnTimer();
    this.s.clocks[side] = 0;
    this.flag(side);
  }

  private flag(side: Color): void {
    const opp = other(side);
    if (cannotMate(this.chess, opp)) this.finish(null, "timeout vs insufficient material");
    else this.finish(opp, "timeout");
  }

  resign(userId: string): void {
    const c = this.colorOf(userId);
    if (!c || this.s.status !== "active") return;
    if (this.s.moves.length < 2) return this.finish(null, "aborted");
    this.finish(other(c), "resignation");
  }

  abort(userId: string): void {
    if (this.colorOf(userId) && this.s.status === "active" && this.s.moves.length < 2) this.finish(null, "aborted");
  }

  offerDraw(userId: string): void {
    const c = this.colorOf(userId);
    if (!c || this.s.status !== "active" || this.s.moves.length < 2) return;
    if (this.s.drawOfferFrom === other(c)) return this.finish(null, "agreement");
    if (this.s.drawOfferFrom === c) return;
    this.s.drawOfferFrom = c;
    this.emit({ type: "draw_offer", gameId: this.id, from: c });
  }

  respondDraw(userId: string, accept: boolean): void {
    const c = this.colorOf(userId);
    if (!c || this.s.status !== "active" || this.s.drawOfferFrom !== other(c)) return;
    if (accept) return this.finish(null, "agreement");
    this.s.drawOfferFrom = null;
    this.emit({ type: "draw_offer", gameId: this.id, from: null, declinedBy: c });
  }

  addChat(userId: string, text: string): void {
    const c = this.colorOf(userId);
    if (!c) return;
    const line = { from: this.s[c].username, text, ts: Date.now() };
    this.s.chat = [...this.s.chat, line].slice(-MAX_CHAT_HISTORY);
    this.emit({ type: "chat", gameId: this.id, line });
  }

  private armAbandon(c: Color, delayMs: number): void {
    const pending = this.abandonTimers[c];
    if (pending) clearTimeout(pending);
    this.abandonTimers[c] = setTimeout(() => {
      if (this.s.status !== "active" || this.s.connected[c]) return;
      if (this.s.moves.length < 2) this.finish(null, "aborted");
      else this.finish(other(c), "abandonment");
    }, delayMs);
  }

  setConnected(userId: string, connected: boolean): void {
    const c = this.colorOf(userId);
    if (!c || this.s.connected[c] === connected) return;
    this.s.connected[c] = connected;
    const pending = this.abandonTimers[c];
    if (pending) clearTimeout(pending);
    delete this.abandonTimers[c];
    this.s.abandonAt[c] = null;

    if (!connected && this.s.status === "active") {
      this.s.abandonAt[c] = Date.now() + config.abandonTimeoutMs;
      this.armAbandon(c, config.abandonTimeoutMs);
    }
    if (!connected && this.s.rematchFrom === other(c)) this.s.rematchFrom = null;
    this.emit({
      type: "presence",
      gameId: this.id,
      color: c,
      connected,
      abandonMs: connected ? null : config.abandonTimeoutMs,
    });
  }

  private finish(winner: Color | null, reason: string): void {
    if (this.s.status !== "active") return;
    const endedAt = Date.now();
    // freeze the side-to-move's clock at the moment the game ended
    if (clockRunning(this.s)) this.s.clocks[this.turn] = this.remaining(this.turn, endedAt);
    this.s.status = "finished";
    this.s.drawOfferFrom = null;
    this.s.abandonAt = { white: null, black: null };
    this.clearTimers();

    const { white, black } = this.s;
    const aborted = reason === "aborted";
    const score = winner === "white" ? 1 : winner === "black" ? 0 : 0.5;
    const whiteDelta = aborted ? 0 : eloDelta(white.rating, black.rating, score, white.games);
    const blackDelta = aborted ? 0 : eloDelta(black.rating, white.rating, 1 - score, black.games);
    this.s.result = { winner, reason, whiteDelta, blackDelta };

    const resultTag = winner === "white" ? "1-0" : winner === "black" ? "0-1" : "1/2-1/2";
    this.chess.setHeader("Result", aborted ? "*" : resultTag);
    this.chess.setHeader("Termination", reason);

    // the manager persists this (async) once onFinish fires; aborted games aren't rated or stored
    this.record = aborted
      ? null
      : {
          id: this.id,
          whiteId: white.id,
          blackId: black.id,
          whiteName: white.username,
          blackName: black.username,
          whiteRating: white.rating,
          blackRating: black.rating,
          whiteDelta,
          blackDelta,
          tc: this.s.tc.id,
          result: resultTag,
          reason,
          pgn: this.chess.pgn(),
          moves: this.s.moves.map((m): StoredMove => ({ san: m.san, uci: `${m.from}${m.to}${m.promotion ?? ""}`, clock: m.clock })),
          startedAt: this.s.startedAt,
          endedAt,
        };

    this.emit({
      type: "game_over",
      gameId: this.id,
      result: this.s.result,
      clocks: clocksOf(this.s, endedAt),
      pgn: this.chess.pgn(),
    });
    this.onFinish(this);
  }

  private clearTimers(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    for (const t of Object.values(this.abandonTimers)) clearTimeout(t);
    this.abandonTimers = {};
  }

  /** Stop all timers (game evicted from memory or handed to another instance). */
  dispose(): void {
    this.clearTimers();
  }
}
