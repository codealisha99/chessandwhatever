import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { verifyToken } from "./auth.ts";
import { config } from "./config.ts";
import { repo } from "./db.ts";
import { GameManager } from "./GameManager.ts";
import { createHttpHandler } from "./http.ts";
import { log } from "./logger.ts";

const HEARTBEAT_MS = 25_000;

const manager = new GameManager();
const server = createServer(createHttpHandler(manager));
const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });

// Authenticate before accepting the upgrade so anonymous sockets never reach the game layer.
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const userId = url.pathname === "/ws" ? verifyToken(url.searchParams.get("token")) : null;
  if (!userId || !repo.findUserById(userId)) {
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
    manager.connect(ws, userId);
  });
});

server.on("error", (err: NodeJS.ErrnoException) => {
  log.error(err.code === "EADDRINUSE" ? `port ${config.port} is already in use` : "server error", err);
  process.exit(1);
});

server.listen(config.port, () => log.info(`chess server on http://localhost:${config.port}`));

function shutdown(signal: string): void {
  log.info(`${signal} received, shutting down`);
  manager.shutdown();
  wss.close();
  server.close(() => {
    repo.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
