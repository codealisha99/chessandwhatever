# Gambit — real-time chess

Multiplayer chess in the browser: rated games with server-authoritative clocks, private invite links, live spectating, rematches and chat. It also has offline play against Stockfish 19 and an analysis board with a live eval bar. The server scales horizontally, with any number of instances sharing state through Redis.

```
backend1/   Node HTTP + WebSocket server (ws, chess.js, ioredis, pg)
frontend/   React 19 + Vite + Tailwind v4 SPA
```

## Live

| | |
|---|---|
| App (Vercel) | https://gambit-mocha.vercel.app |
| Game server (Railway) | https://gambit-server-production.up.railway.app/api/health |
| Database | Neon Postgres, project `gambit` (`main` = production, `dev` = local/tests) |
| Redis | Railway Redis, private network |

```
browser ── https ──▶ Vercel (static SPA only)
   ├────── https ──▶ Railway gambit-server /api ─┐
   └────── wss ────▶ Railway gambit-server /ws ──┴─▶ Railway Redis (pub/sub, queues, live games)
                                           └─▶ Neon Postgres (accounts, finished games)
```

The browser talks to Railway directly for both the API (`VITE_API_URL`) and the WebSocket (`VITE_WS_URL`). Going through a Vercel rewrite would hide the client IP behind Vercel's rotating egress addresses and defeat the per-IP auth rate limit, so the server allows the frontend's origin via `CORS_ORIGINS` instead.

### Redeploy

```bash
cd backend1 && railway up --service gambit-server     # server (Dockerfile + railway.json)
cd frontend && vercel deploy --prod                   # frontend (vercel.json)
```

Railway variables: `DATABASE_URL` (Neon `main`, pooled), `REDIS_URL=${{Redis.REDIS_URL}}`, `AUTH_SECRET`, `NODE_ENV=production`, `CORS_ORIGINS=https://gambit-mocha.vercel.app`.
Vercel variables: `VITE_API_URL=https://gambit-server-production.up.railway.app`, `VITE_WS_URL=wss://gambit-server-production.up.railway.app/ws`. Preview deployments use other origins, so their API calls are refused unless added to `CORS_ORIGINS`.
To scale the server, raise the replica count in Railway. Games are shared through Redis.

## Run it locally

Requires **Node 23.6+** (the server runs TypeScript directly), **Redis 6.2+** and a Postgres URL. A Neon branch works well.

```bash
redis-server &                          # or: docker run -d -p 6379:6379 redis:7-alpine
cp backend1/.env.example backend1/.env  # set DATABASE_URL (e.g. your Neon `dev` branch)
npm run setup                           # install backend + frontend deps
npm run dev                             # server on :8080, Vite on :5173 (proxies /api and /ws)
```

### Run the whole cluster in Docker

Redis, two app instances and a Caddy load balancer (round robin, WebSockets included):

```bash
AUTH_SECRET=$(openssl rand -hex 32) docker compose up --build
open http://localhost:8080          # /api/health shows which instance answered
```

Scale with `docker compose up --scale app=4`. Games keep running when instances are restarted or crash.

Open http://localhost:5173. To play yourself, open a second **incognito/other browser** window (each window needs its own account) and click the same time control in both.

Production (single process, serves the built SPA):

```bash
npm run build
AUTH_SECRET=$(openssl rand -hex 32) npm start   # http://localhost:8080
```

| Env var | Default | Notes |
|---|---|---|
| `PORT` | `8080` | HTTP + WebSocket |
| `REDIS_URL` | `redis://localhost:6379` | shared state, pub/sub, matchmaking |
| `REDIS_PREFIX` | `gambit:` | key/channel namespace (lets deployments or tests share a Redis) |
| `AUTH_SECRET` | dev: auto-generated in `data/` | **required** when `NODE_ENV=production` |
| `DATABASE_URL` | *(required)* | Postgres / Neon connection string |
| `CORS_ORIGINS` | *(empty: same-origin only)* | comma-separated browser origins allowed to call the API |
| `TRUST_PROXY` | on in production | take the client IP from `X-Forwarded-For` (Vercel/Railway) |
| `STATIC_DIR` | `frontend/dist` | built SPA to serve |
| `BACKEND_URL` | `http://localhost:8080` | (frontend dev) proxy target |

```bash
npm test          # rules/clock/elo unit tests + a two-instance cluster test (needs Redis + DATABASE_URL; skipped without them)
npm run typecheck
```

## How the cluster works

```
 browser ──ws──▶ instance A ─┐            ┌─ instance B ◀──ws── browser
                             ▼            ▼
                    ┌──────── Redis ────────┐
                    │ ch:user:{uid}         │  everything a user should see; each instance
                    │                       │  forwards it to its own sockets for that user
                    │ ch:watch:{gid}        │  spectator stream
                    │ ch:instance:{iid}     │  player actions routed to the game's owner
                    │ game:{gid}            │  snapshot after every change
                    │ game:{gid}:owner      │  15s lease: who runs this game's clock
                    │ queue:{tc}            │  matchmaking FIFO, paired by an atomic Lua script
                    │ room:{code}, live, …  │
                    └───────────────────────┘
```

- **One owner per game.** The instance that creates a game holds the `Game` object and its timers (flag, abandonment, first-move abort) and renews a Redis lease every 5s. Moves from players connected to other instances are forwarded to it over pub/sub.
- **Snapshot and event in one MULTI.** After each change, the owner writes the game snapshot and publishes the event atomically, so any instance that reads the snapshot sees the state that produced the event.
- **Failover.** If an owner crashes, a `PUBLISH` to it reaches zero subscribers, so the sender takes the game over on the spot (compare-and-swap on the lease). A sweeper also adopts any game whose lease expired. The new owner rebuilds the game from the snapshot. Clocks are stored as absolute timestamps, so they resume exactly.
- **Rolling restarts.** On SIGTERM an instance releases its games and closes sockets with code 1012. Another instance adopts the games within one heartbeat, and clients reconnect through the load balancer.
- **Presence** is a per-instance set plus an instance heartbeat key, so a crashed instance's users drop out automatically.
- Auth rate limits are cluster-wide (Redis). Socket message rate limits and slow-client protection are per connection.

## Features

**Play**
- Quick pairing in 11 time controls, from 1+0 bullet to 30+20 classical, with increment
- Private games via invite link or 6-character code, with your choice of color
- Guest accounts with one click, or a registered account with username and password (scrypt hashes, signed tokens)
- Rematch (colors swap), draw offers, resign, abort before the first moves, in-game chat

**Rules and timing, all enforced by the server**
- Every move is validated on the server with chess.js, including castling, en passant, promotion, checkmate, stalemate, insufficient material, threefold repetition and the 50-move rule
- Clocks start after both sides' first move. Think time is deducted on the server, then the increment is added
- Flagging is detected with a precise timer, not polling. Flagging against a lone king or a king with one minor piece is a draw
- The first move must be made within 30s, or the game is aborted and unrated
- Disconnecting starts a 60s grace period, after which the game is lost by abandonment. Reconnecting resumes the game exactly, including clocks
- Elo ratings: K=40 while provisional (fewer than 20 games), then K=24, and K=16 at 2400+

**Watch and review**
- A live games list with mini boards, and real-time spectating
- Archived games with clock times at every move, PGN download and autoplay
- Stockfish analysis with an eval bar, principal variation, best-move arrow, and free exploration of side lines
- Leaderboard, and player profiles with W/D/L stats, rating history and recent games

**Practice**
- Play Stockfish 19 (WASM, in a web worker) at 8 strength levels, with hints and takebacks
- Pass-and-play on one board. Offline games are saved automatically and can be sent to analysis

**UI**
- Drag-and-drop or click-to-move, with animated pieces, legal-move hints, check highlight and a promotion picker
- 6 board themes, synthesized sound effects, coordinates, auto-queen and resign confirmation
- Keyboard shortcuts: ← → to step through moves, Home/End, F to flip
- Responsive down to phones

## WebSocket protocol (`/ws?token=…`)

Client → server: `queue {tc}`, `cancel_queue`, `create_room {tc,color}`, `join_room {code}`, `cancel_room`, `move {gameId,move}`, `resign`, `abort`, `draw_offer`, `draw_respond {accept}`, `rematch_offer`, `rematch_decline`, `chat {text}`, `spectate`, `unspectate`, `ping`.

Server → client: `hello`, `lobby`, `game_state` (full snapshot), `move` (+clocks), `move_rejected` (+snapshot to resync), `game_over` (+rating deltas, PGN), `draw_offer`, `rematch`, `presence`, `chat`, `spectators`, `spectate_missing`, `error`, `pong`.

Every inbound message is validated (`backend1/src/protocol.ts`) and rate-limited per socket.

## REST

`POST /api/auth/{signup,login,guest}` · `GET /api/me` · `GET /api/stats` · `GET /api/leaderboard` · `GET /api/games/live` · `GET /api/games/:id` · `GET /api/users/:username`

## Known limits

- A finished game is saved with retries, but if the owning instance dies during those retries the record is lost.
- A command that reaches an owner in the instant before it crashes can be lost. The client notices the missing confirmation after 4s and resyncs the game.
- Matchmaking is FIFO per time control, not rating-windowed.
- No premoves.

## Credits

Stockfish (GPLv3), `frontend/public/engine/STOCKFISH-LICENSE.txt`. Piece set: "cburnett" by Colin M.L. Burnett, via lichess chessground.
