import { randomBytes } from "node:crypto";
import { Chess } from "chess.js";
import { config } from "./config.ts";
import { repo, type StoredMove } from "./db.ts";
import { eloDelta } from "./elo.ts";
import { log } from "./logger.ts";
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

export class Game {
  readonly id = randomBytes(6).toString("base64url");
  readonly chess = new Chess();
  readonly moves: PlayedMove[] = [];
  readonly spectators = new Set<string>();
  readonly startedAt = Date.now();
  status: "active" | "finished" = "active";
  result: GameResult | null = null;
  drawOfferFrom: Color | null = null;
  rematchFrom: Color | null = null;
  readonly connected = { white: true, black: true };

  private clocks: { white: number; black: number };
  private turnStartedAt = Date.now();
  private turnTimer: NodeJS.Timeout | null = null;
  private abandonTimers: Partial<Record<Color, { timer: NodeJS.Timeout; at: number }>> = {};
  private chat: ChatLine[] = [];
  private readonly white: PlayerInfo;
  private readonly black: PlayerInfo;
  private readonly tc: TimeControl;
  private readonly emit: Emit;
  private readonly onFinish: (g: Game) => void;

  constructor(
    white: PlayerInfo,
    black: PlayerInfo,
    tc: TimeControl,
    emit: Emit,
    onFinish: (g: Game) => void,
  ) {
    this.white = white;
    this.black = black;
    this.tc = tc;
    this.emit = emit;
    this.onFinish = onFinish;
    this.clocks = { white: tc.initialMs, black: tc.initialMs };
    this.chess.setHeader("Event", `Rated ${tc.id} game`);
    this.chess.setHeader("Site", "Gambit");
    this.chess.setHeader("Date", new Date().toISOString().slice(0, 10).replaceAll("-", "."));
    this.chess.setHeader("White", white.username);
    this.chess.setHeader("Black", black.username);
    this.chess.setHeader("WhiteElo", String(white.rating));
    this.chess.setHeader("BlackElo", String(black.rating));
    this.chess.setHeader("TimeControl", `${tc.initialMs / 1000}+${tc.incrementMs / 1000}`);
  }

  get whiteId(): string {
    return this.white.id;
  }
  get blackId(): string {
    return this.black.id;
  }
  get tcId(): string {
    return this.tc.id;
  }

  colorOf(userId: string): Color | null {
    return userId === this.white.id ? "white" : userId === this.black.id ? "black" : null;
  }

  private player(c: Color): PlayerInfo {
    return c === "white" ? this.white : this.black;
  }

  get turn(): Color {
    return this.chess.turn() === "w" ? "white" : "black";
  }

  /** Clocks only run once both sides have made their first move. */
  private get clockRunning(): boolean {
    return this.status === "active" && this.moves.length >= 2;
  }

  remaining(c: Color, now = Date.now()): number {
    const spent = this.clockRunning && this.turn === c ? now - this.turnStartedAt : 0;
    return Math.max(0, this.clocks[c] - spent);
  }

  clockSnapshot(now = Date.now()) {
    return {
      white: this.remaining("white", now),
      black: this.remaining("black", now),
      ticking: this.clockRunning ? this.turn : null,
      firstMoveMs:
        this.status === "active" && this.moves.length < 2
          ? Math.max(0, config.firstMoveTimeoutMs - (now - this.turnStartedAt))
          : null,
    };
  }

  view(forUser: string | null) {
    const now = Date.now();
    const abandon = (c: Color) => {
      const t = this.abandonTimers[c];
      return t ? Math.max(0, t.at - now) : null;
    };
    const pub = (p: PlayerInfo) => ({ id: p.id, username: p.username, rating: p.rating });
    return {
      id: this.id,
      tc: this.tc.id,
      white: pub(this.white),
      black: pub(this.black),
      you: forUser ? this.colorOf(forUser) : null,
      moves: this.moves.map(({ san, from, to, promotion }) => ({ san, from, to, promotion })),
      status: this.status,
      clocks: this.clockSnapshot(now),
      result: this.result,
      drawOfferFrom: this.drawOfferFrom,
      rematchFrom: this.rematchFrom,
      chat: this.chat,
      connected: this.connected,
      abandonMs: { white: abandon("white"), black: abandon("black") },
      spectators: this.spectators.size,
    };
  }

  start(): void {
    this.turnStartedAt = Date.now();
    this.scheduleTurnTimer();
    this.emit({ type: "game_state", game: this.view(this.white.id) }, this.white.id);
    this.emit({ type: "game_state", game: this.view(this.black.id) }, this.black.id);
  }

  /** Returns an error message, or null on success. */
  move(userId: string, input: MoveInput): string | null {
    if (this.status !== "active") return "Game is over";
    const color = this.colorOf(userId);
    if (!color) return "You are not playing in this game";
    if (color !== this.turn) return "Not your turn";

    const now = Date.now();
    const clockWasRunning = this.clockRunning;
    if (clockWasRunning && this.remaining(color, now) <= 0) {
      this.clocks[color] = 0;
      this.flag(color);
      return "Out of time";
    }

    let played;
    try {
      played = this.chess.move(input);
    } catch {
      return "Illegal move";
    }
    if (clockWasRunning) {
      this.clocks[color] = this.clocks[color] - (now - this.turnStartedAt) + this.tc.incrementMs;
    }

    const promotion = played.promotion as MoveInput["promotion"];
    const record: PlayedMove = { san: played.san, from: played.from, to: played.to, clock: this.clocks[color] };
    if (promotion) record.promotion = promotion;
    this.moves.push(record);
    this.turnStartedAt = now;
    if (this.drawOfferFrom && this.drawOfferFrom !== color) this.drawOfferFrom = null;

    this.emit({
      type: "move",
      gameId: this.id,
      move: { san: record.san, from: record.from, to: record.to, promotion: record.promotion },
      ply: this.moves.length,
      clocks: this.clockSnapshot(now),
      drawOfferFrom: this.drawOfferFrom,
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
    if (this.status !== "active") return;
    const side = this.turn;
    if (this.moves.length < 2) {
      this.turnTimer = setTimeout(() => this.finish(null, "aborted"), config.firstMoveTimeoutMs);
    } else {
      // +5ms so remaining() is already <= 0 when it fires
      this.turnTimer = setTimeout(() => this.checkFlag(side), this.remaining(side) + 5);
    }
  }

  private checkFlag(side: Color): void {
    if (this.status !== "active" || this.turn !== side) return;
    if (this.remaining(side) > 0) return this.scheduleTurnTimer();
    this.clocks[side] = 0;
    this.flag(side);
  }

  private flag(side: Color): void {
    const opp = other(side);
    if (cannotMate(this.chess, opp)) this.finish(null, "timeout vs insufficient material");
    else this.finish(opp, "timeout");
  }

  resign(userId: string): void {
    const c = this.colorOf(userId);
    if (!c || this.status !== "active") return;
    if (this.moves.length < 2) return this.finish(null, "aborted");
    this.finish(other(c), "resignation");
  }

  abort(userId: string): void {
    if (this.colorOf(userId) && this.status === "active" && this.moves.length < 2) this.finish(null, "aborted");
  }

  offerDraw(userId: string): void {
    const c = this.colorOf(userId);
    if (!c || this.status !== "active" || this.moves.length < 2) return;
    if (this.drawOfferFrom === other(c)) return this.finish(null, "agreement");
    if (this.drawOfferFrom === c) return;
    this.drawOfferFrom = c;
    this.emit({ type: "draw_offer", gameId: this.id, from: c });
  }

  respondDraw(userId: string, accept: boolean): void {
    const c = this.colorOf(userId);
    if (!c || this.status !== "active" || this.drawOfferFrom !== other(c)) return;
    if (accept) return this.finish(null, "agreement");
    this.drawOfferFrom = null;
    this.emit({ type: "draw_offer", gameId: this.id, from: null, declinedBy: c });
  }

  addChat(userId: string, text: string): void {
    const c = this.colorOf(userId);
    if (!c) return;
    const line = { from: this.player(c).username, text, ts: Date.now() };
    this.chat = [...this.chat, line].slice(-MAX_CHAT_HISTORY);
    this.emit({ type: "chat", gameId: this.id, line });
  }

  setConnected(userId: string, connected: boolean): void {
    const c = this.colorOf(userId);
    if (!c || this.connected[c] === connected) return;
    this.connected[c] = connected;
    const pending = this.abandonTimers[c];
    if (pending) clearTimeout(pending.timer);
    delete this.abandonTimers[c];

    if (!connected && this.status === "active") {
      const at = Date.now() + config.abandonTimeoutMs;
      const timer = setTimeout(() => {
        if (this.status !== "active" || this.connected[c]) return;
        if (this.moves.length < 2) this.finish(null, "aborted");
        else this.finish(other(c), "abandonment");
      }, config.abandonTimeoutMs);
      this.abandonTimers[c] = { timer, at };
    }
    if (!connected && this.rematchFrom === other(c)) this.rematchFrom = null;
    this.emit({
      type: "presence",
      gameId: this.id,
      color: c,
      connected,
      abandonMs: connected ? null : config.abandonTimeoutMs,
    });
  }

  private finish(winner: Color | null, reason: string): void {
    if (this.status !== "active") return;
    const endedAt = Date.now();
    // freeze the side-to-move's clock at the moment the game ended
    if (this.clockRunning) this.clocks[this.turn] = this.remaining(this.turn, endedAt);
    this.status = "finished";
    this.drawOfferFrom = null;
    if (this.turnTimer) clearTimeout(this.turnTimer);
    for (const t of Object.values(this.abandonTimers)) clearTimeout(t.timer);
    this.abandonTimers = {};

    const aborted = reason === "aborted";
    const score = winner === "white" ? 1 : winner === "black" ? 0 : 0.5;
    const whiteDelta = aborted ? 0 : eloDelta(this.white.rating, this.black.rating, score, this.white.games);
    const blackDelta = aborted ? 0 : eloDelta(this.black.rating, this.white.rating, 1 - score, this.black.games);
    this.result = { winner, reason, whiteDelta, blackDelta };

    const resultTag = winner === "white" ? "1-0" : winner === "black" ? "0-1" : "1/2-1/2";
    this.chess.setHeader("Result", aborted ? "*" : resultTag);
    this.chess.setHeader("Termination", reason);

    if (!aborted) {
      try {
        repo.saveFinishedGame({
          id: this.id,
          whiteId: this.white.id,
          blackId: this.black.id,
          whiteName: this.white.username,
          blackName: this.black.username,
          whiteRating: this.white.rating,
          blackRating: this.black.rating,
          whiteDelta,
          blackDelta,
          tc: this.tc.id,
          result: resultTag,
          reason,
          pgn: this.chess.pgn(),
          moves: this.moves.map(
            (m): StoredMove => ({ san: m.san, uci: `${m.from}${m.to}${m.promotion ?? ""}`, clock: m.clock }),
          ),
          startedAt: this.startedAt,
          endedAt,
        });
      } catch (err) {
        log.error(`failed to persist game ${this.id}`, err);
      }
    }

    this.emit({
      type: "game_over",
      gameId: this.id,
      result: this.result,
      clocks: this.clockSnapshot(endedAt),
      pgn: this.chess.pgn(),
    });
    this.onFinish(this);
  }

  /** Called by the manager when the game is evicted from memory. */
  dispose(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    for (const t of Object.values(this.abandonTimers)) clearTimeout(t.timer);
  }
}
