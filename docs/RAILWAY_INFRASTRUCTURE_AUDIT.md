# Railway Infrastructure Audit: Gambit Chess Backend

**Audit Date:** 2026-11-21  
**Project:** Gambit (`chessandwhatever`)  
**Current Backend Hosting:** Railway  
**Target Infrastructure:** Cloudflare  

---

## 1. Executive Summary

This audit assesses the current Railway deployment architecture for Gambit's backend (`backend1`), cataloging its runtime profile, container configuration, network routing, environment variables, stateful dependencies, and operational lifecycle.

The application is a stateful real-time multiplayer chess platform combining:
- Node.js 24 + TypeScript HTTP API and WebSocket engine.
- Redis 7 for distributed locks, lease renewals, pub/sub game routing, and live game index.
- Neon Serverless PostgreSQL for persistent identity, session lifecycle, game history (with JSONB move notations), and Elo ratings.

---

## 2. Railway Runtime & Container Specification

### 2.1 Container Build Configuration
- **Configuration File:** `backend1/railway.json`
- **Builder:** `DOCKERFILE` pointing to `backend1/Dockerfile`
- **Base Image:** `node:24-alpine`
- **Build Step:** `RUN npm ci --omit=dev`
- **Execution Command:** `CMD ["node", "src/index.ts"]`
- **Security User:** Non-root `USER node`
- **Exposed Port:** `8080` (mapped via Railway's dynamic `$PORT`)

### 2.2 Health Check & Process Lifecycle
- **Healthcheck Path:** `/api/health`
- **Healthcheck Timeout:** 120 seconds
- **Restart Policy:** `ON_FAILURE` (Max retries: 5)
- **Graceful Shutdown:** The process listens to `SIGINT` and `SIGTERM` in `backend1/src/index.ts`, closing active WebSockets with code `1001` ("Going Away"), releasing game leases in Redis, terminating the guest cleanup timer, and closing the database pool.

---

## 3. Network Architecture & Traffic Flow on Railway

```mermaid
flowchart LR
    Client["Browser Client / Vercel SPA"] -->|"HTTPS / WSS"| Edge["Railway Edge Proxy (Caddy/Envoy)"]
    Edge -->|"HTTP / WS Proxy"| Container["backend1 Node 24 Container (:8080)"]
    Container -->|"TLS tcp:6379"| Redis["Managed Redis 7"]
    Container -->|"TLS tcp:5432"| DB["Neon PostgreSQL"]
```

### 3.1 Inbound Routing
1. **Public Domain:** Assigned by Railway (`*.up.railway.app` or custom CNAME `api.domain.com`).
2. **Reverse Proxy:** Railway terminates TLS at the edge and proxies requests over an internal bridge network to port `$PORT` (`8080`).
3. **WebSocket Upgrades:** Handled by `node:http` server in `backend1/src/index.ts` intercepting the `upgrade` event:
   ```ts
   server.on("upgrade", (req, socket, head) => {
     if (new URL(req.url, "http://x").pathname === "/ws") {
       wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
     } else {
       socket.destroy();
     }
   });
   ```
4. **Proxy Headers:** Railway provides `x-forwarded-for` and `x-forwarded-proto`. The server checks `config.trustProxy` (`TRUST_PROXY === "1" || isProd`) to extract genuine client IPs for rate-limiting.

---

## 4. Environment Variables on Railway

| Variable | Description | Sensitivity | Current Default / Example |
| :--- | :--- | :--- | :--- |
| `PORT` | Listening port assigned dynamically by Railway | Low | `8080` |
| `NODE_ENV` | Node environment flag | Low | `production` |
| `DATABASE_URL` | Neon PostgreSQL pooled/direct connection string | High | `postgres://user:pass@ep-xyz.us-east-2.aws.neon.tech/neondb?sslmode=require` |
| `REDIS_URL` | Redis 7 connection string | High | `redis://default:pass@redis.railway.internal:6379` |
| `REDIS_PREFIX` | Key prefix namespace | Low | `gambit:` |
| `AUTH_SECRET` | HMAC SHA-256 signing secret for session tokens | High | 64-char hex string |
| `CORS_ORIGINS` | Allowed frontend origins (comma-separated) | Medium | `https://gambitchess.vercel.app,http://localhost:5173` |
| `FRONTEND_URL` | Public frontend URL for OAuth & email links | Medium | `https://gambitchess.vercel.app` |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 client ID | Medium | `xxxx.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret | High | Secret string |
| `GOOGLE_REDIRECT_URI` | OAuth callback URI | Medium | `https://api.yourdomain.com/api/auth/google/callback` |
| `EMAIL_PROVIDER` | Email provider (`development`, `resend`, `smtp`) | Low | `development` |
| `RESEND_API_KEY` | Resend API key (if `EMAIL_PROVIDER=resend`) | High | `re_xxxx` |
| `GUEST_RETENTION_DAYS` | Inactive guest account purge threshold | Low | `7` |
| `LEASE_MS` | Distributed game lease duration | Low | `15000` |
| `HEARTBEAT_MS` | Distributed game lease renewal interval | Low | `5000` |
| `TRUST_PROXY` | Trust upstream proxy headers | Low | `1` |

---

## 5. Identified Railway-Specific Dependencies

1. **`railway.json` Build Metadata:**
   Railway uses this proprietary manifest for build routing and deployment restart policies. This will be superseded by `wrangler.jsonc` and Cloudflare dashboard configurations.
2. **Railway Private Networking (`*.railway.internal`):**
   Railway provisioned Redis via internal DNS `redis.railway.internal:6379`. In Cloudflare, external managed Redis with public TLS endpoints (`rediss://...`) must be utilized (e.g., Upstash Redis, Redis Cloud, or Aiven).
3. **Ephemeral File System:**
   Railway provides ephemeral container disks. Gambit correctly avoids persistent disk storage; authentication secrets and runtime state reside strictly in Postgres and Redis.
4. **Direct WebSocket Long Polling & Keep-Alive:**
   Railway holds raw TCP WebSocket connections open indefinitely without strict proxy timeouts. Any Cloudflare intermediary must support HTTP/1.1 WebSocket Upgrade with standard heartbeat ping/pongs.

---

## 6. Migration Feasibility & Readiness Assessment

- **Database:** Ready. Neon is already external to Railway; no database data migration is required, only connection pooling optimization (Cloudflare Hyperdrive).
- **Redis:** Requires migration from Railway-internal Redis to a TLS-enabled external managed Redis (Upstash / Redis Cloud).
- **Container / Edge Gateway:** Ready. Cloudflare Worker Edge Gateway (`wrangler.jsonc` + `worker/index.ts`) handles Anycast edge caching, CORS, and WebSocket proxies into the container.
