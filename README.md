# Gambit — real-time chess

Multiplayer chess in the browser: rated games with server-authoritative clocks, private invite links, live spectating, rematches and chat. It also has offline play against Stockfish 19 and an analysis board with a live eval bar.

```
backend1/   Node HTTP + WebSocket server (ws, chess.js, built-in node:sqlite)
frontend/   React 19 + Vite + Tailwind v4 SPA
```

No Postgres, Redis or Docker. The server stores everything in one SQLite file (`backend1/data/chess.db`).

## Run it

Requires **Node 23.6+**, since the server runs TypeScript directly and uses `node:sqlite`.

```bash
npm run setup     # install backend + frontend deps
npm run dev       # server on :8080, Vite on :5173 (proxies /api and /ws)
```

Open http://localhost:5173. To play yourself, open a second **incognito/other browser** window (each window needs its own account) and click the same time control in both.

Production (single process, serves the built SPA):

```bash
npm run build
AUTH_SECRET=$(openssl rand -hex 32) npm start   # http://localhost:8080
```

| Env var | Default | Notes |
|---|---|---|
| `PORT` | `8080` | HTTP + WebSocket |
| `AUTH_SECRET` | dev: auto-generated in `data/` | **required** when `NODE_ENV=production` |
| `DATA_DIR` | `backend1/data` | SQLite database location |
| `STATIC_DIR` | `frontend/dist` | built SPA to serve |
| `BACKEND_URL` | `http://localhost:8080` | (frontend dev) proxy target |

```bash
npm test          # backend rules/clock/elo tests (node:test, mocked time)
npm run typecheck
```

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

- Single server process. In-progress games live in memory, so restarting the server ends them; finished games are persisted. Scaling out would need shared state (e.g. Redis pub/sub).
- Matchmaking is FIFO per time control, not rating-windowed.
- No premoves.

## Credits

Stockfish (GPLv3), `frontend/public/engine/STOCKFISH-LICENSE.txt`. Piece set: "cburnett" by Colin M.L. Burnett, via lichess chessground.
