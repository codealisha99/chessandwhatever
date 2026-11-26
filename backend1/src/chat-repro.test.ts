import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { after, before, test } from "node:test";
import WebSocket from "ws";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const DATABASE_URL = process.env.DATABASE_URL;
const PORT = 18105;
const PREFIX = `gambit-chat-test-${process.pid}:`;

let proc: ChildProcess;

function startServer(): Promise<void> {
  proc = spawn(process.execPath, ["src/index.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL,
      REDIS_URL,
      REDIS_PREFIX: PREFIX,
      NODE_NO_WARNINGS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Server start timeout")), 15000);
    let out = "";
    proc.stdout!.on("data", (d: Buffer) => {
      out += d.toString();
      if (out.includes("chess server on")) {
        clearTimeout(t);
        resolve();
      }
    });
    proc.on("exit", (code) => {
      clearTimeout(t);
      reject(new Error(`Server exited: ${code}`));
    });
  });
}

const api = async (path: string, body?: object, method = "POST") => {
  const res = await fetch(`http://localhost:${PORT}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json() as { ok: boolean; data: any; error?: string };
  if (!json.ok) throw new Error(json.error ?? `API error ${res.status}`);
  return json.data;
};

interface Client {
  ws: WebSocket;
  inbox: any[];
  next: (type: string, pred?: (m: any) => boolean, ms?: number) => Promise<any>;
  send: (m: object) => void;
}

function connect(ticket: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws?ticket=${ticket}`);
    const inbox: any[] = [];
    const waiters: { type: string; pred: (m: any) => boolean; res: (m: any) => void }[] = [];
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString());
      inbox.push(m);
      for (const w of [...waiters]) {
        if (w.type === m.type && w.pred(m)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.res(m);
        }
      }
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
            const t = setTimeout(() => rej(new Error(`timeout waiting for ${type}; inbox: ${inbox.map((m) => m.type).join(",")}`)), ms);
            waiters.push({ type, pred, res: (m) => (clearTimeout(t), inbox.splice(inbox.indexOf(m), 1), res(m)) });
          });
        },
      }),
    );
  });
}

before(async () => {
  if (!DATABASE_URL) return;
  await startServer();
});

after(() => {
  proc?.kill("SIGKILL");
});

test("private invite room creation, joining, moves and chat", { skip: !DATABASE_URL && "DATABASE_URL not set" }, async () => {
  const g1 = await api("/auth/guest");
  const g2 = await api("/auth/guest");

  const t1 = (await (await fetch(`http://localhost:${PORT}/api/auth/ticket`, { method: "POST", headers: { Authorization: `Bearer ${g1.token}` } })).json()).data.ticket;
  const t2 = (await (await fetch(`http://localhost:${PORT}/api/auth/ticket`, { method: "POST", headers: { Authorization: `Bearer ${g2.token}` } })).json()).data.ticket;

  const c1 = await connect(t1);
  const c2 = await connect(t2);

  await c1.next("hello");
  await c2.next("hello");

  // Player 1 creates room
  c1.send({ type: "create_room", tc: "10+0", color: "white" });
  const lobby = await c1.next("lobby", (m) => !!m.room);
  const code = lobby.room.code;
  assert.ok(code, "Room code should exist");

  // Player 2 joins room
  c2.send({ type: "join_room", code });

  // Both should receive game_state
  const gs1 = await c1.next("game_state");
  const gs2 = await c2.next("game_state");

  assert.equal(gs1.game.id, gs2.game.id);
  assert.equal(gs1.game.white.id, g1.user.id);
  assert.equal(gs1.game.black.id, g2.user.id);
  assert.equal(gs1.game.status, "active");

  const gameId = gs1.game.id;

  // Make a move
  c1.send({ type: "move", gameId, move: { from: "e2", to: "e4" } });
  await c1.next("move");
  await c2.next("move");

  // Send chat from Player 2
  c2.send({ type: "chat", gameId, text: "Good luck!" });

  const chat1 = await c1.next("chat");
  const chat2 = await c2.next("chat");

  assert.equal(chat1.gameId, gameId);
  assert.equal(chat2.gameId, gameId);
  assert.equal(chat1.line.text, "Good luck!");
  assert.equal(chat2.line.text, "Good luck!");
  assert.equal(chat1.line.from, g2.user.username);

  // Send chat from Player 1
  c1.send({ type: "chat", gameId, text: "Have fun!" });

  const chat1b = await c1.next("chat");
  const chat2b = await c2.next("chat");
  assert.equal(chat1b.line.text, "Have fun!");
  assert.equal(chat2b.line.text, "Have fun!");

  // Verify sockets are still open
  assert.equal(c1.ws.readyState, WebSocket.OPEN);
  assert.equal(c2.ws.readyState, WebSocket.OPEN);

  c1.ws.close();
  c2.ws.close();
});
