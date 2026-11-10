import { randomInt } from "node:crypto";
import type { WebSocket } from "ws";
import { config } from "./config.ts";
import { repo } from "./db.ts";
import { Game, type PlayerInfo } from "./Game.ts";
import { log } from "./logger.ts";
import { parseClientMessage, parseTimeControl, type ClientMessage, type Color } from "./protocol.ts";

interface Room {
  code: string;
  hostId: string;
  tc: string;
  color: Color | "random";
}

interface Bucket {
  tokens: number;
  last: number;
  strikes: number;
}

const RATE_PER_SEC = 12;
const RATE_STRIKES_TO_CLOSE = 20;
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class GameManager {
  private sockets = new Map<string, Set<WebSocket>>();
  private buckets = new WeakMap<WebSocket, Bucket>();
  private games = new Map<string, Game>();
  /** userId -> id of the game they are currently playing (active only) */
  private activeGameOf = new Map<string, string>();
  /** tc -> userIds waiting, oldest first */
  private queues = new Map<string, string[]>();
  private rooms = new Map<string, Room>();

  // ---------- connections ----------

  connect(ws: WebSocket, userId: string): void {
    const set = this.sockets.get(userId) ?? new Set();
    set.add(ws);
    this.sockets.set(userId, set);
    this.buckets.set(ws, { tokens: RATE_PER_SEC, last: Date.now(), strikes: 0 });

    const user = repo.findUserById(userId);
    this.sendTo(ws, { type: "hello", user, ...this.lobbyStatus(userId) });

    const active = this.activeGame(userId);
    if (active) {
      active.setConnected(userId, true);
      this.sendTo(ws, { type: "game_state", game: active.view(userId) });
    }

    ws.on("message", (data) => {
      if (!this.allow(ws)) return;
      const msg = parseClientMessage(data.toString());
      if (!msg) return this.sendTo(ws, { type: "error", message: "Malformed message" });
      try {
        this.handle(ws, userId, msg);
      } catch (err) {
        log.error("message handler failed", err);
        this.sendTo(ws, { type: "error", message: "Something went wrong" });
      }
    });
    ws.on("close", () => this.disconnect(ws, userId));
  }

  private disconnect(ws: WebSocket, userId: string): void {
    const set = this.sockets.get(userId);
    set?.delete(ws);
    if (set && set.size > 0) return;
    this.sockets.delete(userId);
    this.leaveQueue(userId);
    this.closeRoomsOf(userId);
    this.activeGame(userId)?.setConnected(userId, false);
    for (const g of this.games.values()) {
      if (g.spectators.delete(userId)) this.broadcastSpectators(g);
    }
  }

  private allow(ws: WebSocket): boolean {
    const b = this.buckets.get(ws);
    if (!b) return false;
    const now = Date.now();
    b.tokens = Math.min(RATE_PER_SEC, b.tokens + ((now - b.last) / 1000) * RATE_PER_SEC);
    b.last = now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      b.strikes = 0;
      return true;
    }
    if (++b.strikes >= RATE_STRIKES_TO_CLOSE) ws.close(1008, "Rate limit exceeded");
    return false;
  }

  private sendTo(ws: WebSocket, msg: object): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private sendUser(userId: string, msg: object): void {
    const data = JSON.stringify(msg);
    for (const ws of this.sockets.get(userId) ?? []) if (ws.readyState === ws.OPEN) ws.send(data);
  }

  isOnline(userId: string): boolean {
    return this.sockets.has(userId);
  }

  // ---------- message routing ----------

  private handle(ws: WebSocket, userId: string, msg: ClientMessage): void {
    switch (msg.type) {
      case "ping":
        return this.sendTo(ws, { type: "pong", t: msg.t });
      case "queue":
        return this.enqueue(userId, msg.tc);
      case "cancel_queue":
        this.leaveQueue(userId);
        return this.sendUser(userId, { type: "lobby", ...this.lobbyStatus(userId) });
      case "create_room":
        return this.createRoom(userId, msg.tc, msg.color);
      case "join_room":
        return this.joinRoom(userId, msg.code);
      case "cancel_room":
        this.closeRoomsOf(userId);
        return this.sendUser(userId, { type: "lobby", ...this.lobbyStatus(userId) });
      case "spectate":
        return this.spectate(ws, userId, msg.gameId);
      case "unspectate": {
        const g = this.games.get(msg.gameId);
        if (g?.spectators.delete(userId)) this.broadcastSpectators(g);
        return;
      }
      case "rematch_offer":
        return this.rematch(userId, msg.gameId);
      case "rematch_decline":
        return this.declineRematch(userId, msg.gameId);
    }

    const game = this.games.get(msg.gameId);
    if (!game || !game.colorOf(userId)) {
      return this.sendTo(ws, { type: "error", message: "Game not found" });
    }
    switch (msg.type) {
      case "move": {
        const err = game.move(userId, msg.move);
        if (err) this.sendTo(ws, { type: "move_rejected", gameId: game.id, reason: err, game: game.view(userId) });
        return;
      }
      case "resign":
        return game.resign(userId);
      case "abort":
        return game.abort(userId);
      case "draw_offer":
        return game.offerDraw(userId);
      case "draw_respond":
        return game.respondDraw(userId, msg.accept);
      case "chat":
        return game.addChat(userId, msg.text);
    }
  }

  // ---------- lobby ----------

  private lobbyStatus(userId: string) {
    let queuedFor: string | null = null;
    for (const [tc, q] of this.queues) if (q.includes(userId)) queuedFor = tc;
    const room = [...this.rooms.values()].find((r) => r.hostId === userId) ?? null;
    return { queuedFor, room };
  }

  private activeGame(userId: string): Game | undefined {
    const id = this.activeGameOf.get(userId);
    return id ? this.games.get(id) : undefined;
  }

  /** If the user is mid-game, re-send it instead of starting something new. */
  private redirectIfPlaying(userId: string): boolean {
    const g = this.activeGame(userId);
    if (!g) return false;
    this.sendUser(userId, { type: "game_state", game: g.view(userId) });
    return true;
  }

  private enqueue(userId: string, tc: string): void {
    if (this.redirectIfPlaying(userId)) return;
    this.leaveQueue(userId);
    this.closeRoomsOf(userId);
    const queue = this.queues.get(tc) ?? [];
    // ponytail: FIFO pairing; add rating-window matching once the player pool is big enough to afford waiting
    const opponent = queue.find((id) => id !== userId && this.isOnline(id));
    if (opponent) {
      this.queues.set(tc, queue.filter((id) => id !== opponent));
      const [w, b] = randomInt(2) === 0 ? [userId, opponent] : [opponent, userId];
      this.startGame(w, b, tc);
      return;
    }
    this.queues.set(tc, [...queue, userId]);
    this.sendUser(userId, { type: "lobby", ...this.lobbyStatus(userId) });
  }

  private leaveQueue(userId: string): void {
    for (const [tc, q] of this.queues) {
      if (q.includes(userId)) this.queues.set(tc, q.filter((id) => id !== userId));
    }
  }

  private createRoom(userId: string, tc: string, color: Color | "random"): void {
    if (this.redirectIfPlaying(userId)) return;
    this.leaveQueue(userId);
    this.closeRoomsOf(userId);
    let code = "";
    do {
      code = Array.from({ length: 6 }, () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)]).join("");
    } while (this.rooms.has(code));
    this.rooms.set(code, { code, hostId: userId, tc, color });
    this.sendUser(userId, { type: "lobby", ...this.lobbyStatus(userId) });
  }

  private joinRoom(userId: string, code: string): void {
    if (this.redirectIfPlaying(userId)) return;
    const room = this.rooms.get(code);
    if (!room || !this.isOnline(room.hostId)) {
      return this.sendUser(userId, { type: "error", message: "That invite has expired or does not exist." });
    }
    if (room.hostId === userId) {
      return this.sendUser(userId, { type: "error", message: "Share this link with a friend — you can't join your own room." });
    }
    if (this.activeGame(room.hostId)) {
      return this.sendUser(userId, { type: "error", message: "Your friend is already in another game." });
    }
    this.rooms.delete(code);
    this.leaveQueue(userId);
    this.closeRoomsOf(userId);
    const hostWhite = room.color === "white" || (room.color === "random" && randomInt(2) === 0);
    this.startGame(hostWhite ? room.hostId : userId, hostWhite ? userId : room.hostId, room.tc);
  }

  private closeRoomsOf(userId: string): void {
    for (const [code, r] of this.rooms) if (r.hostId === userId) this.rooms.delete(code);
  }

  // ---------- games ----------

  private playerInfo(userId: string): PlayerInfo | null {
    const u = repo.findUserById(userId);
    return u ? { id: u.id, username: u.username, rating: u.rating, games: u.games } : null;
  }

  private startGame(whiteId: string, blackId: string, tcId: string): Game | null {
    const tc = parseTimeControl(tcId);
    const white = this.playerInfo(whiteId);
    const black = this.playerInfo(blackId);
    if (!tc || !white || !black) {
      log.warn("could not start game", { whiteId, blackId, tcId });
      return null;
    }
    for (const id of [whiteId, blackId]) {
      this.leaveQueue(id);
      this.closeRoomsOf(id);
    }
    const game = new Game(white, black, tc, (msg, to) => this.deliver(game, msg, to), (g) => this.onFinished(g));
    this.games.set(game.id, game);
    this.activeGameOf.set(whiteId, game.id);
    this.activeGameOf.set(blackId, game.id);
    game.start();
    if (!this.isOnline(whiteId)) game.setConnected(whiteId, false);
    if (!this.isOnline(blackId)) game.setConnected(blackId, false);
    log.info("game started", { id: game.id, white: white.username, black: black.username, tc: tcId });
    return game;
  }

  private deliver(game: Game, msg: object, to?: string): void {
    if (to) return this.sendUser(to, msg);
    this.sendUser(game.whiteId, msg);
    this.sendUser(game.blackId, msg);
    for (const s of game.spectators) this.sendUser(s, msg);
  }

  private onFinished(game: Game): void {
    for (const id of [game.whiteId, game.blackId]) {
      if (this.activeGameOf.get(id) === game.id) this.activeGameOf.delete(id);
    }
    log.info("game finished", { id: game.id, ...game.result });
    // keep it around briefly for rematches and late spectators
    setTimeout(() => {
      if (this.games.get(game.id) === game) {
        game.dispose();
        this.games.delete(game.id);
      }
    }, config.finishedGameTtlMs).unref();
  }

  private spectate(ws: WebSocket, userId: string, gameId: string): void {
    const game = this.games.get(gameId);
    if (!game) return this.sendTo(ws, { type: "spectate_missing", gameId });
    if (!game.colorOf(userId)) {
      game.spectators.add(userId);
      this.broadcastSpectators(game);
    }
    this.sendTo(ws, { type: "game_state", game: game.view(userId) });
  }

  private broadcastSpectators(game: Game): void {
    this.deliver(game, { type: "spectators", gameId: game.id, count: game.spectators.size });
  }

  private rematch(userId: string, gameId: string): void {
    const game = this.games.get(gameId);
    const color = game?.colorOf(userId);
    if (!game || !color || game.status !== "finished") return;
    const opponentId = color === "white" ? game.blackId : game.whiteId;
    if (this.activeGame(userId) || this.activeGame(opponentId)) {
      return this.sendUser(userId, { type: "error", message: "Rematch unavailable — a player is already in another game." });
    }
    if (game.rematchFrom && game.rematchFrom !== color) {
      game.rematchFrom = null;
      // colors swap for the rematch
      this.startGame(game.blackId, game.whiteId, game.tcId);
      return;
    }
    if (!this.isOnline(opponentId)) {
      return this.sendUser(userId, { type: "error", message: "Your opponent has left." });
    }
    game.rematchFrom = color;
    this.deliver(game, { type: "rematch", gameId, from: color });
  }

  private declineRematch(userId: string, gameId: string): void {
    const game = this.games.get(gameId);
    const color = game?.colorOf(userId);
    if (!game || !color || !game.rematchFrom || game.rematchFrom === color) return;
    game.rematchFrom = null;
    this.deliver(game, { type: "rematch", gameId, from: null, declinedBy: color });
  }

  // ---------- public queries ----------

  liveGames() {
    return [...this.games.values()]
      .filter((g) => g.status === "active")
      .map((g) => {
        const v = g.view(null);
        return { id: v.id, tc: v.tc, white: v.white, black: v.black, ply: v.moves.length, fen: g.chess.fen(), spectators: v.spectators };
      })
      .sort((a, b) => b.white.rating + b.black.rating - (a.white.rating + a.black.rating));
  }

  stats() {
    let playing = 0;
    for (const g of this.games.values()) if (g.status === "active") playing++;
    let waiting = 0;
    for (const q of this.queues.values()) waiting += q.length;
    return { online: this.sockets.size, playing, waiting };
  }

  shutdown(): void {
    for (const g of this.games.values()) g.dispose();
    for (const set of this.sockets.values()) for (const ws of set) ws.close(1001, "Server restarting");
  }
}
