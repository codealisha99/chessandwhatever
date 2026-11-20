# Gambit: Authentication & Authorization Comprehensive Audit

**Author:** Technical Auditor, Senior Backend & Security Engineer  
**Date:** November 2026  
**Repository:** `chessandwhatever` (Gambit)  
**Target:** Authentication Architecture, Security Posture, and Google OAuth Integration Strategy  

---

## 1. Executive Summary: Current Authentication State

The authentication system in Gambit is a lightweight, custom, stateless username/password and guest token system.
- **User Registration:** Implemented with username + password. No email is collected or supported.
- **Login:** Implemented with username + password verification via Node.js `crypto.scrypt`.
- **Guest Access:** Implemented via a one-click guest generator creating ephemeral accounts with a starting 1200 Elo.
- **Google OAuth:** **NOT IMPLEMENTED.** There is zero OAuth infrastructure, zero Google client configuration, zero callback routes, and no Google sign-in buttons on the frontend.
- **GitHub / Third-Party OAuth:** **NOT IMPLEMENTED.**
- **Token Mechanism:** Custom 2-part signed compact token (`base64url(JSON).signature`) using HMAC-SHA256 with a 30-day fixed TTL.
- **Token Storage:** Browser `localStorage` (`gambit.token`).

---

## 2. Detailed Technical Audit of Existing Auth Implementation

### 2.1 Identity Model & Schema (`backend1/src/db.ts:55-66`)
The PostgreSQL database defines the identity schema in the `users` table:
```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS users_rating ON users (rating DESC) WHERE NOT is_guest;
```

**Key Findings:**
1. **No Email Field:** Users cannot provide an email. There is no password recovery or account verification mechanism.
2. **Password Hash Storage:** Nullable string. For guest accounts, `password_hash` is `NULL` and `is_guest` is `TRUE`.
3. **Username Constraints:**
   - Database enforces case-insensitive uniqueness via `lower(username)`.
   - Application regex enforces `/^[A-Za-z0-9_]{3,20}$/` (`backend1/src/auth.ts:45`).
   - Guest usernames (`^guest_`) are reserved in code (`backend1/src/http.ts:97`).

### 2.2 Password Hashing & Verification (`backend1/src/auth.ts:8-20`)
- **Algorithm:** Node.js native `crypto.scrypt` with a 16-byte cryptographically secure random salt (`randomBytes(16)`) and a 64-byte key length.
- **Format:** `scrypt$<saltHex>$<keyHex>`.
- **Timing Attack Resistance:** Verification uses `crypto.timingSafeEqual` to prevent timing side-channel attacks during hash comparisons.
- **Verdict:** Secure password hashing implementation; adheres to modern cryptographic standards for password storage.

### 2.3 Token Architecture & Session Management (`backend1/src/auth.ts:24-43`)
- **Format:** Not a standard JWT; it is a compact 2-part token:
  $$\text{Token} = \text{base64url}(\{ \text{"sub"}: \text{userId}, \text{"exp"}: \text{timestamp} \}) \,.\, \text{HMAC-SHA256}(\text{body}, \text{secret})$$
- **Lifetime:** Fixed at 30 days (`config.tokenTtlMs = 30 * 24 * 3600_000`).
- **Signature Verification:** Uses `crypto.timingSafeEqual` to compare expected HMAC digest with provided signature.
- **Verification Logic:**
  - Decodes payload.
  - Verifies `sub` is a string and `exp > Date.now()`.
  - Returns `userId` if valid, otherwise `null`.

### 2.4 Endpoints Analysis (`backend1/src/http.ts`)

| Endpoint | Method | Auth Required | Rate Limited? | Behavior & Implementation Details |
|---|---|---|---|---|
| `/api/auth/signup` | POST | No | Yes (20/min/IP) | Validates username and password (6–128 chars). Rejects `guest_` prefix. Hashes password, inserts user into Postgres with random UUID. Returns `{ ok: true, data: { token, user } }`. |
| `/api/auth/login` | POST | No | Yes (20/min/IP) | Looks up `password_hash` via `WHERE lower(username) = lower($1) AND NOT is_guest`. Validates via `verifyPassword`. Returns token and user profile. |
| `/api/auth/guest` | POST | No | Yes (20/min/IP) | Loops up to 5 times generating `Guest_<random6digit>` with `password_hash = null` and `is_guest = true`. Returns token and user profile. |
| `/api/me` | GET | Yes (`Bearer`) | No | Reads `Authorization: Bearer <token>`, verifies signature and expiration, retrieves user from database via `repo.findUserById(userId)`. Returns 401 if missing or invalid. |
| `/ws?token=<token>` | GET (Upgrade) | Yes (Query Param) | Per socket (12 msg/s) | Intercepts HTTP upgrade. Rejects with `401 Unauthorized` before socket upgrade if token invalid or user not in DB. |

### 2.5 Complete End-to-End Authentication Flow

```
[Browser]                                          [Node Server]                                    [Postgres DB]
   |                                                     |                                                |
   |-- POST /api/auth/login { username, password } ----->|                                                |
   |                                                     |-- Check Rate Limit (Redis)                    |
   |                                                     |-- SELECT * FROM users WHERE lower(username)...|
   |                                                     |<-- Return password_hash ----------------------|
   |                                                     |-- scrypt verify password                       |
   |                                                     |-- issueToken(user.id) (HMAC-SHA256)           |
   |<-- 200 OK { token, user } --------------------------|                                                |
   |                                                     |                                                |
   |-- Save to localStorage('gambit.token')              |                                                |
   |-- Update React AuthContext (user, token)            |                                                |
   |                                                     |                                                |
   |-- Connect WSS /ws?token=<token> ------------------->|                                                |
   |                                                     |-- verifyToken(token)                           |
   |                                                     |-- SELECT * FROM users WHERE id = ... -------->|
   |                                                     |<-- User exists -------------------------------|
   |                                                     |-- wss.handleUpgrade()                          |
   |<-- 101 Switching Protocols -------------------------|                                                |
   |                                                     |-- GameManager.attach(ws, userId)              |
   |<-- { type: "hello", user, ... } --------------------|                                                |
```

---

## 3. Investigation of Key Architectural & Security Questions

### 1. Is user registration implemented?
**Yes.** Implemented in `backend1/src/http.ts:94-101`. Users specify username and password.

### 2. Is email/password authentication implemented?
**No.** Only username and password authentication is implemented. There is no email field in the schema or API.

### 3. Is Google OAuth implemented?
**No.** There is zero Google OAuth implementation on either backend or frontend.

### 4. Is GitHub OAuth implemented?
**No.** Not implemented.

### 5. Are login and logout endpoints functional?
- **Login:** Fully functional via `POST /api/auth/login`.
- **Logout:** **There is NO backend logout endpoint.** Logout is purely client-side via `tokenStore.clear()` in `frontend/src/context/AuthContext.tsx:34-38`.

### 6. Are sessions or JWTs being used?
A custom stateless signed token (`base64url(payload).signature`) is used. It functions as a lightweight JWT without standard headers.

### 7. Where are authentication tokens stored?
Stored in browser `localStorage` under key `gambit.token`.

### 8. How are tokens refreshed and invalidated?
- **Refresh:** Not implemented. The token has a hard 30-day expiration.
- **Invalidation:** Not implemented. Because tokens are stateless and unrecorded in Redis or Postgres, they cannot be revoked before the 30-day expiration unless the global `AUTH_SECRET` is changed.

### 9. Are protected routes actually protected?
- `GET /api/me` is protected by `authUser()` which checks the `Authorization: Bearer <token>` header.
- The WebSocket endpoint `/ws` is protected during HTTP upgrade: connections without a valid token and existing user in the database are destroyed with a 401 response.
- Game actions (moves, resignations, draw offers, chat) verify that the authenticated socket identity matches the active player.

### 10. Does the backend verify the identity of every authenticated request?
**Yes.** HTTP `/api/me` checks `repo.findUserById(userId)` on every call. WebSockets authenticate upon handshake and tie the connection permanently to that `userId`.

### 11. Is there a user table or equivalent identity model?
**Yes.** Postgres table `users` with `id`, `username`, `password_hash`, `is_guest`, `rating`, `games`, `wins`, `losses`, `draws`, `created_at`.

### 12. How are user profiles associated with games, matches, ratings, and statistics?
`games` table has foreign keys `white_id REFERENCES users(id)` and `black_id REFERENCES users(id)`. When a rated game finishes, an atomic transaction updates player ratings and insert game records into `games`.

### 13. Is there a guest-user or anonymous-player mechanism?
**Yes.** `POST /api/auth/guest` generates a `Guest_<digits>` user with `password_hash = null` and `is_guest = true`. Guests can play rated games and have stats tracked, but are excluded from the public leaderboard.

### 14. Can a user access another user's private game data?
Games are public records in Gambit; anyone can view archived games via `/api/games/:id`. However, users cannot act on another user's live game.

### 15. Are authentication errors handled correctly?
Yes: 400 for bad payloads, 401 for invalid credentials/tokens, 409 for duplicate usernames, 429 for rate limit exceeded.

---

## 4. Evaluation: Retain & Extend vs. Refactor vs. Dedicated Provider

The user requires **Google authentication as the primary sign-in method**, with automatic account creation, session management, logout, and profile support.

### Option Comparison Matrix

| Evaluation Dimension | Option A: Retain & Extend Existing Stack (Custom OAuth Flow) | Option B: Refactor with Lightweight Auth Library (e.g. `@auth/core` / Lucia) | Option C: Managed Identity Provider (Clerk, Supabase Auth, Auth0) |
|---|---|---|---|
| **Security** | **High** if state CSRF and PKCE/nonce are correctly implemented; requires careful token revocation. | **High**; standard OAuth2/OIDC primitives maintained by open-source libraries. | **Very High**; fully managed MFA, session rotation, bot detection, Google compliance. |
| **Architectural Fit** | **Optimal**; fits existing Node.js HTTP/ws setup without framework bloat or rewrite. | **Moderate**; requires adapting NextAuth/AuthCore handlers into Node's raw `http.IncomingMessage`. | **Poor to Moderate**; introduces external network dependencies, webhook synchronization, and vendor lock-in. |
| **Cost** | **$0** (Free forever; direct Google API usage). | **$0** (Free forever). | **Paid tiers** after modest active user thresholds (e.g. Clerk $25-$99+/mo; Auth0 expensive). |
| **Implementation Complexity** | **Low to Moderate** (~150 lines of clean code in `backend1/src/auth.ts` and `http.ts`). | **Moderate** (library glue code and version churn). | **Moderate to High** (syncing external user IDs with Postgres `users` table and Redis). |
| **Maintainability** | **High**; zero external dependencies; full control over database and tokens. | **Moderate**; depends on ecosystem library updates. | **Low**; ongoing webhook maintenance and data synchronization issues. |

### Architectural Recommendation
**Recommendation: Option A (Retain & Extend with Native Google OAuth 2.0 / OpenID Connect).**

**Rationale:**
1. Gambit's backend is intentionally lightweight and high-performance, using native Node HTTP without Express or bulky frameworks.
2. Directly integrating Google's standard OAuth2 `token` and `userinfo` endpoints requires only standard Node `fetch` calls and `crypto` routines.
3. Keeping user identities directly in the Postgres `users` table prevents dual-source-of-truth headaches when calculating Elo ratings and linking game records.
4. Total operational cost remains $0.

---

## 5. Specification for Google OAuth Integration

### 5.1 Required Database Migration
Execute the following non-breaking schema additions to `users`:
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_google_id ON users (google_id) WHERE google_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users (lower(email)) WHERE email IS NOT NULL;
```

### 5.2 Required Environment Variables
Add to `backend1/.env` and Railway production variables:
```bash
# Google OAuth 2.0 Credentials
GOOGLE_CLIENT_ID=xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxxxxxx
GOOGLE_REDIRECT_URI=https://gambit-server-production.up.railway.app/api/auth/google/callback

# Frontend Redirect Target
FRONTEND_URL=https://gambit-mocha.vercel.app
```

Add to `frontend/.env` and Vercel environment variables:
```bash
VITE_GOOGLE_CLIENT_ID=xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com
```

### 5.3 Google Cloud Console Configuration
1. **Create OAuth 2.0 Client ID:**
   - Application Type: *Web application*.
   - Name: `Gambit Chess`.
2. **Authorized JavaScript Origins:**
   - `http://localhost:5173` (Frontend local dev)
   - `http://localhost:8080` (Direct local server)
   - `https://gambit-mocha.vercel.app` (Production frontend)
3. **Authorized Redirect URIs:**
   - `http://localhost:8080/api/auth/google/callback` (Local backend)
   - `https://gambit-server-production.up.railway.app/api/auth/google/callback` (Production backend)
4. **OAuth Consent Screen:**
   - User Type: *External*.
   - App Name: `Gambit Chess`.
   - Scopes: `openid`, `https://www.googleapis.com/auth/userinfo.email`, `https://www.googleapis.com/auth/userinfo.profile`.

### 5.4 Complete Google OAuth Execution Flow
1. **Frontend Trigger:**
   - The user clicks **"Continue with Google"** on `/login` or `/signup`.
   - The frontend redirects to `GET /api/auth/google`.
2. **Backend Auth URL Generation:**
   - Server creates a cryptographically secure random `state` token: `randomBytes(24).toString("hex")`.
   - Stores `state` in Redis with a 10-minute TTL: `SET gambit:oauth:state:<state> 1 EX 600`.
   - Redirects (302) to Google's OAuth endpoint:
     `https://accounts.google.com/o/oauth2/v2/auth?client_id=...&redirect_uri=...&response_type=code&scope=openid%20email%20profile&state=<state>`
3. **Google Callback (`GET /api/auth/google/callback`):**
   - Google returns `code` and `state`.
   - Backend checks and deletes `state` from Redis (`GETDEL`). Rejects if missing (prevents CSRF).
   - Backend exchanges `code` with Google for tokens via `POST https://oauth2.googleapis.com/token`.
   - Fetches profile via `GET https://www.googleapis.com/oauth2/v3/userinfo`:
     Extracts `sub` (Google ID), `email`, `name`, and `picture`.
4. **Account Linking & User Provisioning:**
   - If user exists with `google_id = sub`: Authenticate user.
   - Else if user exists with `lower(email) = lower(google_email)`: Link account (`UPDATE users SET google_id = $1 WHERE email = $2`).
   - Else (New User): Generate unique username from Google name/email, insert new user into Postgres (`is_guest = false`, starting rating 1200).
5. **Session Completion:**
   - Backend issues standard Gambit token `issueToken(user.id)`.
   - Redirects user to frontend with token:
     `302 Location: https://gambit-mocha.vercel.app/auth/callback#token=<token>`
   - Frontend extracts token from URL hash, stores in `localStorage`, updates React state, and clears URL hash.
