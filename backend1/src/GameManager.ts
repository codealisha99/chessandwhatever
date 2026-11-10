import { randomInt } from "node:crypto";
import type { WebSocket } from "ws";
import { config } from "./config.ts";
import { repo } from "./db.ts";
import { Game, viewOf, type GameSnapshot, type PlayerInfo } from "./Game.ts";
import { log } from "./logger.ts";
import { retry } from "./retry.ts";
import { parseClientMessage, parseTimeControl, TIME_CONTROLS, type ClientMessage, type Color } from "./protocol.ts";
import { bus, CH, games, presence, queue, rooms } from "./redis.ts";

/**
 * Cluster-aware game coordinator. Every instance runs one of these.
 *
 * - Sockets are local; everything a user should see is published on `ch:user:{uid}`, and each
 *   instance forwards those messages to its own sockets for that user. Spectators use `ch:watch:{gid}`.
 * - Each game is *owned* by one instance (Redis lease), which holds the Game object and its timers.
 *   Other instances forward player actions to the owner over `ch:instance:{iid}`.
 * - After every change the owner commits a snapshot to Redis. If an owner dies, its lease expires and
 *   any instance adopts the game from the snapshot (`takeover`) — clocks resume exactly.
 */

type GameCommand = ClientMessage | { type: "presence"; connected: boolean };
interface Envelope {
  gid: string;
  uid: string;
  msg: GameCommand;
}

interface Bucket {
  tokens: number;
  last: number;
  strikes: number;
}

const RATE_PER_SEC = 12;
const RATE_STRIKES_TO_CLOSE = 20;
/** don't buffer unboundedly for a client that stopped reading */
const MAX_BUFFERED_BYTES = 1 << 20;

const GAME_ACTIONS = new Set(["move", "resign", "abort", "draw_offer", "draw_respond", "chat", "rematch_offer", "rematch_decline"]);

export class GameManager {
  private sockets = new Map<string, Set<WebSocket>>();
  private userHandlers = new Map<string, (raw: string) => void>();
  private watching = new Map<WebSocket, string>();
  private watchHandlers = new Map<string, (raw: string) => void>();
  private buckets = new WeakMap<WebSocket, Bucket>();
  private owned = new Map<string, Game>();
  private outbox = new Map<string, Promise<void>>();
  private timer: NodeJS.Timeout | null = null;
  private takingOver = new Map<string, Promise<Game | null>>();
  private stopping = false;

  async start(): Promise<void> {
    await presence.heartbeat();
    await bus.on(CH.instance(config.instanceId), (raw) => {
      const env = JSON.parse(raw) as Envelope;
      void this.onCommand(env);
    });
    this.timer = setInterval(() => void this.tick(), config.heartbeatMs);
    void this.tick();
  }

  // ---------- connections ----------

  connect(ws: WebSocket, userId: string): void {
    this.buckets.set(ws, { tokens: RATE_PER_SEC, last: Date.now(), strikes: 0 });
    // serialise this socket's messages behind its setup, so nothing is processed before we're subscribed
    let chain: Promise<void> = this.attach(ws, userId).catch((err) => {
      log.error("socket setup failed", err);
      ws.close(1011, "Setup failed");
    });
    ws.on("message", (data) => {
      if (!this.allow(ws)) return;
      const msg = parseClientMessage(data.toString());
      if (!msg) return this.sendTo(ws, { type: "error", message: "Malformed message" });
      chain = chain.then(() =>
        this.handle(ws, userId, msg).catch((err) => {
          log.error("message handler failed", err);
          this.sendTo(ws, { type: "error", message: "Something went wrong. Please try again." });
        }),
      );
    });
    ws.on("close", () => {
      chain = chain.then(() => this.detach(ws, userId)).catch((err) => log.error("socket teardown failed", err));
    });
  }

  private async attach(ws: WebSocket, userId: string): Promise<void> {
    let set = this.sockets.get(userId);
    if (!set) {
      set = new Set();
      this.sockets.set(userId, set);
      const forward = (raw: string) => {
        for (const s of this.sockets.get(userId) ?? []) this.sendRaw(s, raw);
      };
      this.userHandlers.set(userId, forward);
      await bus.on(CH.user(userId), forward);
      await presence.add(userId);
    }
    set.add(ws);

    const user = await repo.findUserById(userId);
    this.sendTo(ws, { type: "hello", user, instance: config.instanceId, ...(await this.lobbyStatus(userId)) });

    const gid = await games.activeOf(userId);
    if (!gid) return;
    // answer from the snapshot right away; the owner may be mid-failover and not reachable yet
    const snap = await games.load(gid);
    if (snap?.status === "active") this.sendTo(ws, { type: "game_state", game: viewOf(snap, userId, await games.watcherCount(gid)) });
    await this.route(gid, userId, { type: "presence", connected: true });
  }

  private async detach(ws: WebSocket, userId: string): Promise<void> {
    if (this.stopping) return;
    await this.unwatch(ws, userId);
    const set = this.sockets.get(userId);
    set?.delete(ws);
    if (!set || set.size > 0) return;

    this.sockets.delete(userId);
    const h = this.userHandlers.get(userId);
    this.userHandlers.delete(userId);
    if (h) await bus.off(CH.user(userId), h);
    await presence.remove(userId);

    // still connected through another instance? then nothing changes for them
    if (await presence.isOnline(userId)) return;
    await queue.leave(userId);
    await rooms.closeFor(userId);
    const gid = await games.activeOf(userId);
    if (gid) await this.route(gid, userId, { type: "presence", connected: false });
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

  private sendRaw(ws: WebSocket, raw: string): void {
    if (ws.readyState !== ws.OPEN) return;
    if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      ws.close(1013, "Client too slow");
      return;
    }
    ws.send(raw);
  }

  private sendTo(ws: WebSocket, msg: object): void {
    this.sendRaw(ws, JSON.stringify(msg));
  }

  private toUser(uid: string, msg: object): void {
    bus.publish(CH.user(uid), msg);
  }

  // ---------- routing ----------

  private async handle(ws: WebSocket, userId: string, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case "ping":
        return this.sendTo(ws, { type: "pong", t: msg.t });
      case "queue":
        return this.enqueue(userId, msg.tc);
      case "cancel_queue":
        await queue.leave(userId);
        return this.pushLobby(userId);
      case "create_room":
        return this.createRoom(userId, msg.tc, msg.color);
      case "join_room":
        return this.joinRoom(userId, msg.code);
      case "cancel_room":
        await rooms.closeFor(userId);
        return this.pushLobby(userId);
      case "spectate":
        return this.spectate(ws, userId, msg.gameId);
      case "unspectate":
        return this.unwatch(ws, userId);
    }
    if (GAME_ACTIONS.has(msg.type) && "gameId" in msg) return this.route(msg.gameId, userId, msg);
  }

  /** Run a command on the game's owner — locally, via pub/sub, or by adopting an orphaned game. */
  private async route(gid: string, uid: string, msg: GameCommand): Promise<void> {
    const local = this.owned.get(gid);
    if (local) return this.apply(local, uid, msg);
    const owner = await games.ownerOf(gid);
    if (owner && owner !== config.instanceId) {
      const received = await bus.deliver(CH.instance(owner), { gid, uid, msg } satisfies Envelope);
      if (received > 0) return;
      // nobody subscribed: the owner process is gone. Take the game now instead of waiting out its lease.
      log.warn("owner unreachable, taking over", { id: gid, owner });
      await games.steal(gid, owner);
    }
    const adopted = await this.takeover(gid);
    if (adopted) return this.apply(adopted, uid, msg);
    if (msg.type !== "presence") this.toUser(uid, { type: "error", message: "That game is no longer available." });
  }

  private async onCommand({ gid, uid, msg }: Envelope): Promise<void> {
    const game = this.owned.get(gid) ?? (await this.takeover(gid));
    if (game) await this.apply(game, uid, msg);
    else if (msg.type !== "presence") this.toUser(uid, { type: "error", message: "That game is no longer available." });
  }

  /** Owner-side: actually mutate the game. */
  private async apply(game: Game, uid: string, msg: GameCommand): Promise<void> {
    if (!game.colorOf(uid)) return;
    switch (msg.type) {
      case "presence":
        game.setConnected(uid, msg.connected);
        if (msg.connected) this.toUser(uid, { type: "game_state", game: game.view(uid, await games.watcherCount(game.id)) });
        return;
      case "move": {
        const err = game.move(uid, msg.move);
        if (err) this.toUser(uid, { type: "move_rejected", gameId: game.id, reason: err, game: game.view(uid, await games.watcherCount(game.id)) });
        return;
      }
      case "resign":
        return game.resign(uid);
      case "abort":
        return game.abort(uid);
      case "draw_offer":
        return game.offerDraw(uid);
      case "draw_respond":
        return game.respondDraw(uid, msg.accept);
      case "chat":
        return game.addChat(uid, msg.text);
      case "rematch_offer":
        return this.rematch(game, uid);
      case "rematch_decline":
        return this.declineRematch(game, uid);
    }
  }

  // ---------- ownership ----------

  private adopt(snapshot: GameSnapshot): Game {
    const game: Game = new Game(snapshot, (msg, to) => this.deliver(game, msg, to), (g) => this.onFinished(g));
    this.owned.set(game.id, game);
    return game;
  }

  /** Adopt a game whose owner is gone. Deduplicated so concurrent callers share one attempt. */
  private takeover(gid: string): Promise<Game | null> {
    const pending = this.takingOver.get(gid);
    if (pending) return pending;
    const attempt = (async () => {
      const snap = await games.load(gid);
      if (!snap) {
        await games.dropLive(gid);
        return null;
      }
      const claimed = (await games.claim(gid)) || (await games.ownerOf(gid)) === config.instanceId;
      if (!claimed) return null;
      const existing = this.owned.get(gid);
      if (existing) return existing;
      const game = this.adopt(snap);
      log.info("adopted game", { id: gid, status: snap.status, moves: snap.moves.length });
      if (game.status === "active") {
        for (const id of [game.whiteId, game.blackId]) {
          const online = await presence.isOnline(id);
          if (game.connected[game.colorOf(id)!] !== online) game.setConnected(id, online);
        }
        game.resume();
      } else {
        this.scheduleEviction(game);
      }
      return game;
    })().finally(() => this.takingOver.delete(gid));
    this.takingOver.set(gid, attempt);
    return attempt;
  }

  /** Publish an event and commit the snapshot that produced it, in order per game. */
  private deliver(game: Game, msg: object, to?: string): void {
    const payload = JSON.stringify(msg);
    const channels = to ? [CH.user(to)] : [CH.user(game.whiteId), CH.user(game.blackId), CH.watch(game.id)];
    const snapshot = game.snapshot();
    const prev = this.outbox.get(game.id) ?? Promise.resolve();
    const next = prev
      .then(() => games.commit(snapshot, channels.map((ch) => [ch, payload])))
      .catch((err) => log.error(`commit failed for game ${game.id}`, err));
    this.outbox.set(game.id, next);
  }

  private onFinished(game: Game): void {
    log.info("game finished", { id: game.id, ...game.result });
    if (game.record) {
      // the save is idempotent (insert-if-absent, ratings applied in the same transaction), so retrying is safe
      const record = game.record;
      retry(`saving game ${game.id}`, () => repo.saveFinishedGame(record)).catch((err) => log.error(`gave up saving game ${game.id}`, err));
    }
    this.scheduleEviction(game);
  }

  private scheduleEviction(game: Game): void {
    // keep finished games briefly for rematches
    setTimeout(() => {
      if (this.owned.get(game.id) !== game) return;
      game.dispose();
      this.owned.delete(game.id);
      this.outbox.delete(game.id);
      void games.release(game.id);
    }, config.finishedGameTtlMs).unref();
  }

  private async tick(): Promise<void> {
    try {
      await presence.heartbeat();
      for (const uid of this.sockets.keys()) await presence.add(uid); // survives a Redis restart
      for (const [gid, game] of this.owned) {
        if (await games.renew(gid)) continue;
        // lease expired (we stalled) and someone else may have it — never run two clocks
        if (await games.claim(gid)) continue;
        log.warn("lost ownership of game", { id: gid });
        game.dispose();
        this.owned.delete(gid);
      }
      // adopt orphaned games (owner crashed or shut down)
      for (const gid of await games.liveIds(500)) {
        if (!this.owned.has(gid) && !(await games.ownerOf(gid))) await this.takeover(gid);
      }
    } catch (err) {
      log.warn("cluster tick failed", { message: (err as Error).message });
    }
  }

  // ---------- lobby ----------

  private async lobbyStatus(userId: string) {
    const [queuedFor, room] = await Promise.all([queue.of(userId), rooms.of(userId)]);
    return { queuedFor, room };
  }

  private async pushLobby(userId: string): Promise<void> {
    this.toUser(userId, { type: "lobby", ...(await this.lobbyStatus(userId)) });
  }

  /** If the user is mid-game, re-send it instead of starting something new. */
  private async redirectIfPlaying(userId: string): Promise<boolean> {
    const gid = await games.activeOf(userId);
    if (!gid) return false;
    const snap = await games.load(gid);
    if (!snap || snap.status !== "active") return false;
    this.toUser(userId, { type: "game_state", game: viewOf(snap, userId, await games.watcherCount(gid)) });
    return true;
  }

  private async enqueue(userId: string, tc: string): Promise<void> {
    if (await this.redirectIfPlaying(userId)) return;
    await rooms.closeFor(userId);
    for (let tries = 0; tries < 20; tries++) {
      const opponent = await queue.match(userId, tc);
      if (!opponent) return this.pushLobby(userId);
      // skip stale queue entries (opponent vanished or already playing)
      if (opponent === userId || !(await presence.isOnline(opponent)) || (await games.activeOf(opponent))) continue;
      const [w, b] = randomInt(2) === 0 ? [userId, opponent] : [opponent, userId];
      if (await this.startGame(w, b, tc)) return;
    }
    await this.pushLobby(userId);
  }

  private async createRoom(userId: string, tc: string, color: Color | "random"): Promise<void> {
    if (await this.redirectIfPlaying(userId)) return;
    await queue.leave(userId);
    await rooms.closeFor(userId);
    await rooms.create(userId, tc, color);
    await this.pushLobby(userId);
  }

  private async joinRoom(userId: string, code: string): Promise<void> {
    if (await this.redirectIfPlaying(userId)) return;
    const fail = (message: string) => this.toUser(userId, { type: "error", message });
    const peek = await rooms.peek(code);
    if (!peek || !(await presence.isOnline(peek.hostId))) return fail("That invite has expired or does not exist.");
    if (peek.hostId === userId) return fail("Share this link with a friend — you can't join your own room.");
    if (await games.activeOf(peek.hostId)) return fail("Your friend is already in another game.");
    const room = await rooms.take(code);
    if (!room) return fail("Someone else just joined that invite.");
    await queue.leave(userId);
    await rooms.closeFor(userId);
    const hostWhite = room.color === "white" || (room.color === "random" && randomInt(2) === 0);
    await this.startGame(hostWhite ? room.hostId : userId, hostWhite ? userId : room.hostId, room.tc);
  }

  // ---------- games ----------

  private async playerInfo(userId: string): Promise<PlayerInfo | null> {
    const u = await repo.findUserById(userId);
    return u ? { id: u.id, username: u.username, rating: u.rating, games: u.games } : null;
  }

  private async startGame(whiteId: string, blackId: string, tcId: string): Promise<Game | null> {
    const tc = parseTimeControl(tcId);
    const [white, black] = await Promise.all([this.playerInfo(whiteId), this.playerInfo(blackId)]);
    if (!tc || !white || !black) {
      log.warn("could not start game", { whiteId, blackId, tcId });
      return null;
    }
    await Promise.all([whiteId, blackId].flatMap((id) => [queue.leave(id), rooms.closeFor(id)]));
    const game: Game = new Game({ white, black, tc }, (msg, to) => this.deliver(game, msg, to), (g) => this.onFinished(g));
    this.owned.set(game.id, game);
    await games.claim(game.id);
    game.start();
    for (const id of [whiteId, blackId]) if (!(await presence.isOnline(id))) game.setConnected(id, false);
    log.info("game started", { id: game.id, white: white.username, black: black.username, tc: tcId });
    return game;
  }

  private async spectate(ws: WebSocket, userId: string, gid: string): Promise<void> {
    const snap = await games.load(gid);
    if (!snap) return this.sendTo(ws, { type: "spectate_missing", gameId: gid });
    const isPlayer = userId === snap.white.id || userId === snap.black.id;
    let count = await games.watcherCount(gid);
    if (!isPlayer && this.watching.get(ws) !== gid) {
      await this.unwatch(ws, userId);
      this.watching.set(ws, gid);
      if (!this.watchHandlers.has(gid)) {
        const forward = (raw: string) => {
          for (const [s, g] of this.watching) if (g === gid) this.sendRaw(s, raw);
        };
        this.watchHandlers.set(gid, forward);
        await bus.on(CH.watch(gid), forward);
      }
      count = await games.watch(gid, userId);
      this.announceSpectators(snap, count);
    }
    // read again after subscribing so no move falls between snapshot and stream
    const fresh = (await games.load(gid)) ?? snap;
    this.sendTo(ws, { type: "game_state", game: viewOf(fresh, userId, count) });
  }

  private async unwatch(ws: WebSocket, userId: string): Promise<void> {
    const gid = this.watching.get(ws);
    if (!gid) return;
    this.watching.delete(ws);
    if (![...this.watching.values()].includes(gid)) {
      const h = this.watchHandlers.get(gid);
      this.watchHandlers.delete(gid);
      if (h) await bus.off(CH.watch(gid), h);
    }
    const count = await games.unwatch(gid, userId);
    const snap = await games.load(gid);
    if (snap) this.announceSpectators(snap, count);
  }

  private announceSpectators(snap: GameSnapshot, count: number): void {
    const msg = JSON.stringify({ type: "spectators", gameId: snap.id, count });
    for (const ch of [CH.user(snap.white.id), CH.user(snap.black.id), CH.watch(snap.id)]) bus.publish(ch, msg);
  }

  private async rematch(game: Game, userId: string): Promise<void> {
    const color = game.colorOf(userId)!;
    if (game.status !== "finished") return;
    const opponentId = color === "white" ? game.blackId : game.whiteId;
    if ((await games.activeOf(userId)) || (await games.activeOf(opponentId))) {
      return this.toUser(userId, { type: "error", message: "Rematch unavailable — a player is already in another game." });
    }
    if (game.rematchFrom && game.rematchFrom !== color) {
      game.rematchFrom = null;
      await this.startGame(game.blackId, game.whiteId, game.tcId); // colours swap
      return;
    }
    if (!(await presence.isOnline(opponentId))) return this.toUser(userId, { type: "error", message: "Your opponent has left." });
    game.rematchFrom = color;
    this.deliver(game, { type: "rematch", gameId: game.id, from: color });
  }

  private declineRematch(game: Game, userId: string): void {
    const color = game.colorOf(userId)!;
    if (!game.rematchFrom || game.rematchFrom === color) return;
    game.rematchFrom = null;
    this.deliver(game, { type: "rematch", gameId: game.id, from: null, declinedBy: color });
  }

  // ---------- public queries (HTTP) ----------

  async liveGames() {
    const snaps = (await games.loadMany(await games.liveIds())).filter((s) => s.status === "active");
    const counts = await Promise.all(snaps.map((s) => games.watcherCount(s.id)));
    return snaps.map((s, i) => {
      const v = viewOf(s, null, counts[i]!);
      return { id: s.id, tc: v.tc, white: v.white, black: v.black, ply: s.moves.length, fen: s.fen, spectators: v.spectators };
    });
  }

  async stats() {
    const [online, playing, waitingBy, instances] = await Promise.all([
      presence.onlineCount(),
      games.liveCount(),
      queue.waiting(TIME_CONTROLS),
      presence.aliveInstances(),
    ]);
    const waiting = Object.values(waitingBy).reduce((a, b) => a + b, 0);
    return { online, playing, waiting, waitingBy, instances: instances.length };
  }

  isOnline(userId: string): Promise<boolean> {
    return presence.isOnline(userId);
  }

  /** Hand games to the rest of the cluster and drop our sockets; clients reconnect elsewhere. */
  async shutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled(this.outbox.values());
    for (const [gid, game] of this.owned) {
      game.dispose();
      await games.release(gid);
    }
    this.owned.clear();
    await presence.leave();
    for (const set of this.sockets.values()) for (const ws of set) ws.close(1012, "Server restarting");
  }
}
