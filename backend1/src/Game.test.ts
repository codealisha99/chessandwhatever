import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, mock, test } from "node:test";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "chess-test-"));
const { Game } = await import("./Game.ts");
const { repo } = await import("./db.ts");
const { parseTimeControl, parseClientMessage } = await import("./protocol.ts");
const { eloDelta } = await import("./elo.ts");

mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
after(() => mock.timers.reset());

let n = 0;
function setup(tc = "3+2") {
  n++;
  const w = repo.createUser(`w${n}`, `white_${n}`, "x")!;
  const b = repo.createUser(`b${n}`, `black_${n}`, "x")!;
  const sent: { type: string; [k: string]: unknown }[] = [];
  const finished: unknown[] = [];
  const info = (u: typeof w) => ({ id: u.id, username: u.username, rating: u.rating, games: u.games });
  const game = new Game(info(w), info(b), parseTimeControl(tc)!, (m) => sent.push(m as never), (g) => finished.push(g));
  game.start();
  const last = (type: string) => [...sent].reverse().find((m) => m.type === type);
  return { game, w: w.id, b: b.id, sent, finished, last };
}

let ctx: ReturnType<typeof setup>;
beforeEach(() => {
  ctx = setup();
});

test("rejects moves out of turn and illegal moves without touching the clock", () => {
  const { game, w, b } = ctx;
  assert.equal(game.move(b, { from: "e7", to: "e5" }), "Not your turn");
  assert.equal(game.move(w, { from: "e2", to: "e5" }), "Illegal move");
  assert.equal(game.move("stranger", { from: "e2", to: "e4" }), "You are not playing in this game");
  assert.equal(game.move(w, { from: "e2", to: "e4" }), null);
  assert.equal(game.remaining("white"), 180_000);
});

test("clock starts after both first moves, deducts think time and adds increment", () => {
  const { game, w, b } = ctx;
  mock.timers.tick(5_000);
  game.move(w, { from: "e2", to: "e4" });
  mock.timers.tick(5_000);
  game.move(b, { from: "e7", to: "e5" });
  assert.equal(game.remaining("white"), 180_000);
  assert.equal(game.remaining("black"), 180_000);
  mock.timers.tick(10_000);
  assert.equal(game.remaining("white"), 170_000);
  game.move(w, { from: "g1", to: "f3" });
  assert.equal(game.remaining("white"), 172_000); // 170s + 2s increment
  mock.timers.tick(1_000);
  assert.equal(game.remaining("black"), 179_000);
});

test("flagging loses on time", () => {
  const { game, w, b, finished } = ctx;
  game.move(w, { from: "e2", to: "e4" });
  game.move(b, { from: "e7", to: "e5" });
  mock.timers.tick(180_010);
  assert.equal(game.status, "finished");
  assert.deepEqual([game.result?.winner, game.result?.reason], ["black", "timeout"]);
  assert.equal(finished.length, 1);
  assert.ok(repo.findGame(game.id), "rated game is persisted");
});

test("flagging against a lone king is a draw", () => {
  const { game, w, b } = ctx;
  // strip black down to a bare king
  game.chess.load("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1");
  game.move(w, { from: "e1", to: "d1" });
  game.move(b, { from: "e8", to: "d8" });
  mock.timers.tick(180_010);
  assert.equal(game.result?.reason, "timeout vs insufficient material");
  assert.equal(game.result?.winner, null);
});

test("no first move within the limit aborts without rating changes", () => {
  const { game } = ctx;
  mock.timers.tick(30_001);
  assert.equal(game.result?.reason, "aborted");
  assert.equal(game.result?.whiteDelta, 0);
  assert.equal(repo.findGame(game.id), null, "aborted games are not stored");
});

test("fool's mate ends in checkmate and updates ratings", () => {
  const { game, w, b, last } = ctx;
  game.move(w, { from: "f2", to: "f3" });
  game.move(b, { from: "e7", to: "e5" });
  game.move(w, { from: "g2", to: "g4" });
  game.move(b, { from: "d8", to: "h4" });
  assert.deepEqual([game.result?.winner, game.result?.reason], ["black", "checkmate"]);
  assert.ok((game.result?.blackDelta ?? 0) > 0);
  assert.equal(last("game_over")?.gameId, game.id);
  const black = repo.findUserById(b)!;
  assert.equal(black.wins, 1);
  assert.equal(black.rating, 1200 + game.result!.blackDelta);
});

test("draw offer, decline, re-offer and accept", () => {
  const { game, w, b } = ctx;
  game.move(w, { from: "e2", to: "e4" });
  game.move(b, { from: "e7", to: "e5" });
  game.offerDraw(w);
  assert.equal(game.drawOfferFrom, "white");
  game.respondDraw(b, false);
  assert.equal(game.drawOfferFrom, null);
  game.offerDraw(w);
  game.respondDraw(w, true); // offerer cannot accept own offer
  assert.equal(game.status, "active");
  game.respondDraw(b, true);
  assert.equal(game.result?.reason, "agreement");
});

test("resigning before both sides moved aborts; after, it loses", () => {
  ctx.game.resign(ctx.w);
  assert.equal(ctx.game.result?.reason, "aborted");
  const g2 = setup();
  g2.game.move(g2.w, { from: "e2", to: "e4" });
  g2.game.move(g2.b, { from: "e7", to: "e5" });
  g2.game.resign(g2.w);
  assert.deepEqual([g2.game.result?.winner, g2.game.result?.reason], ["black", "resignation"]);
});

test("a disconnected player forfeits after the grace period", () => {
  const { game, w, b } = ctx;
  game.move(w, { from: "e2", to: "e4" });
  game.move(b, { from: "e7", to: "e5" });
  game.setConnected(b, false);
  mock.timers.tick(30_000);
  game.setConnected(b, true); // came back in time
  mock.timers.tick(40_000);
  assert.notEqual(game.result?.reason, "abandonment");
  const g2 = setup("30+0");
  g2.game.move(g2.w, { from: "e2", to: "e4" });
  g2.game.move(g2.b, { from: "e7", to: "e5" });
  g2.game.setConnected(g2.w, false);
  mock.timers.tick(60_001);
  assert.deepEqual([g2.game.result?.winner, g2.game.result?.reason], ["black", "abandonment"]);
});

test("protocol validation rejects junk", () => {
  assert.equal(parseClientMessage("not json"), null);
  assert.equal(parseClientMessage(JSON.stringify({ type: "queue", tc: "999+0" })), null);
  assert.equal(parseClientMessage(JSON.stringify({ type: "move", gameId: "x", move: { from: "z9", to: "e4" } })), null);
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: "join_room", code: "abc234" })), { type: "join_room", code: "ABC234" });
});

test("elo is symmetric for equal ratings and favours upsets", () => {
  assert.equal(eloDelta(1500, 1500, 1, 50), 12);
  assert.equal(eloDelta(1500, 1500, 0, 50), -12);
  assert.ok(eloDelta(1200, 1800, 1, 50) > eloDelta(1800, 1200, 1, 50));
});
