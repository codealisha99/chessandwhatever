# Redis Architecture & Migration Strategy: Gambit Chess

**Project:** Gambit (`chessandwhatever`)  
**Component:** Distributed Coordination, Matchmaking, Real-Time Pub/Sub, and State Synchronization  
**Status:** Validated  

---

## 1. Executive Summary

Gambit's multi-instance architecture relies on Redis as a real-time distributed state and message broker. Redis coordinates matchmaking, turn clocks, distributed leases, instance failover, spectator fanouts, and rate limiting across independent server instances.

This document details:
1. Every Redis key, set, sorted set, channel, and custom Lua script in Gambit.
2. An exhaustive technical analysis explaining why Cloudflare KV and Durable Objects cannot substitute for Redis without an application rewrite.
3. The managed Redis migration roadmap (Upstash Redis, Redis Cloud, Aiven) using secure TLS (`rediss://`).

---

## 2. Inventory of Redis Data Structures & Operations

All keys in Gambit are prefixed by `config.redisPrefix` (default `gambit:`), allowing multiple staging or preview environments to safely share the same Redis cluster without key collisions.

### 2.1 Keys and Data Structures

| Key Pattern | Redis Type | TTL / Lifecycle | Description & Consistency Requirements |
| :--- | :--- | :--- | :--- |
| `instances` | **Set** | Persistent | Set of all active cluster `instanceId` strings. Pruned on node exit or crash. |
| `instance:{iid}` | **String** | `LEASE_MS` (15s) | Heartbeat timestamp. If expired, peer instances consider this instance dead. |
| `online:{iid}` | **Set** | Instance lifetime | Set of user IDs currently connected via WebSocket to this specific instance. |
| `queue:{tc}` | **List (FIFO)** | Indefinite | Matchmaking queue for time control `{tc}` (e.g. `queue:5+3`). Managed via Lua `matchPop`. |
| `user:{uid}:queue` | **String** | 6 hours | Tracks which time control `{tc}` user `{uid}` is currently queued for. |
| `user:{uid}:room` | **String** | 1 hour | Active private invite room code created or joined by user `{uid}`. |
| `user:{uid}:game` | **String** | Active game TTL | Active game ID currently being played by user `{uid}`. Cleared on game finish. |
| `room:{code}` | **String (JSON)** | 1 hour | Private game invite room metadata (`{ code, hostId, tc, color }`). Atomic join via `GETDEL`. |
| `game:{gid}` | **String (JSON)**| 6h active / 15m done | Full serialized `GameSnapshot` (FEN, clock, moves, offers, chat). Updated via `MULTI`. |
| `game:{gid}:owner` | **String** | `LEASE_MS` (15s) | Distributed lease identifying which instance owns the game clock. Acquired via `SET NX PX`. |
| `game:{gid}:watchers` | **Set** | 6h active / 15m done | Set of spectator user IDs currently viewing game `{gid}`. |
| `live` | **Sorted Set** | Game duration | Active games scored by `whiteRating + blackRating`. Used by `GET /api/live` for game discovery. |
| `rl:{bucket}:{id}` | **String (Int)** | Window (ms) | Rate limit sliding counter. Atomic increment via `MULTI INCR + PEXPIRE NX`. |
| `ticket:{t}` | **String** | 30 seconds | Single-use WebSocket authentication ticket. Atomic consumption via `GETDEL`. |
| `sess:rev:{sid}` | **String** | Session TTL | Revoked session marker for low-latency session blacklist lookups. |
| `oauth:state:{s}` | **String** | 10 minutes | OAuth 2.0 PKCE / state nonce validation string. |

### 2.2 Pub/Sub Channels

| Channel Pattern | Payload | Purpose |
| :--- | :--- | :--- |
| `ch:user:{uid}` | `GameUpdate` JSON | Delivers game moves, resignations, draw offers, and chat to all open sockets of user `{uid}` across any server instance. |
| `ch:watch:{gid}` | `GameUpdate` JSON | Real-time spectator broadcast channel. |
| `ch:instance:{iid}` | Instance Command JSON | Inter-instance commands (e.g., instructing an instance to yield or assume a game clock). |

### 2.3 Custom Atomic Lua Scripts

Gambit registers 4 atomic Lua scripts via `redis.defineCommand`:

#### 1. Matchmaking FIFO (`matchPop`)
```lua
redis.call('LREM', KEYS[1], 0, ARGV[1])
local opp = redis.call('LPOP', KEYS[1])
if opp then return opp end
redis.call('RPUSH', KEYS[1], ARGV[1])
return false
```
*Guarantees zero race conditions: a player cannot be matched with themselves, and two concurrent players are paired atomically.*

#### 2. Lease Renewal (`renewIfEquals`)
```lua
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
```
*Prevents a slow instance from extending a lease it has already lost to a peer.*

#### 3. Conditional Lease Release (`delIfEquals`)
```lua
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
end
return 0
```
*Ensures an instance only deletes the lease if it is still the rightful holder.*

#### 4. Instance Failover / Steal (`swapIfEquals`)
```lua
if redis.call('GET', KEYS[1]) == ARGV[1] then
    redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
    return 1
end
return 0
```
*Allows an instance to atomically take over a game from an instance confirmed to be dead.*

---

## 3. Why Cloudflare KV & Durable Objects Cannot Replace Redis

| Requirement | Redis 7 | Cloudflare Workers KV | Cloudflare Durable Objects |
| :--- | :--- | :--- | :--- |
| **Consistency Model** | **Strong consistency** | **Eventual consistency** (up to 60s replication delay) | Strong consistency per object |
| **Atomic Transactions** | `MULTI`/`EXEC`, Lua scripts | Not supported | Supported within single object |
| **Pub/Sub Broker** | High-throughput `PUBLISH` / `SUBSCRIBE` | Not supported | Websocket Hibernation requires custom broadcast tree |
| **Sorted Sets (`ZSET`)** | Native `ZADD`, `ZREVRANGE` | Not supported | Must be manually coded in memory or SQLite |
| **Millisecond TTLs** | `PEXPIRE`, `PX` (5000ms leases) | Minimum TTL is **60 seconds** | Alarms run in seconds, not milliseconds |
| **Single-Use Consumption** | `GETDEL` (atomic) | Not supported (race condition risk) | Supported |

### Architectural Conclusion:
Attempting to replace Redis with Cloudflare KV would break matchmaking, lease renewals, spectator broadcasts, and turn clocks. Replacing it with Durable Objects would require completely rewriting Gambit's backend communication protocol. Maintaining an external managed Redis cluster preserves **100% functionality** with zero code changes.

---

## 4. Managed Redis Recommendation & Setup

### 4.1 Recommended Providers
1. **Upstash Redis (Recommended for Cloudflare):**
   - Native support for standard Redis protocol over TLS (`rediss://`).
   - Serverless pricing ($0.20 per 100k commands) or fixed plans ($10/month).
   - Global low latency and direct integration with Cloudflare.
2. **Redis Cloud (Official Redis Ltd):**
   - High performance, automated backups, multi-zone replication.
   - Fixed pricing starting at $5/month.
3. **Aiven Redis:**
   - Dedicated VPC peering and high compliance.

### 4.2 Configuration Parameters
When connecting from the Cloudflare container backend, configure:
```env
REDIS_URL=rediss://default:<PASSWORD>@<HOST>.upstash.io:6379
REDIS_PREFIX=gambit:prod:
```
*Note: Always use `rediss://` (with double 's') to enforce TLS encryption in transit.*

### 4.3 Network & Latency Optimization
- **Region Colocation:** Choose a Redis region that matches your backend container and Neon PostgreSQL region (e.g., `us-east` / `iad` or `eu-central`).
- **Connection Family:** Gambit's Redis client is configured with `family: 0` in `backend1/src/redis.ts`, ensuring compatibility with both IPv4 and IPv6 endpoints.
- **Connection Retries:** Configured with exponential backoff (`Math.min(times * 200, 3000)`) and `maxRetriesPerRequest: 3`.
