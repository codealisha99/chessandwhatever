# Database Architecture & Migration Analysis: Gambit Chess

**Project:** Gambit (`chessandwhatever`)  
**Component:** Persistent Relational Storage, Identity, and Game History  
**Database:** Neon Serverless PostgreSQL  
**Status:** Validated & Retained (Accelerated with Cloudflare Hyperdrive)  

---

## 1. Executive Summary

Gambit uses **Neon Serverless PostgreSQL** as its primary persistent database. Neon stores registered and guest user accounts, scrypt-hashed credentials, active and revoked session records, federated OAuth identities, SHA-256 hashed password reset tokens, and historical game records with move-by-move JSONB logs and rating updates.

This document:
1. Catalogs the complete relational schema, indexes, and concurrency mechanisms.
2. Explains the technical impossibility of migrating to Cloudflare D1 (SQLite) without breaking critical features.
3. Details the integration of **Cloudflare Hyperdrive** to accelerate Neon PostgreSQL connections with zero application code changes.

---

## 2. Complete Database Schema & Concurrency Primitives

The database schema is defined and migrated idempotently in `backend1/src/db.ts`:

### 2.1 Table Definitions & Indexes

```sql
-- Users & Identity
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  email TEXT,
  password_hash TEXT,
  is_guest BOOLEAN NOT NULL DEFAULT FALSE,
  rating INTEGER NOT NULL DEFAULT 1200,
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_rating ON users (rating DESC) WHERE NOT is_guest;

-- Session Lifecycle & Revocation
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  revoked_at BIGINT,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires_at);

-- Federated OAuth 2.0 Identities (Google)
CREATE TABLE IF NOT EXISTS provider_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  email TEXT,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL,
  last_login_at BIGINT NOT NULL,
  UNIQUE (provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS provider_identities_user_id ON provider_identities (user_id);
CREATE INDEX IF NOT EXISTS provider_identities_email ON provider_identities (lower(email));

-- Password Reset Tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at BIGINT NOT NULL,
  used_at BIGINT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS prt_user_id ON password_reset_tokens (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS prt_token_hash ON password_reset_tokens (token_hash);

-- Completed Game Records
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  white_id TEXT NOT NULL REFERENCES users(id),
  black_id TEXT NOT NULL REFERENCES users(id),
  white_rating INTEGER NOT NULL,
  black_rating INTEGER NOT NULL,
  white_delta INTEGER NOT NULL,
  black_delta INTEGER NOT NULL,
  tc TEXT NOT NULL,
  result TEXT NOT NULL,
  reason TEXT NOT NULL,
  pgn TEXT NOT NULL,
  moves JSONB NOT NULL,
  started_at BIGINT NOT NULL,
  ended_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS games_white ON games (white_id, ended_at DESC);
CREATE INDEX IF NOT EXISTS games_black ON games (black_id, ended_at DESC);
```

### 2.2 Advanced Concurrency & PostgreSQL Specifics

1. **Transaction-Scoped Advisory Lock (`pg_advisory_xact_lock`):**
   ```sql
   BEGIN;
   SELECT pg_advisory_xact_lock(727274);
   -- Idempotent schema creation...
   COMMIT;
   ```
   *Why this matters:* When multiple container instances boot simultaneously, this lock serializes migration execution. Because it is transaction-scoped, it automatically releases on `COMMIT` or `ROLLBACK` and never leaks behind transaction-mode connection poolers (such as Neon's pooled endpoint or Cloudflare Hyperdrive).
2. **Non-Blocking Advisory Lock for Guest Cleanup (`pg_try_advisory_xact_lock`):**
   ```sql
   SELECT pg_try_advisory_xact_lock(727275) AS locked;
   ```
   *Why this matters:* In a multi-instance cluster, only one instance runs the inactive guest account cleanup routine at any time. Other instances exit immediately without waiting or blocking.
3. **Concurrent Lock Skipping (`FOR UPDATE SKIP LOCKED`):**
   ```sql
   SELECT id FROM users
   WHERE is_guest = TRUE AND games = 0 AND created_at < $1
   LIMIT $2 FOR UPDATE SKIP LOCKED;
   ```
   *Why this matters:* Enables batched pruning of abandoned guest accounts across concurrent processes without row contention or deadlocks.
4. **JSONB Move Storage:**
   The `moves` column in `games` stores structured JSON array payloads (`[{ "san": "e4", "uci": "e2e4", "clock": 298400 }]`). PostgreSQL indexes and verifies JSONB natively.

---

## 3. Why Cloudflare D1 (SQLite) Cannot Replace Neon PostgreSQL

Cloudflare D1 is a serverless relational database built on **SQLite**. A technical comparison reveals why migrating Gambit to D1 is impossible without breaking critical features:

| Feature / Primitive | Neon PostgreSQL | Cloudflare D1 (SQLite) | Impact if Forced on D1 |
| :--- | :--- | :--- | :--- |
| **Transaction Advisory Locks** | `pg_advisory_xact_lock`, `pg_try_advisory_xact_lock` | **Not Supported** | Concurrent instances race during startup and crash migrations. |
| **Row Locking with Skip** | `FOR UPDATE SKIP LOCKED` | **Not Supported** | Inactive guest pruning fails or deadlocks the database. |
| **Partial Unique Indexes** | `WHERE email IS NOT NULL` | Supported with syntax differences | Schema migration failure. |
| **Native JSONB Storage** | Structured binary JSON (`JSONB`) | Text with JSON functions | Slower queries, lack of binary validation. |
| **Connection Pooling** | Native TCP wire protocol (`pg` pool) | Cloudflare Worker HTTP API only | Node.js backend cannot connect via standard `pg.Pool`. |
| **Database Size Limits** | Terabytes | 10 GB per database | Restricts long-term game history storage. |

### Architectural Conclusion:
Replacing Neon PostgreSQL with Cloudflare D1 is strictly rejected. Neon PostgreSQL is fully retained.

---

## 4. Cloudflare Hyperdrive Integration

To optimize latency between Cloudflare and Neon PostgreSQL, Gambit integrates **Cloudflare Hyperdrive**.

### 4.1 How Hyperdrive Works
```mermaid
sequenceDiagram
    participant Container as Node.js Backend (Cloudflare)
    participant Hyperdrive as Cloudflare Hyperdrive (Regional Pooler)
    participant Neon as Neon PostgreSQL Serverless

    Container->>Hyperdrive: TCP Connect (Local Edge Latency < 2ms)
    Hyperdrive-->>Container: Connection Ready (Warm Pool)
    Container->>Hyperdrive: Query / Transaction (BEGIN ... COMMIT)
    Hyperdrive->>Neon: Multiplexed TCP Pipeline (Keep-Alive)
    Neon-->>Hyperdrive: Result Set
    Hyperdrive-->>Container: Result Set
```

1. **Edge Connection Pooling:** Hyperdrive maintains warm TCP connections to Neon across Cloudflare's regional data centers.
2. **Reduced TLS Handshakes:** Eliminates 200–400ms connection negotiation on cold queries.
3. **Full SQL Compatibility:** Hyperdrive speaks the standard PostgreSQL wire protocol. Advisory locks, transactions, prepared statements, and JSONB queries work transparently.

### 4.2 Configuring Hyperdrive in Cloudflare

1. **Create the Hyperdrive Configuration via Wrangler CLI:**
   ```bash
   npx wrangler hyperdrive create gambit-pg \
     --connection-string="postgres://user:password@ep-xyz.us-east-2.aws.neon.tech/neondb?sslmode=require"
   ```
2. **Update `wrangler.jsonc`:**
   ```jsonc
   "hyperdrive": [
     {
       "binding": "HYPERDRIVE",
       "id": "<GENERATED_HYPERDRIVE_ID>"
     }
   ]
   ```
3. **Usage in Backend:**
   In your production environment variables, set `DATABASE_URL` to Hyperdrive's provided connection string or connect directly to Neon's pooled endpoint (`ep-xyz-pooler.us-east-2.aws.neon.tech`).

---

## 5. PostgreSQL Pool Configuration in `backend1/src/db.ts`

Gambit's connection pool is already tuned for serverless PostgreSQL:
```ts
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  // Neon scales idle databases to zero; allows sufficient time to wake up cold compute
  connectionTimeoutMillis: 20_000,
});
```
- **Max Connections:** 10 connections per container instance, preventing connection starvation on Neon's compute endpoint.
- **Connection Timeout:** 20 seconds ensures that when Neon's serverless compute wakes from zero, the connection attempt retries smoothly via `retry("database migration", migrateOnce)`.
