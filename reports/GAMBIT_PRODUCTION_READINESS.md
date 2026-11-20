# Gambit: Production Readiness, Scalability & Infrastructure Audit

**Author:** Senior Software Architect & Technical Auditor  
**Date:** November 2026  
**Repository:** `chessandwhatever` (Gambit)  

---

## 1. Executive Summary: Production Readiness Assessment

Gambit's core backend architecture is **substantially closer to high-scale production readiness than most typical hobby or prototype chess applications**. It already possesses:
1. Stateless application servers sharing state through Redis.
2. Server-side authoritative clock timing with atomic snapshot commits.
3. Resilient cross-instance failover and rolling restart handling.
4. Client-side Stockfish 19 WASM compute decoupling.

However, specific infrastructure and scaling bottlenecks must be addressed before opening the platform to large-scale public traffic, particularly around **Neon Postgres connection limits**, **matchmaking queue algorithm limitations**, and **observability**.

---

## 2. Scalability Analysis by Concurrency Tier

### Tier 1: 100 Concurrent Users (~50 Concurrent Games)
- **Status:** **FULLY READY TODAY**
- **Hardware Requirement:** 1 Backend Instance (0.5 vCPU, 512MB RAM) on Railway + 1 Redis Instance + Neon Postgres Free/Starter Tier.
- **Resource Footprint:**
  - WebSocket Connections: ~100 open sockets (~3.5 MB RAM total for `ws`).
  - Active Games in Memory: ~50 `Game` objects (~2 MB RAM).
  - Redis Operations: ~25 moves/second ($\approx 50$ operations/sec across snapshot commits and pub/sub). Negligible load (<1% CPU).
  - PostgreSQL Connections: 2–3 active pool connections.
- **Bottlenecks:** None. Existing code handles this tier effortlessly.

---

### Tier 2: 1,000 Concurrent Users (~500 Concurrent Games)
- **Status:** **READY WITH MINOR OPERATIONAL TUNING**
- **Hardware Requirement:** 2–3 Backend Instances (1 vCPU, 1GB RAM each) behind a load balancer + Railway Redis (Starter/Pro) + Neon Postgres (Pooled endpoint).
- **Resource Footprint:**
  - WebSocket Connections: ~1,000 open sockets distributed across 2–3 nodes (~300–500 sockets/node).
  - Memory: Node process memory ~150–250MB per instance.
  - Redis Operations: ~250–500 moves/sec. Redis CPU usage ~5–10%.
  - PostgreSQL Pool: With 3 instances running `max: 10` connections each (`backend1/src/db.ts:47`), total pool connections = 30. Neon's pooled endpoint handles 10,000 concurrent client connections via PgBouncer.
- **Actual Bottlenecks Identified at this Scale:**
  1. **Matchmaking Pairing Latency:** With 1,000 users across 11 time controls, FIFO queue matching might match a 2100 Elo player with a 900 Elo player if they are the only two queuing for 30+20.
  2. **Presence SUNION Overhead:** `presence.onlineCount()` currently executes `redis.sunion(...ids.map(K.online))` (`backend1/src/redis.ts:189`). With 1,000 items in set unions every few seconds, Redis CPU is fine, but should be monitored.

---

### Tier 3: 10,000 Concurrent Users (~5,000 Concurrent Games)
- **Status:** **REQUIRES ARCHITECTURAL REFACTORING**
- **Hardware Requirement:** 8–12 Backend Replicas (2 vCPU, 2GB RAM each) + Dedicated Redis Cluster (Memory 2GB+) + Neon Postgres Scale Tier (PgBouncer pooled).
- **Critical Bottlenecks at 10,000 Concurrency:**
  1. **Redis Pub/Sub Fanout Amplification:**
     - In `GameManager.deliver()` (`backend1/src/GameManager.ts:286-295`), every move publishes to user channels and watch channels. With 5,000 active games generating ~2,500 moves/sec, Redis processes 2,500 MULTI transactions per second. A single-threaded Redis instance begins saturating around 25,000–50,000 complex pub/sub writes per second.
  2. **Presence Set Union Bottleneck:**
     - `presence.onlineCount()` running `SUNION` across 12 instances with 10,000 members will block the Redis event loop for 5–15ms per poll.
     - *Fix:* Replace `SUNION` with Redis `HyperLogLog` (`PFADD` on connection, `PFCOUNT` for total presence count), reducing time complexity from $\mathcal{O}(N)$ to $\mathcal{O}(1)$.
  3. **Finished Game Database Contention:**
     - At 5,000 concurrent games with average duration 5 minutes, ~16 games finish per second. Each writes a 50-move JSON array and updates two user rating rows in a transaction.
     - *Fix:* Use batching or a durable queue (BullMQ / Redis stream) for background game archiving instead of direct inline async `repo.saveFinishedGame` calls.

---

## 3. Infrastructure & Component Deep Dive

### 3.1 Database Connection Management (`backend1/src/db.ts`)
- **Current Configuration:**
  ```typescript
  export const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 20_000,
  });
  ```
- **Neon Serverless Characteristics:**
  - Neon scales idle compute endpoints to zero. When an endpoint wakes from cold start, connection establishment can take 1.5–3 seconds.
  - Gambit accounts for this via `connectionTimeoutMillis: 20_000` and `retry.ts` exponential backoff (`attempts: 6, maxMs: 15_000`).
- **Production Advisory:**
  - Must always connect via Neon's **pooled connection string** (PgBouncer port 6543) in production (`-pooler` suffix in hostname). Direct connections will exhaust Postgres connection limits if backend replicas scale horizontally.

### 3.2 WebSocket Connection Management & Slow Client Handling
- **Memory & Throughput:**
  - Node `ws` engine requires approximately 30KB–50KB per idle socket.
  - Maximum payload enforced: `maxPayload: 8 * 1024` (8KB) in `backend1/src/index.ts:15`. Prevents memory exhaustion attacks via oversized JSON payloads.
- **Slow Client Protection (`GameManager.ts:152-156`):**
  - If a client's `ws.bufferedAmount` exceeds 1MB (`MAX_BUFFERED_BYTES = 1 << 20`), the server abruptly terminates the connection with code `1013` ("Client too slow"). This prevents runaway buffer memory leaks if mobile clients hang on bad cellular connections.
- **Per-Socket Rate Limiting (`GameManager.ts:135-148`):**
  - Token bucket algorithm allows up to 12 messages/second (`RATE_PER_SEC = 12`). Exceeding this adds strikes; 20 consecutive strikes closes the connection with code `1008`.

### 3.3 Redis Caching, Leases, and Pub/Sub Backplane
- **Game Ownership Lease:**
  - `game:{gid}:owner` key holds the owning instance ID with a 15-second TTL (`config.leaseMs = 15_000`).
  - Owner renews lease every 5 seconds (`config.heartbeatMs = 5_000`).
  - If an owner crashes, `games.renew()` fails. During `tick()`, survivor instances detect expired leases on live games and claim ownership using `swapIfEquals` or `claim` (NX).
- **Snapshot Atomicity:**
  - `games.commit()` bundles snapshot JSON update, live zset update, active game pointers, and pub/sub message publications in a single `MULTI ... EXEC` pipeline. This eliminates race conditions where an event is consumed before its state snapshot is visible.

---

## 4. Cost-Conscious Architecture Recommendations

To keep operating costs under **$15–$35/month** while supporting up to 2,000 concurrent active users:

1. **Avoid Kubernetes & Microservices:**
   The entire application is perfectly partitioned between a single modular monolith Node service, Redis, and Postgres. Deploying Kubernetes or splitting into microservices would add substantial infrastructure costs and operational overhead without any benefit.
2. **Recommended Production Hosting Setup:**
   - **Frontend:** Vercel Hobby / Pro ($0 – $20/mo). Static CDN caching eliminates server bandwidth costs for HTML/JS/WASM/SVG assets.
   - **Backend:** Railway or Render ($5 – $15/mo). 2 container replicas with 1 vCPU and 1GB RAM each.
   - **Redis:** Railway Managed Redis or Upstash ($5 – $10/mo).
   - **Database:** Neon Postgres Launch Tier ($0 – $19/mo). Automated branch databases for staging/PR previews.
3. **Observability Stack:**
   - Instead of expensive Datadog/NewRelic agents, utilize structured JSON logging with Axiom or BetterStack ($0 free tiers), paired with a Prometheus endpoint (`/api/metrics`) scraped by Grafana Cloud free tier.
