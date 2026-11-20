# Gambit: Recommended Engineering Roadmap

**Author:** Technical Auditor & Senior Software Architect  
**Date:** November 2026  
**Repository:** `chessandwhatever` (Gambit)  

---

## 1. Roadmap Prioritization Framework

Tasks are ranked according to immediate production blockers, security imperatives, user authentication requirements, and product maturity:
- **P0 (Critical Pre-Launch):** Immediate security remediations, Google OAuth integration, token revocation, and production database configuration.
- **P1 (High Priority / Launch Enhancement):** Matchmaking rating windowing, session management UI, ticketed WebSockets, guest account lifecycle cleanup.
- **P2 (Medium Priority / Product Growth):** Puzzles, opening explorer, friends list, social features, and premove support.

```
+-----------------------------------------------------------------------------------+
|  PHASE 1 (P0): Security Hardening & Google OAuth Authentication                   |
|  - Google OAuth 2.0 / OIDC Flow (Backend + Frontend)                             |
|  - SEC-01: WebSocket Ticket-Based Handshake (eliminate token in query param)       |
|  - SEC-02: Token Revocation / Versioning                                          |
|  - Database Schema Migration (google_id, email, avatar_url, token_version)        |
+-----------------------------------------------------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|  PHASE 2 (P1): Production Reliability, Account Settings & Matchmaking             |
|  - Elo-Windowed Matchmaking (prevent large rating disparities)                    |
|  - Account Settings & Profile Management UI (Logout, change username, avatar)    |
|  - Guest Account Vacuum Background Job                                            |
|  - Redis HyperLogLog for Presence Scaling                                         |
+-----------------------------------------------------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|  PHASE 3 (P2): Advanced Chess Features & Community Growth                        |
|  - Premoves Support (Queue move while opponent is thinking)                       |
|  - Friends List & In-App Challenges                                               |
|  - Opening Database Explorer                                                      |
|  - Tactical Chess Puzzles with Elo Ratings                                        |
+-----------------------------------------------------------------------------------+
```

---

## 2. Priority 0: Critical Pre-Launch Milestones

### Task 1.1: Google OAuth 2.0 & OpenID Connect Implementation
- **Priority:** **P0**
- **Estimated Complexity:** Medium (3–4 engineering days)
- **Dependencies:** None
- **Affected Components:**
  - `backend1/src/db.ts`: Add `google_id`, `email`, `avatar_url` columns to `users` table.
  - `backend1/src/auth.ts`: Add OAuth state generation, token exchange, and Google userinfo fetchers.
  - `backend1/src/http.ts`: Implement `GET /api/auth/google` and `GET /api/auth/google/callback`.
  - `frontend/src/pages/Auth.tsx`: Add "Continue with Google" button with Google logo.
  - `frontend/src/context/AuthContext.tsx`: Handle callback token receipt and session initialization.
- **Acceptance Criteria:**
  1. Clicking "Continue with Google" redirects to Google's consent screen.
  2. First-time Google users automatically receive a registered account in Postgres with default 1200 rating.
  3. Existing users with matching email or Google ID are securely logged into their existing profile.
  4. Authentication error states (consent cancellation, state mismatch) display user-friendly notices without server crashes.

---

### Task 1.2: SEC-01 WebSocket Ticket Exchange Handshake
- **Priority:** **P0**
- **Estimated Complexity:** Low (1 engineering day)
- **Dependencies:** None
- **Affected Components:**
  - `backend1/src/http.ts`: Add `POST /api/auth/ticket` endpoint (generates 16-byte random ticket in Redis, TTL 15s).
  - `backend1/src/index.ts`: On HTTP upgrade, read `?ticket=<ticket>`, validate and consume ticket via Redis `GETDEL`.
  - `frontend/src/lib/api.ts`: Fetch ticket via Bearer token before establishing WebSocket connection.
- **Acceptance Criteria:**
  1. No long-lived authentication token is visible in WebSocket request URLs or server access logs.
  2. Replaying an intercepted WebSocket ticket fails immediately.

---

### Task 1.3: SEC-02 Token Invalidation and Backend Logout
- **Priority:** **P0**
- **Estimated Complexity:** Low (1 engineering day)
- **Dependencies:** None
- **Affected Components:**
  - `backend1/src/db.ts`: Add `token_version` column to `users`.
  - `backend1/src/auth.ts`: Embed `v: token_version` into token payload.
  - `backend1/src/http.ts`: Add `POST /api/auth/logout` endpoint that increments `token_version` or revokes session in Redis.
- **Acceptance Criteria:**
  1. Calling logout immediately terminates active WebSocket connections for that user.
  2. Previously issued tokens return `401 Unauthorized` on all subsequent HTTP and WebSocket upgrade requests.

---

## 3. Priority 1: High Priority / Launch Enhancements

### Task 2.1: Elo-Windowed Matchmaking
- **Priority:** **P1**
- **Estimated Complexity:** Medium (2–3 engineering days)
- **Dependencies:** None
- **Affected Components:**
  - `backend1/src/redis.ts`: Replace simple list FIFO with Redis sorted set `ZSET` scored by rating or multi-tier queue.
  - `backend1/src/GameManager.ts`: Dynamically expand search window ($\pm 100 \to \pm 250 \to \pm 500$) every 5 seconds of queue wait time.
- **Acceptance Criteria:**
  1. High-rated players (e.g. 2000+) are not paired with novices (e.g. 800) during standard queue traffic.
  2. Waiting players expand their search window gracefully over time to ensure games start within reasonable wait limits (<45s).

---

### Task 2.2: User Account Profile & Settings Management
- **Priority:** **P1**
- **Estimated Complexity:** Low-Medium (2 engineering days)
- **Dependencies:** Task 1.1
- **Affected Components:**
  - `backend1/src/http.ts`: Add `PATCH /api/me` (change username, update avatar, link accounts).
  - `frontend/src/pages/Profile.tsx`: Add edit profile modal for authenticated user viewing their own profile.
- **Acceptance Criteria:**
  1. Users can update their display name (within uniqueness constraints) and view linked Google details.
  2. Full account deletion endpoint compliant with privacy regulations (`DELETE /api/me`).

---

### Task 2.3: Guest Account Cleanup Background Job
- **Priority:** **P1**
- **Estimated Complexity:** Low (0.5 engineering day)
- **Dependencies:** None
- **Affected Components:**
  - `backend1/src/db.ts`: Add `purgeInactiveGuests()` method.
  - `backend1/src/index.ts`: Trigger scheduled nightly cleanup.
- **Acceptance Criteria:**
  1. Guest users older than 7 days with zero played games are deleted from Postgres.
  2. No active or referenced players in `games` are affected by the purge.

---

## 4. Priority 2: Medium Priority / Product Expansion

### Task 3.1: Premoves Implementation
- **Priority:** **P2**
- **Estimated Complexity:** Medium-High (4 engineering days)
- **Dependencies:** None
- **Affected Components:**
  - `frontend/src/components/Board.tsx`: Allow queueing a target move while `movable === null` but `you` is active.
  - `frontend/src/context/OnlineContext.tsx`: Auto-dispatch queued move within 5ms of receiving opponent's move.

---

### Task 3.2: Friends List & Social Graph
- **Priority:** **P2**
- **Estimated Complexity:** Medium (3 engineering days)
- **Dependencies:** Task 1.1
- **Affected Components:**
  - `backend1/src/db.ts`: Create `friends` table (`user_id`, `friend_id`, `status`).
  - `backend1/src/http.ts`: Friend request and listing endpoints.
  - `frontend/src/pages/Home.tsx`: Display online friends with one-click direct challenge buttons.

---

### Task 3.3: Opening Database & Master Game Explorer
- **Priority:** **P2**
- **Estimated Complexity:** Medium (3 engineering days)
- **Dependencies:** None
- **Affected Components:**
  - `frontend/src/pages/Analysis.tsx`: Integrate Lichess Open Database API or bundled compact Polyglot opening tree.
  - Render ECO code, opening variation name, and win rate distributions directly below the move list.
