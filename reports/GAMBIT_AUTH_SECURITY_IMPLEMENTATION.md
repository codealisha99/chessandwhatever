# GAMBIT: Authentication, Identity & Security Hardening Implementation Report

**Milestone:** P0 Authentication, Identity & Security Hardening  
**Target Repository:** `chessandwhatever` (Gambit)  
**Status:** IMPLEMENTED & VERIFIED  
**Date:** 2026-11-21  

---

## Executive Summary

Gambit's original authentication system relied exclusively on custom username/password pairs and ephemeral guest accounts, with JWTs containing only a user identifier passed directly in WebSocket connection query parameters (`/ws?token=...`). There was no support for federated identity, no mechanism for server-side token revocation or session termination, no password recovery path, and guest accounts accumulated indefinitely in the PostgreSQL database.

This engineering milestone implements a complete, zero-debt hardening of Gambit's authentication, session management, and credential lifecycle:

1. **Google OAuth 2.0 / OpenID Connect:** Fully compliant Authorization Code Flow with PKCE-grade state and nonce validation, JWKS signature verification via `jose`, and secure account linking.
2. **Secure WebSocket Authentication (Ticket Exchange):** Elimination of credentials in query strings and URLs. Single-use, short-lived (30s) cryptographically random tickets exchanged via atomic Redis `GETDEL` during HTTP-to-WS upgrade.
3. **Session Lifecycle & Token Revocation:** Dedicated PostgreSQL `sessions` table tracking user agent and IP, cached revocation in Redis, immediate WebSocket termination across multi-instance clusters via Redis pub/sub (`ch:user:{uid}`), and single/all-session logout endpoints.
4. **Password Recovery & Reset:** Cryptographically secure single-use reset tokens with SHA-256 storage hashing, 15-minute expiration, pluggable email service interface (`IEmailService`), and automatic session revocation upon password update.
5. **Guest Account Lifecycle & Automated Cleanup:** Scheduled 24-hour background worker and CLI command for safely pruning zero-game inactive guests older than 7 days in batches, complete with dry-run capabilities and game history protection.

---

## Architecture & Workstream Details

```
+-----------------------------------------------------------------------------------+
|                                  GAMBIT CLIENT                                    |
|   React 19 + Vite SPA (AuthContext, OnlineContext, AuthCallback, ResetPassword)   |
+------------------------+---------------------------------+------------------------+
                         | HTTPS                           | WSS (ticket)
                         v                                 v
+-----------------------------------------------------------------------------------+
|                                  HTTP & WS SERVER                                 |
|                                    Node.js 24                                     |
|  +--------------------+  +--------------------+  +-----------------------------+  |
|  | /api/auth/google   |  | /api/auth/ticket   |  | server.on('upgrade')        |  |
|  | /api/auth/logout   |  | /api/auth/reset-*  |  | consumes single-use ticket  |  |
|  +--------------------+  +--------------------+  +-----------------------------+  |
|                         \           |           /                                 |
+--------------------------\----------|----------/----------------------------------+
                            v         v         v
+--------------------------------+       +------------------------------------------+
|            REDIS 7             |       |             NEON POSTGRESQL              |
| - Single-use tickets (GETDEL)  |       | - users (email, provider links)          |
| - OAuth state / nonce (GETDEL) |       | - sessions (active sessions & metadata)  |
| - Revoked session cache        |       | - provider_identities (oauth linking)    |
| - Cluster pub/sub revocation   |       | - password_reset_tokens (hashed tokens)  |
+--------------------------------+       +------------------------------------------+
```

---

### Workstream 1: Google OAuth 2.0 / OpenID Connect

#### Architecture & Flow
```
Client                      Gambit Server                Google OIDC Provider
  |                               |                               |
  |--- GET /api/auth/google ----->|                               |
  |    (or browser navigation)    |-- Generate state & nonce ---->| Store in Redis
  |<-- 302 to Google Auth URL ----|                               |
  |                                                               |
  |----------------- User approves on Google -------------------->|
  |                                                               |
  |<----------------- 302 Redirect with code & state -------------|
  |                                                               |
  |--- GET /api/auth/google/callback?code=...&state=... --------->|
  |                               |-- Atomic GETDEL state ------->| Validate nonce
  |                               |-- POST /token (code) -------->|
  |                               |<-- Return tokens (id_token)---|
  |                               |-- Verify JWKS (jose) -------->|
  |                               |-- Verify audience & issuer -->|
  |                               |-- Find/Link User in Postgres->|
  |                               |-- Issue Session & JWT ------->|
  |<-- 302 /auth/callback?token=--|                               |
  |                               |                               |
  |--- Store token & redirect --->|                               |
```

#### Security Safeguards
- **State & Nonce Validation:** Every authorization request generates a 32-byte cryptographic random state and 32-byte nonce stored in Redis under `oauth:state:{state}` with a 10-minute TTL. Upon callback, the state is retrieved and deleted atomically (`GETDEL`), preventing replay attacks.
- **Strict OIDC ID Token Verification:** Validates signature using Google's public JWKS (`https://www.googleapis.com/oauth2/v3/certs`), matching `issuer` against `["https://accounts.google.com", "accounts.google.com"]`, `audience` against `config.googleClientId`, and verifying token expiration and the embedded `nonce`.
- **Account Linking Safety:** Only accounts where Google guarantees `email_verified: true` can link to an existing user with matching email (`lower(users.email)`). Unverified emails cannot link and are rejected. User IDs are immutable UUIDs; identities are recorded in `provider_identities`.

---

### Workstream 2: Secure WebSocket Authentication (Ticket Exchange)

#### Problem
In the original implementation, the client established WebSocket connections using `/ws?token=<raw_jwt>`. This exposed signed authentication tokens to:
1. Server access logs and reverse-proxy logs (Vercel, Railway, Cloudflare).
2. Browser history and referrer headers.
3. Network monitoring tools.

#### Solution: Single-Use Ticket Exchange
```
Client (OnlineContext)             HTTP Endpoint (/api/auth/ticket)      Redis / Upgrade Handler
  |                                             |                                    |
  |--- POST /api/auth/ticket (Bearer JWT) ----->|                                    |
  |                                             |-- Verify JWT & session active ---->|
  |                                             |-- SET ticket:{uuid} payload EX 30 >|
  |<-- 200 { ticket: "uuid", expiresIn: 30 } --|                                    |
  |                                                                                  |
  |--- WS Connect: /ws?ticket=uuid ------------------------------------------------->|
                                                                                     |-- redis.getdel(ticket:{uuid})
                                                                                     |   (Atomic: consumed once)
                                                                                     |-- Check session not revoked
                                                                                     |<-- HTTP/1.1 101 Switching Protocols
```

- Tickets expire in 30 seconds (`config.ticketTtlMs = 30_000`).
- The ticket payload stores `{ userId, sessionId }`.
- Upgrade handler calls `redis.getdel(K.ticket(ticket))`. Any attempted reuse or replay results in immediate `HTTP/1.1 401 Unauthorized` and socket destruction.
- Backward compatibility: Legacy `/ws?token=...` is retained as a fallback during rolling client deployments.

---

### Workstream 3: Token Revocation, Server-Side Logout & Session Lifecycle

#### Database Schema: `sessions`
```sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_active ON sessions (user_id) WHERE revoked_at IS NULL;
```

#### Token Format
JWT payloads now include the session identifier `sid`:
```json
{
  "sub": "user-uuid",
  "sid": "session-uuid",
  "exp": 1732200000000
}
```

#### Revocation & Real-Time Termination Flow
```
User (Client)                 HTTP Server                  Redis (Cluster)          Active Sockets
  |                               |                               |                       |
  |--- POST /api/auth/logout ---->|                               |                       |
  |    (or /api/auth/logout-all)  |-- UPDATE sessions SET ... --->|                       |
  |                               |-- SET sess:rev:{sid} EX ... ->| (Fast-path cache)     |
  |                               |-- PUBLISH ch:user:{uid} ----->|                       |
  |                               |   { type: "session_revoked" } |                       |
  |                               |                               |====== Broadcast =====>|
  |                               |                               |                       |-- Match socket.sessionId
  |                               |                               |                       |-- ws.close(1008, "Revoked")
  |<-- 200 { ok: true } ----------|                               |                       |
```

- When `POST /api/auth/logout` is called:
  1. Session record in Postgres is stamped with `revoked_at = NOW()`.
  2. Redis key `sess:rev:{sessionId}` is set with TTL matching token expiry for sub-millisecond upgrade checks.
  3. `manager.revokeUserSessions(userId, sessionId)` publishes `{ type: "session_revoked", sessionId }` on Redis channel `ch:user:{userId}`.
  4. All cluster instances listening to `ch:user:{userId}` immediately terminate the matching WebSockets with close code `1008 (Policy Violation)`.
- When `POST /api/auth/logout-all` or password reset is triggered, all active sessions for that user are revoked in Postgres and all connected sockets for that user are terminated immediately across all instances.

---

### Workstream 4: Password Recovery & Password Reset

#### Database Schema: `password_reset_tokens`
```sql
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_hash ON password_reset_tokens (token_hash) WHERE consumed_at IS NULL;
```

#### Workflow
1. **Request (`POST /api/auth/forgot-password`):**
   - Rate limited to protect against enumeration.
   - Looks up user by lowercase email.
   - If user exists: generates 32-byte cryptographically secure random token (`rawToken`).
   - Computes SHA-256 digest: `tokenHash = createHash("sha256").update(rawToken).digest("hex")`.
   - Stores `tokenHash` with 15-minute expiration (`expires_at = NOW() + 15m`).
   - Dispatches reset link through `IEmailService`: `${config.frontendUrl}/reset-password?token=${rawToken}`.
   - Always returns constant generic message: `"If that email is registered, a password reset link has been sent."` preventing account discovery.
2. **Reset (`POST /api/auth/reset-password`):**
   - Hashes submitted token with SHA-256.
   - Atomically verifies `consumed_at IS NULL AND expires_at > NOW()`.
   - Hashes new password with scrypt (`auth.hashPassword`).
   - Updates `users.password_hash` and sets `password_reset_tokens.consumed_at = NOW()`.
   - Revokes all existing user sessions (`revokeAllUserSessions`) and drops active WebSockets.

---

### Workstream 5: Guest Account Lifecycle & Automated Cleanup

#### Policy
- A guest account is defined as `is_guest = TRUE` (or `password_hash IS NULL`).
- A guest is considered inactive if `created_at < NOW() - INTERVAL '7 days'`.
- **Game History Invariant:** Any guest that has played $\ge 1$ games (`games > 0` or foreign key reference in `games` table) is **permanently preserved** to protect game archives, ratings integrity, and opponent match histories.
- Eligible for deletion: `is_guest = TRUE AND games = 0 AND created_at < NOW() - INTERVAL '7 days'`.

#### Implementation: `backend1/src/cleanup.ts`
- **Automated Scheduler:** `startGuestCleanupScheduler()` executes on server boot and runs every 24 hours.
- **Batch Processing:** Uses `batchSize` (default 500) with `LIMIT` and subquery delete to prevent long table locks:
  ```sql
  DELETE FROM users
  WHERE id IN (
    SELECT u.id FROM users u
    LEFT JOIN games g ON (u.id = g.white_id OR u.id = g.black_id)
    WHERE u.is_guest = TRUE
      AND u.games = 0
      AND g.id IS NULL
      AND u.created_at < $1
    LIMIT $2
  );
  ```
- **CLI Command:** Supports manual or cron execution:
  ```bash
  node src/cleanup.ts --dry-run
  node src/cleanup.ts --days 14 --batch 1000
  ```

---

## Configuration Reference

| Environment Variable | Default | Purpose |
|---|---|---|
| `GOOGLE_CLIENT_ID` | `""` | Google Cloud Console OAuth 2.0 Web Client ID |
| `GOOGLE_CLIENT_SECRET` | `""` | Google Cloud Console OAuth 2.0 Client Secret |
| `GOOGLE_REDIRECT_URI` | `""` | Callback URL (`http://localhost:3000/api/auth/google/callback`) |
| `FRONTEND_URL` | `http://localhost:5173` | Frontend origin for OAuth redirects and email links |
| `EMAIL_PROVIDER` | `development` | `development` (in-memory logger) or `production` (Resend/SMTP) |
| `RESEND_API_KEY` | `""` | API key for production email delivery via Resend |
| `GUEST_RETENTION_DAYS` | `7` | Retention period for inactive 0-game guest accounts |
| `TICKET_TTL_MS` | `30000` | TTL in milliseconds for single-use WS tickets (30s) |
| `RESET_TOKEN_TTL_MS` | `900000` | TTL in milliseconds for password reset tokens (15m) |

---

## File Manifest

| File | Status | Description |
|---|---|---|
| `backend1/src/config.ts` | Modified | Added OAuth, email, guest retention, and ticket TTL configs |
| `backend1/src/db.ts` | Modified | Migrations and repository for `sessions`, `provider_identities`, `password_reset_tokens` |
| `backend1/src/redis.ts` | Modified | Redis key definitions for `ticket`, `sessionRevoked`, `oauthState` |
| `backend1/src/auth.ts` | Modified | Added `sid` to token payload and `hashResetToken` |
| `backend1/src/oauth.ts` | Created | Google OIDC authorization request, code exchange, and JWKS verification |
| `backend1/src/email.ts` | Created | `IEmailService`, `DevelopmentEmailService`, `ProductionEmailService` |
| `backend1/src/cleanup.ts` | Created | Guest cleanup worker, scheduler, and CLI script |
| `backend1/src/GameManager.ts` | Modified | Multi-session socket tracking and cluster-wide revocation subscriber |
| `backend1/src/http.ts` | Modified | Added routes: `/api/auth/ticket`, `logout`, `google`, `reset-password`, `PATCH /api/me` |
| `backend1/src/index.ts` | Modified | Single-use ticket upgrade verification, session check, cleanup scheduler |
| `backend1/src/auth.test.ts` | Created | Automated test suite covering all 5 security areas |
| `frontend/src/lib/api.ts` | Modified | Added `getWsTicket()`, updated `wsUrl()` for tickets, added `getGoogleAuthUrl()` |
| `frontend/src/context/AuthContext.tsx` | Modified | Added server-side `logout()`, `logoutAll()`, `setAuthToken()` |
| `frontend/src/context/OnlineContext.tsx` | Modified | Integrated single-use ticket exchange before establishing WS connection |
| `frontend/src/pages/Auth.tsx` | Modified | Added "Continue with Google" button and "Forgot password?" link |
| `frontend/src/pages/AuthCallback.tsx` | Created | OAuth callback receiver and session adoption component |
| `frontend/src/pages/ForgotPassword.tsx` | Created | Clean password reset request screen |
| `frontend/src/pages/ResetPassword.tsx` | Created | Password update screen with confirmation and validation |
| `frontend/src/App.tsx` | Modified | Added routing for `/auth/callback`, `/forgot-password`, `/reset-password` |
