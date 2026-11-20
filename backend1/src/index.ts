import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { verifyToken } from "./auth.ts";
import { startGuestCleanupScheduler } from "./cleanup.ts";
import { config } from "./config.ts";
import { migrate, repo } from "./db.ts";
import { GameManager } from "./GameManager.ts";
import { createHttpHandler } from "./http.ts";
import { log } from "./logger.ts";
import { closeRedis, redis, K, waitForRedis } from "./redis.ts";

const HEARTBEAT_MS = 25_000;

const manager = new GameManager();
const server = createServer(createHttpHandler(manager));
const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });

// Authenticate before accepting the upgrade so anonymous sockets never reach the game layer.
server.on("upgrade", async (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/ws") {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  let authContext: { userId: string; sessionId?: string } | null = null;
  const ticket = url.searchParams.get("ticket");
  if (ticket) {
    const raw = await redis.getdel(K.ticket(ticket)).catch(() => null);
    if (raw) {
      try {
        authContext = JSON.parse(raw);
      } catch {
        authContext = null;
      }
    }
  } else {
    // Backward-compatibility token fallback
    const token = url.searchParams.get("token");
    if (token) {
      authContext = verifyToken(token);
    }
  }

  if (!authContext || !authContext.userId) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  if (authContext.sessionId) {
    const revoked = await redis.get(K.sessionRevoked(authContext.sessionId)).catch(() => null);
    if (revoked || !(await repo.isSessionActive(authContext.sessionId).catch(() => false))) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
  }

  const user = await repo.findUserById(authContext.userId).catch(() => null);
  if (!user) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    const alive = { value: true };
    ws.on("pong", () => (alive.value = true));
    const beat = setInterval(() => {
      if (!alive.value) return ws.terminate();
      alive.value = false;
      ws.ping();
    }, HEARTBEAT_MS);
    ws.on("close", () => clearInterval(beat));
    ws.on("error", (err) => log.warn("socket error", { message: err.message }));
    manager.connect(ws, authContext.userId, authContext.sessionId);
  });
});

server.on("error", (err: NodeJS.ErrnoException) => {
  log.error(err.code === "EADDRINUSE" ? `port ${config.port} is already in use` : "server error", err);
  process.exit(1);
});

try {
  await Promise.all([waitForRedis(), migrate()]);
  await manager.start();
  startGuestCleanupScheduler();
} catch (err) {
  log.error((err as Error).message);
  process.exit(1);
}
server.listen(config.port, () => log.info(`chess server on http://localhost:${config.port}`, { instance: config.instanceId }));

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info(`${signal} received, handing games to the cluster and shutting down`);
  setTimeout(() => process.exit(0), 5000).unref();
  server.close();
  await manager.shutdown().catch((err) => log.error("shutdown failed", err));
  wss.close();
  await closeRedis();
  await repo.close().catch(() => undefined);
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
