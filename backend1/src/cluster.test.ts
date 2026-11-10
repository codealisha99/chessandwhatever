// Multi-instance integration test: two real server processes sharing one Redis.
// Skipped automatically when Redis isn't reachable.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { after, before, test } from "node:test";
import { Redis } from "ioredis";
import WebSocket from "ws";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const PREFIX = `gambit-test-${process.pid}:`;
const DATABASE_URL = process.env.DATABASE_URL;
const PORTS = [18101, 18102];
const LEASE_MS = 1500;
const STARTUP_MS = 60_000;
const ALLOWED_ORIGIN = "https://app.example";

let redisUp = false;
try {
  const r = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
  await r.connect();
  await r.ping();
  redisUp = true;
  await r.quit();
} catch {
  /* skip */
}

const procs = new Map<number, ChildProcess>();
function startServer(port: number): Promise<void> {
  const child = spawn(process.execPath, ["src/index.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, PORT: String(port), DATABASE_URL, REDIS_URL, REDIS_PREFIX: PREFIX, CORS_ORIGINS: ALLOWED_ORIGIN, LEASE_MS: String(LEASE_MS), HEARTBEAT_MS: "300", NODE_NO_WARNINGS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  procs.set(port, child);
  if (process.env.CLUSTER_LOG) {
    const out = createWriteStream(`${process.env.CLUSTER_LOG}-${port}.log`);
    child.stdout!.pipe(out);
    child.stderr!.pipe(out);
  }
  return new Promise((resolve, reject) => {
    // Neon can take several seconds to wake; fail loudly instead of hanging the run
    const t = setTimeout(() => reject(new Error(`server ${port} did not start within ${STARTUP_MS}ms`)), STARTUP_MS);
    let out = "";
    child.stdout!.on("data", (d: Buffer) => {
      out += d.toString();
      if (out.includes("chess server on")) (clearTimeout(t), resolve());
    });
    child.on("exit", (code) => (clearTimeout(t), reject(new Error(`server ${port} exited ${code}`))));
  });
}

const api = async (port: number, path: string, body?: object) => {
  const res = await fetch(`http://localhost:${port}/api${path}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  return ((await res.json()) as { data: any }).data;
};

interface Client {
  ws: WebSocket;
  inbox: any[];
  next: (type: string, pred?: (m: any) => boolean, ms?: number) => Promise<any>;
  send: (m: object) => void;
}
function connect(port: number, token: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws?token=${token}`);
    const inbox: any[] = [];
    const waiters: { type: string; pred: (m: any) => boolean; res: (m: any) => void }[] = [];
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString());
      inbox.push(m);
      for (const w of [...waiters]) if (w.type === m.type && w.pred(m)) (waiters.splice(waiters.indexOf(w), 1), w.res(m));
    });
    ws.on("error", reject);
    ws.on("open", () =>
      resolve({
        ws,
        inbox,
        send: (m) => ws.send(JSON.stringify(m)),
        next: (type, pred = () => true, ms = 8000) => {
          const seen = inbox.find((m) => m.type === type && pred(m));
          if (seen) return (inbox.splice(inbox.indexOf(seen), 1), Promise.resolve(seen));
          return new Promise((res, rej) => {
            const t = setTimeout(() => rej(new Error(`timeout waiting for ${type} on :${port}; inbox: ${inbox.map((m) => m.type).join(",")}`)), ms);
            waiters.push({ type, pred, res: (m) => (clearTimeout(t), inbox.splice(inbox.indexOf(m), 1), res(m)) });
          });
        },
      }),
    );
  });
}

before(async () => {
  if (!redisUp || !DATABASE_URL) return;
  await Promise.all(PORTS.map(startServer));
}, { timeout: STARTUP_MS + 5_000 });

after(async () => {
  for (const p of procs.values()) p.kill("SIGKILL");
  if (!redisUp) return;
  const r = new Redis(REDIS_URL);
  const keys = await r.keys(`${PREFIX}*`);
  if (keys.length) await r.del(...keys);
  await r.quit();
});

test("CORS: only the configured frontend origin may call the API cross-origin", { skip: (!redisUp && "Redis not reachable") || (!DATABASE_URL && "DATABASE_URL not set") }, async () => {
  const preflight = (origin: string) =>
    fetch(`http://localhost:${PORTS[0]}/api/auth/guest`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST" } });
  const ok = await preflight(ALLOWED_ORIGIN);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
  assert.match(ok.headers.get("access-control-allow-headers") ?? "", /Authorization/);
  const evil = await preflight("https://evil.example");
  assert.equal(evil.headers.get("access-control-allow-origin"), null, "unlisted origins get no CORS grant");
  const get = await fetch(`http://localhost:${PORTS[0]}/api/health`, { headers: { Origin: ALLOWED_ORIGIN } });
  assert.equal(get.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
});

test("players on different instances play, spectate, and survive the owner crashing", { timeout: 60_000, skip: (!redisUp && "Redis not reachable") || (!DATABASE_URL && "DATABASE_URL not set") }, async () => {
  const [A, B] = PORTS as [number, number];
  const alice = await api(A, "/auth/guest", {});
  const bob = await api(B, "/auth/guest", {});
  const carol = await api(B, "/auth/guest", {});

  const ca = await connect(A, alice.token);
  const cb = await connect(B, bob.token);
  await ca.next("hello");
  await cb.next("hello");

  // matchmaking across instances
  ca.send({ type: "queue", tc: "3+2" });
  await ca.next("lobby", (m) => m.queuedFor === "3+2");
  cb.send({ type: "queue", tc: "3+2" });
  const ga = (await ca.next("game_state")).game;
  const gb = (await cb.next("game_state")).game;
  assert.equal(ga.id, gb.id);
  assert.notEqual(ga.you, gb.you);
  const gid = ga.id;
  const [white, black, whitePort, blackPort, whiteTok, blackTok] =
    ga.you === "white" ? [ca, cb, A, B, alice.token, bob.token] : [cb, ca, B, A, bob.token, alice.token];

  // spectator on instance B
  const cc = await connect(B, carol.token);
  await cc.next("hello");
  cc.send({ type: "spectate", gameId: gid });
  const spect = await cc.next("game_state");
  assert.equal(spect.game.you, null);

  white.send({ type: "move", gameId: gid, move: { from: "f2", to: "f3" } });
  await black.next("move", (m) => m.ply === 1);
  await cc.next("move", (m) => m.ply === 1);
  black.send({ type: "move", gameId: gid, move: { from: "e7", to: "e5" } });
  await white.next("move", (m) => m.ply === 2);

  const live = await api(A, "/games/live");
  assert.equal(live.length, 1);
  assert.equal(live[0].spectators, 1);

  // crash the instance that owns the game (hard kill: no graceful hand-off)
  const r = new Redis(REDIS_URL);
  const owner = await r.get(`${PREFIX}game:${gid}:owner`);
  await r.quit();
  const ownerPort = (await api(A, "/health")).instance === owner ? A : B;
  const survivor = ownerPort === A ? B : A;
  const dead = procs.get(ownerPort)!;
  const exited = new Promise((r) => dead.once("exit", r));
  dead.kill("SIGKILL");
  await exited;

  // players whose socket died reconnect to the survivor (a load balancer would do this)
  const w2 = whitePort === ownerPort ? await connect(survivor, whiteTok) : white;
  const b2 = blackPort === ownerPort ? await connect(survivor, blackTok) : black;
  const resumed = (await (whitePort === ownerPort ? w2 : b2).next("game_state", (m) => m.game.id === gid, LEASE_MS * 6)).game;
  assert.equal(resumed.moves.length, 2, "game state survived the crash");

  w2.send({ type: "move", gameId: gid, move: { from: "g2", to: "g4" } });
  await b2.next("move", (m) => m.ply === 3, LEASE_MS * 6);
  b2.send({ type: "move", gameId: gid, move: { from: "d8", to: "h4" } });
  const over = await w2.next("game_over", () => true, 5000);
  assert.deepEqual([over.result.winner, over.result.reason], ["black", "checkmate"]);

  const archived = await api(survivor, `/games/${gid}`);
  assert.equal(archived.result, "0-1");
  assert.equal((await api(survivor, "/stats")).playing, 0);

  for (const c of [ca, cb, cc, w2, b2]) c.ws.close();
});
