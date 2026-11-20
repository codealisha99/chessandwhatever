# Gambit: Comprehensive Security Audit & Threat Model

**Author:** Technical Auditor & Senior Security Engineer  
**Date:** November 2026  
**Repository:** `chessandwhatever` (Gambit)  
**Standard:** OWASP Top 10 (2021), ASVS v4.0, CWE/SANS Top 25  

---

## 1. Executive Summary & Security Posture

Gambit exhibits strong defensive engineering in several critical areas:
- **Server-Authoritative Game Logic:** Clients cannot forge moves, modify ratings, change clocks, or impersonate other players in active games.
- **SQL Injection Immune:** All database queries utilize parameterized queries (`$1`, `$2`) with `node-postgres`.
- **Timing Attack Hardened:** Password and HMAC token comparisons use `crypto.timingSafeEqual`.
- **Memory & Parsing Protected:** Incoming HTTP request bodies are strictly capped at 4KB (`MAX_BODY = 4096`), and WebSocket frames are capped at 8KB (`maxPayload = 8192`).
- **Cluster-Wide Rate Limiting:** Auth endpoints enforce Redis-backed rate limiting per IP.

However, significant security vulnerabilities and architectural gaps were identified regarding **token transmission over query parameters**, **lack of token revocation**, **potential X-Forwarded-For IP spoofing**, and **absence of password reset/email verification**.

---

## 2. Security Vulnerability Findings Matrix

| Finding ID | Title | Severity | Affected File & Lines | CWE |
|---|---|---|---|---|
| **SEC-01** | Authentication Token Exposure in WebSocket URL Query Parameter | **HIGH** | `frontend/src/lib/api.ts:50-52`<br>`backend1/src/index.ts:20` | CWE-598: Use of GET Request with Sensitive Query String |
| **SEC-02** | Inability to Revoke or Invalidate Stolen Authentication Tokens | **HIGH** | `backend1/src/auth.ts:24-43` | CWE-613: Insufficient Session Expiration |
| **SEC-03** | Rate Limiting Bypass via `X-Forwarded-For` Header Spoofing | **MEDIUM** | `backend1/src/http.ts:27-32, 42` | CWE-345: Insufficient Verification of Data Authenticity |
| **SEC-04** | Permanent Account Takeover Risk Due to Missing Email & Password Reset | **MEDIUM** | `backend1/src/db.ts:55-66`<br>`backend1/src/http.ts:73-82` | CWE-640: Weak Password Recovery Mechanism |
| **SEC-05** | Fallback Secret Generation Vulnerability in Non-Production Modes | **LOW** | `backend1/src/config.ts:12-25` | CWE-798: Use of Hard-coded or Predictable Credentials |
| **SEC-06** | Guest Account Resource Exhaustion (Postgres Bloat) | **LOW** | `backend1/src/http.ts:113-120`<br>`backend1/src/db.ts:170-177` | CWE-770: Allocation of Resources Without Limits |

---

## 3. Deep-Dive Vulnerability Analysis

### 3.1 SEC-01: Authentication Token Exposure in WebSocket URL Query Parameter
- **Severity:** **HIGH** (CVSS: 7.5 - `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N`)
- **Affected File & Location:**
  - `frontend/src/lib/api.ts:50-52`:
    ```typescript
    export function wsUrl(token: string): string {
      const base = import.meta.env.VITE_WS_URL || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
      return `${base}?token=${encodeURIComponent(token)}`
    }
    ```
  - `backend1/src/index.ts:20`:
    ```typescript
    const userId = url.pathname === "/ws" ? verifyToken(url.searchParams.get("token")) : null;
    ```
- **Root Cause:**
  The browser WebSocket API does not allow custom headers (such as `Authorization: Bearer <token>`) during the initial HTTP upgrade handshake. The developers passed the authentication token as a URL query parameter (`/ws?token=...`).
- **Exploitation Scenario:**
  URLs are routinely logged by intermediate proxies, reverse proxies (Caddy, Nginx, Railway router logs), cloud access logs, and browser history. Anyone with read access to server access logs or proxy monitoring gains access to valid 30-day user authentication tokens.
- **Recommended Remediation:**
  Implement a single-use "ticket" exchange pattern:
  1. Authenticated client makes a fast HTTP POST: `POST /api/auth/ticket` with `Authorization: Bearer <token>`.
  2. Server generates a cryptographically random ticket (e.g. 16 bytes hex), stores it in Redis with a 15-second TTL: `SET gambit:ticket:<ticket> <userId> EX 15`.
  3. Client opens WebSocket with ticket: `/ws?ticket=<ticket>`.
  4. Server retrieves and deletes the ticket atomically via Redis `GETDEL`. If valid, upgrades connection. Leaking an expired ticket grants zero access.

---

### 3.2 SEC-02: Inability to Revoke or Invalidate Stolen Authentication Tokens
- **Severity:** **HIGH** (CVSS: 7.1 - `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:L/A:N`)
- **Affected File & Location:**
  - `backend1/src/auth.ts:24-43` (`issueToken` and `verifyToken`)
  - `backend1/src/http.ts:65-71` (`authUser`)
- **Root Cause:**
  Tokens are purely stateless signed HMAC strings. There is no session table in PostgreSQL, no token versioning (`token_version`), no blacklist in Redis, and no backend logout endpoint.
- **Exploitation Scenario:**
  If a token is leaked, an adversary has unconditional access for 30 days (`tokenTtlMs = 30 * 24 * 3600_000`). If the user clicks "Log out", only their local browser `localStorage` is cleared. The stolen token remains valid. Changing passwords does not invalidate existing tokens because the token payload contains only `sub` and `exp`.
- **Recommended Remediation:**
  Add a `token_version` column to `users`:
  ```sql
  ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1;
  ```
  Include `v: user.token_version` in the token payload:
  ```typescript
  { sub: userId, v: tokenVersion, exp: Date.now() + ttl }
  ```
  On password change or explicit logout, increment `token_version`. Alternatively, store active session IDs or revocation tombstones in Redis with TTL matching token expiration.

---

### 3.3 SEC-03: Rate Limiting Bypass via `X-Forwarded-For` Header Spoofing
- **Severity:** **MEDIUM** (CVSS: 5.3 - `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:N`)
- **Affected File & Location:**
  - `backend1/src/http.ts:27-32`:
    ```typescript
    function clientIp(req: IncomingMessage): string {
      const fwd = req.headers["x-forwarded-for"];
      const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
      return (config.trustProxy && first) || req.socket.remoteAddress || "unknown";
    }
    ```
- **Root Cause:**
  The server unconditionally trusts the **first** IP in `X-Forwarded-For` whenever `config.trustProxy` is true (`TRUST_PROXY === "1" || isProd`). If the Node server is directly exposed or if an upstream proxy appends instead of overwriting client-supplied `X-Forwarded-For` headers, the client can supply an arbitrary IP.
- **Exploitation Scenario:**
  An attacker script attempting credential stuffing against `/api/auth/login` sends a different forged header on each request:
  `X-Forwarded-For: 198.51.100.<counter>`
  The Redis key `gambit:rl:auth:<ip>` shards across millions of pseudo-IPs, completely bypassing the 20 requests/minute brute-force threshold.
- **Recommended Remediation:**
  Configure edge proxies (Railway/Caddy) to overwrite `X-Forwarded-For` with the true connecting client IP. In Node, verify the proxy IP or take the IP reported by the specific trusted header provided by the deployment platform (e.g. `cf-connecting-ip` for Cloudflare, or `true-client-ip`).

---

### 3.4 SEC-04: Permanent Account Takeover Risk Due to Missing Email & Password Reset
- **Severity:** **MEDIUM** (CVSS: 4.8 - `CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:H/A:N`)
- **Affected File & Location:**
  - `backend1/src/db.ts:55-66`
  - `backend1/src/http.ts:73-82`
- **Root Cause:**
  User accounts consist strictly of `(username, password_hash)`. There is no email address, no phone number, and no multi-factor authentication.
- **Exploitation Scenario:**
  If a user forgets their password, their account, rating, and game history are permanently abandoned. If an attacker guesses or cracks a password, the legitimate user has no recourse or recovery mechanism.
- **Recommended Remediation:**
  Implement Google OAuth as the primary authentication method. For username/password accounts, require an optional email with standard cryptographic password reset tokens (HMAC token with 15-minute TTL sent via email).

---

### 3.5 SEC-05: Fallback Secret Generation Vulnerability in Non-Production Modes
- **Severity:** **LOW** (CVSS: 3.1 - `CVSS:3.1/AV:L/AC:H/PR:L/UI:N/S:U/C:L/I:L/A:N`)
- **Affected File & Location:**
  - `backend1/src/config.ts:12-25`:
    ```typescript
    function loadSecret(): string {
      if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
      if (isProd) throw new Error("AUTH_SECRET must be set in production");
      mkdirSync(dataDir, { recursive: true });
      const file = join(dataDir, ".auth-secret");
      ...
    }
    ```
- **Root Cause:**
  If an operator deploys the server without setting `NODE_ENV=production`, the application silently writes a random secret to disk instead of throwing a configuration error. If multiple containers start without shared disk, they generate mismatched secrets and reject each other's tokens.
- **Recommended Remediation:**
  Require `AUTH_SECRET` unconditionally unless explicitly running unit tests.

---

### 3.6 SEC-06: Guest Account Resource Exhaustion (Postgres Bloat)
- **Severity:** **LOW** (CVSS: 3.7 - `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L`)
- **Affected File & Location:**
  - `backend1/src/http.ts:113-120`
- **Root Cause:**
  Every call to `POST /api/auth/guest` inserts a permanent row into the PostgreSQL `users` table. Although rate-limited to 20/min/IP, distributed bots can generate tens of thousands of guest rows that never expire or get cleaned up.
- **Recommended Remediation:**
  Implement a periodic background vacuum / cleanup job that purges guest users older than 7 days who have `games = 0`.

---

## 4. Specific Security Checks & Validations

| Audit Domain | Assessment | Verification Findings & Evidence |
|---|---|---|
| **SQL Injection** | **SECURE** | All queries in `backend1/src/db.ts` use parameterized SQL statements (`$1`, `$2`). Zero dynamic string concatenation into SQL statements. |
| **XSS (Cross-Site Scripting)** | **SECURE** | React 19 JSX escapes string values by default. In `Board.tsx`, SVGs are loaded via static asset paths (`/pieces/...`). In chat, user text is rendered as plain React text nodes (`<span>{c.text}</span>`), avoiding `dangerouslySetInnerHTML`. |
| **CSRF (Cross-Site Request Forgery)** | **SECURE** | The application does not use cookies for authentication. API calls use `Authorization: Bearer <token>`. Browsers do not automatically attach Bearer headers on cross-site requests, neutralizing CSRF. |
| **CORS Configuration** | **SECURE** | `backend1/src/http.ts:143-147` verifies incoming `Origin` against `config.corsOrigins`. Unlisted origins receive no CORS header (`Access-Control-Allow-Origin` is omitted). Verified in `cluster.test.ts:108-119`. |
| **Server-Side Move Validation** | **SECURE** | Every move received over WebSocket is validated by `this.chess.move(input)` in `backend1/src/Game.ts:257`. Invalid moves trigger `move_rejected` and do not alter board state. |
| **Game & Rating Manipulation** | **SECURE** | Ratings are computed by `eloDelta()` in pure TypeScript on the server and written to Postgres within the same transaction that stores the finished game. Clients have zero write access to Elo calculations. |
| **Information Leakage in Logs** | **SECURE** | Password hashes and secrets are never logged. Logger in `backend1/src/logger.ts` formats ISO timestamp + level + message + sanitized meta objects. |
