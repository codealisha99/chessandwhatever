# Gambit: Complete System Architecture Audit

**Author:** Technical Auditor & Senior Backend/Security Architect  
**Date:** November 2026  
**Repository:** `chessandwhatever` (Gambit)  
**Commit:** `ee4d7b4` (`origin/main`)  

---

## 1. Executive Architecture Overview

**Gambit** is a distributed, real-time multiplayer chess platform featuring server-authoritative clock timing, competitive rating updates, spectator broadcasting, and client-side chess engine integration (Stockfish 19 Lite WASM).

The system is architected as an event-driven cluster:
- **Frontend:** A React 19 Single Page Application (SPA) built with Vite and Tailwind CSS v4, deployed as a static bundle on Vercel.
- **Backend:** A Node.js 23.6+ HTTP and WebSocket server running native TypeScript (Node's built-in type-stripping runtime), deployed on Railway.
- **Coordination & In-Memory State:** Redis 7 (hosted on Railway's private network) serves as the cluster backplane for matchmaking queues, live game snapshots, ownership leases, presence tracking, and cross-instance pub/sub messaging.
- **Persistent Storage:** Serverless PostgreSQL (Neon) stores persistent user accounts, rating histories, and finished game records.
- **Client-Side Engine:** Stockfish 19 compiled to WebAssembly (WASM) executed inside a browser Web Worker for unrated bot play and offline post-game analysis without backend compute load.

```
+-----------------------------------------------------------------------------------------+
|                                    CLIENT BROWSER                                       |
|  +--------------------+   +---------------------+   +--------------------------------+  |
|  | React 19 UI / DOM  |---| Web Worker Engine   |---| Local Storage (Token/Settings) |  |
|  | (Tailwind v4)      |   | (Stockfish 19 WASM) |   +--------------------------------+  |
|  +--------------------+   +---------------------+                                       |
+-----------------------------------------------------------------------------------------+
            | HTTP / HTTPS                          ^ WSS (WebSocket)
            | (REST API Calls)                      | (Bidirectional Realtime Stream)
            v                                       v
+-----------------------------------------------------------------------------------------+
|                             RAILWAY / LOAD BALANCER (EDGE)                              |
+-----------------------------------------------------------------------------------------+
                                    |
          +-------------------------+-------------------------+
          |                                                   |
          v                                                   v
+-----------------------------------+   +-----------------------------------+
|  BACKEND NODE INSTANCE A          |   |  BACKEND NODE INSTANCE B          |
|  - HTTP Router (`http.ts`)        |   |  - HTTP Router (`http.ts`)        |
|  - WSS Manager (`GameManager.ts`) |   |  - WSS Manager (`GameManager.ts`) |
|  - Owned Game Objects (`Game.ts`) |   |  - Owned Game Objects (`Game.ts`) |
|  - Engine Rules (`chess.js`)      |   |  - Engine Rules (`chess.js`)      |
|  - Instance ID: `host-pid-rand`   |   |  - Instance ID: `host-pid-rand`   |
+-----------------------------------+   +-----------------------------------+
          |                                                   |
          +-------------------------+-------------------------+
                                    |
            +-----------------------+-----------------------+
            |                                               |
            v                                               v
+---------------------------------------+   +---------------------------------------+
|             REDIS CLUSTER             |   |            NEON POSTGRES              |
|  - Matchmaking FIFO (`queue:{tc}`)    |   |  - `users` Table                      |
|  - Game Snapshots (`game:{gid}`)      |   |    (ID, Username, Hash, Rating, Stats)|
|  - Game Leases (`game:{gid}:owner`)   |   |  - `games` Table                      |
|  - Pub/Sub Channels (`ch:user:{uid}`) |   |    (ID, Players, PGN, Moves, Results) |
|  - Watcher Sets (`game:{gid}:watchers`|   |  - Advisory Lock Migrations           |
|  - Rate Limits (`rl:auth:{ip}`)       |   |  - Atomic Rating Transactions         |
+---------------------------------------+   +---------------------------------------+
```

---

## 2. Technology Stack & Dependencies

### 2.1 Backend (`backend1/`)
- **Runtime:** Node.js `>=23.6` (executes `.ts` files directly via native TypeScript support `--watch src/index.ts`).
- **Dependencies (`backend1/package.json`):**
  - `chess.js` (`^1.4.0`): Authoritative chess rule engine, move generation, FEN/PGN parser, validation of check, checkmate, stalemate, draw rules.
  - `ioredis` (`^6.0.0`): Redis client with custom Lua commands (`matchPop`, `renewIfEquals`, `delIfEquals`, `swapIfEquals`), Pub/Sub multiplexing.
  - `pg` (`^8.23.1`): PostgreSQL connection pool for Neon Postgres.
  - `ws` (`^8.21.0`): Low-level, high-performance WebSocket server.
- **Dev Dependencies:**
  - `typescript` (`^7.0.2`), `@types/node`, `@types/pg`, `@types/ws`.
- **Testing:** Native Node.js test runner (`node --test`).

### 2.2 Frontend (`frontend/`)
- **Framework:** React 19 (`^19.2.8`), React DOM 19 (`^19.2.8`).
- **Build Tool:** Vite (`^8.3.0`), `@vitejs/plugin-react` (`^6.1.1`).
- **Styling:** Tailwind CSS v4 (`^4.3.3`) via `@tailwindcss/vite`.
- **Routing:** React Router DOM v7 (`^7.18.4`).
- **Chess Client:** `chess.js` (`^1.4.0`) for client-side optimistic legal move calculation and PGN replay.
- **Icons:** `lucide-react` (`^1.71.0`).
- **Audio:** Synthesized sound effects via Web Audio API (`frontend/src/lib/sound.ts`).
- **Offline Engine:** Stockfish 19 Lite Single Thread WASM (`frontend/public/engine/stockfish-19-lite-single.wasm` + `.js`).

### 2.3 Hosting & Deployment Configuration
- **Frontend Deployment:** Vercel (`frontend/vercel.json`). Serves static SPA bundle with immutable asset caching and client-side URL rewrites to `/index.html`.
- **Backend Deployment:** Railway (`backend1/railway.json`, `backend1/Dockerfile`). Containerized Node runtime with `/api/health` health checks.
- **Local Multi-Instance Simulation:** Docker Compose (`docker-compose.yml`) running Postgres 17, Redis 7, two backend app replicas, and a Caddy reverse proxy (`Caddyfile`) with round-robin load balancing and WebSocket proxying.

---

## 3. Detailed Request and Information Flow

### 3.1 HTTP Request Lifecycle
1. **Origin Verification & CORS (`backend1/src/http.ts:142-155`):**
   - The browser sends an HTTP request with an `Origin` header.
   - If the origin matches `config.corsOrigins` (e.g. `https://gambit-mocha.vercel.app`), the server returns `Access-Control-Allow-Origin: <origin>` and `Vary: Origin`. Preflight `OPTIONS` requests return status `204`.
2. **Client IP Identification (`backend1/src/http.ts:27-32`):**
   - `clientIp()` checks `x-forwarded-for` if `config.trustProxy` is active (`NODE_ENV === "production"`). The first IP in the list is extracted.
3. **Route Dispatching:**
   - Routes are mapped via regex matching in `backend1/src/http.ts:93-136`.
   - Body parsing enforce a 4KB payload limit (`MAX_BODY = 4096`).
   - Authentication-sensitive routes (`/api/auth/*`) execute Redis-backed sliding window rate limiting (maximum 20 attempts per minute per IP).

### 3.2 WebSocket Handshake and Connection Lifecycle
1. **HTTP Upgrade Interception (`backend1/src/index.ts:18-38`):**
   - The client opens `wss://.../ws?token=<token>`.
   - The Node HTTP server intercepts the `upgrade` event before standard routing.
   - `verifyToken(token)` verifies the HMAC-SHA256 signature against `config.authSecret`.
   - The database is queried (`repo.findUserById(userId)`) to verify that the user exists. If invalid, the connection is closed with `401 Unauthorized` before the socket upgrades.
2. **Heartbeat & Liveness Monitoring:**
   - The server maintains a 25-second ping/pong heartbeat interval (`HEARTBEAT_MS = 25_000`). If a client misses a pong, the socket is terminated.
   - The client also transmits application-level `{ type: "ping", t: Date.now() }` every 15 seconds (`PING_MS = 15_000`), expecting `{ type: "pong", t }`.
3. **Cluster Presence Registration:**
   - Sockets are attached in `GameManager.attach()` (`GameManager.ts:89-112`).
   - The instance registers user presence in Redis via `presence.add(userId)` which adds `userId` to the set `gambit:online:{instanceId}`.
   - The instance subscribes to the Redis Pub/Sub channel `gambit:ch:user:{userId}`. All messages targeted to this user across the entire cluster are forwarded to their local WebSockets.

### 3.3 Matchmaking and Room Flow
1. **Matchmaking Queue:**
   - Client sends `{ type: "queue", tc: "3+2" }`.
   - `GameManager.enqueue()` executes the Redis Lua script `matchPop`:
     ```lua
     redis.call('LREM', KEYS[1], 0, ARGV[1])
     local opp = redis.call('LPOP', KEYS[1])
     if opp then return opp end
     redis.call('RPUSH', KEYS[1], ARGV[1])
     return false
     ```
   - If an opponent is waiting in the FIFO list, they are popped atomically. If no opponent is waiting, the current player is appended to the queue.
   - If matched, `GameManager.startGame()` randomly assigns white/black and creates an active `Game` object.
2. **Private Invite Rooms:**
   - Host sends `{ type: "create_room", tc: "5+3", color: "random" }`.
   - A 6-character alphanumeric code is generated from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` and saved to Redis `gambit:room:{code}` with a 1-hour TTL.
   - A second player navigates to `/join/:code` and sends `{ type: "join_room", code }`.
   - Redis `GETDEL` ensures exactly one challenger claims the room atomically (`rooms.take(code)`).

### 3.4 Move Validation and Clock Deductions
1. **Move Transmission:**
   - Player sends `{ type: "move", gameId, move: { from: "e2", to: "e4" } }`.
   - Message is forwarded to the game's owning instance over Redis channel `gambit:ch:instance:{ownerId}`.
2. **Authoritative Execution (`backend1/src/Game.ts:241-289`):**
   - The owner instance checks:
     - Is the game active?
     - Is the sender a participant in the game?
     - Is it the sender's turn?
     - Has the player run out of time (`remaining(color) <= 0`)?
   - If the clock was ticking (both sides have made move 1), the exact elapsed time since `turnStartedAt` is deducted from `clocks[color]`, and the time control increment is added.
   - `chess.js` executes `this.chess.move(input)`. If illegal, the move is rejected and the client receives `{ type: "move_rejected", gameId, reason: "Illegal move" }`.
3. **Atomic Commit & Event Fanout (`backend1/src/redis.ts:281-296`):**
   - After a valid move, the snapshot is committed to Redis key `gambit:game:{gid}`.
   - Concurrently within the **same Redis MULTI transaction**, the move event is published to `gambit:ch:user:{whiteId}`, `gambit:ch:user:{blackId}`, and `gambit:ch:watch:{gid}`.
   - Any instance receiving the published event is guaranteed to read the identical, updated snapshot from Redis.

---

## 4. Module Responsibilities & Dependencies

| Module | File Location | Responsibilities | Upstream Dependencies | Downstream Consumers |
|---|---|---|---|---|
| **Server Entry** | `backend1/src/index.ts` | Process bootstrap, HTTP/WebSocket server creation, upgrade auth verification, graceful shutdown coordination. | `http.ts`, `GameManager.ts`, `redis.ts`, `db.ts`, `auth.ts` | Node runtime / Docker |
| **HTTP Router** | `backend1/src/http.ts` | REST API routes, JSON parsing, CORS headers, IP-based rate limiting, static SPA file serving. | `auth.ts`, `db.ts`, `redis.ts`, `config.ts`, `logger.ts` | `index.ts` |
| **Authentication** | `backend1/src/auth.ts` | Password hashing (scrypt + 16B salt), password verification, compact HMAC-SHA256 signed token issuance and validation. | Node `crypto`, `config.ts` | `http.ts`, `index.ts` |
| **Database Repository** | `backend1/src/db.ts` | Neon Postgres pool, advisory lock migrations, user lookups/creations, finished game persistence, atomic rating updates. | `pg`, `config.ts`, `logger.ts`, `retry.ts` | `http.ts`, `GameManager.ts`, `index.ts` |
| **Redis Coordination** | `backend1/src/redis.ts` | Redis connections (cmd + sub), Lua matchmaking script, cluster pub/sub bus, presence tracking, game snapshot caching, ownership leases. | `ioredis`, `config.ts`, `logger.ts` | `GameManager.ts`, `http.ts`, `index.ts` |
| **Game Manager** | `backend1/src/GameManager.ts` | WebSocket connection lifecycle, message routing, cluster game ownership, heartbeat tick, failover takeover, matchmaking orchestration. | `Game.ts`, `protocol.ts`, `redis.ts`, `db.ts`, `config.ts` | `index.ts`, `http.ts` |
| **Game Engine** | `backend1/src/Game.ts` | Authoritative game state machine, move execution, clock calculations, flag detection timers, abandonment timers, draw/rematch logic, PGN formatting. | `chess.js`, `elo.ts`, `config.ts`, `protocol.ts` | `GameManager.ts` |
| **Protocol** | `backend1/src/protocol.ts` | Wire message definitions, payload validation regexes, time control parser. | None | `GameManager.ts`, `Game.ts` |
| **Elo Calculation** | `backend1/src/elo.ts` | Pure Elo rating calculation with dynamic K-factors (K=40 for <20 games, K=24 standard, K=16 for 2400+). | None | `Game.ts` |
| **Configuration** | `backend1/src/config.ts` | Environment variable parsing, default port, token TTL, lease durations, secret generation fallback. | Node `crypto`, `os`, `fs`, `path` | All backend modules |
| **Retry Helper** | `backend1/src/retry.ts` | Exponential backoff retry utility for resilient database operations. | `logger.ts` | `db.ts`, `GameManager.ts` |

---

## 5. Architectural Strengths & Key Highlights

1. **Strict Server Authority:**
   Moves, clocks, flagging, abandonment, and ratings are computed exclusively on the server. Clients cannot manipulate move legality or alter timers.
2. **Decoupled Compute via Client-Side WASM:**
   Stockfish 19 runs directly inside the client's browser using a WebAssembly Web Worker. This eliminates expensive server-side CPU utilization for bot games and game evaluations.
3. **Stateless Node Replicas with Redis Backplane:**
   No game state is trapped in memory without a Redis snapshot. Sockets connected to Instance A can interact with a game owned by Instance B seamlessly through Redis pub/sub.
4. **Idempotent Database Transactions:**
   `repo.saveFinishedGame` uses Postgres `ON CONFLICT (id) DO NOTHING` combined with rating updates in a single `BEGIN ... COMMIT` block. Retrying failed saves or dual-instance saves during failover will never apply rating adjustments twice.
