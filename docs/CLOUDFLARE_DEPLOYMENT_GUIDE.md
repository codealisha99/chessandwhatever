# Cloudflare Deployment Guide: Step-by-Step Production Setup

**Project:** Gambit (`chessandwhatever`)  
**Target:** Cloudflare Worker Edge Gateway + Cloudflare Container Backend  
**Deployment Mode:** Manual Execution (Dashboard & CLI)  

---

## 1. Prerequisites Checklist

Before beginning deployment, ensure you have:
- [ ] A Cloudflare account with an active domain on Cloudflare DNS.
- [ ] Node.js 24 installed locally.
- [ ] Wrangler CLI installed (`npm install -g wrangler` or via `npx wrangler`).
- [ ] An active Neon PostgreSQL database instance (`https://neon.tech`).
- [ ] An active Upstash Redis or managed Redis 7 instance (`https://upstash.com`).
- [ ] Google Cloud Console project configured for OAuth 2.0.
- [ ] Resend.com account for transactional emails (optional for production password reset).

---

## 2. Step 1: Provision External Managed Redis (Upstash)

1. Log in to [Upstash Console](https://console.upstash.com/).
2. Click **Create Database**.
   - **Name:** `gambit-redis`
   - **Type:** Regional (or Global)
   - **Primary Region:** Select the region closest to your Neon PostgreSQL instance (e.g., `us-east-1`).
   - **Eviction:** Disabled / volatile-lru.
3. Once created, navigate to **Details** > **Connect to your database** > **Node.js (ioredis)**.
4. Copy the connection string beginning with `rediss://...`. Note the double `s` indicating TLS encryption.

---

## 3. Step 2: Configure Cloudflare Hyperdrive (PostgreSQL Accelerator)

1. Log in to Wrangler CLI in your terminal:
   ```bash
   npx wrangler login
   ```
2. Create a Hyperdrive configuration pointing to your Neon database:
   ```bash
   npx wrangler hyperdrive create gambit-pg \
     --connection-string="postgres://<USER>:<PASSWORD>@<NEON_HOST>/neondb?sslmode=require"
   ```
3. Copy the returned `Hyperdrive ID` (e.g., `f5b4a92c0d8e411ea2b3c4d5e6f7a8b9`).
4. Open `wrangler.jsonc` and bind your Hyperdrive ID:
   ```jsonc
   "hyperdrive": [
     {
       "binding": "HYPERDRIVE",
       "id": "f5b4a92c0d8e411ea2b3c4d5e6f7a8b9"
     }
   ]
   ```

---

## 4. Step 3: Deploy the Backend Container

The backend container runs `backend1/Dockerfile` (`node:24-alpine`).

### Option A: Cloudflare Containers (Dashboard / CLI)
1. In Cloudflare Dashboard, navigate to **Compute** > **Containers**.
2. Click **Create Container Application** and select your GitHub repository `codealisha99/chessandwhatever`.
3. Set **Docker Context Directory:** `backend1/`
4. Set **Dockerfile Path:** `backend1/Dockerfile`
5. Configure Environment Variables in the Container Settings:
   - `PORT`: `8080`
   - `NODE_ENV`: `production`
   - `TRUST_PROXY`: `1`
   - `DATABASE_URL`: Your Neon PostgreSQL connection string.
   - `REDIS_URL`: Your Upstash Redis TLS connection string (`rediss://...`).
   - `AUTH_SECRET`: Generate a secure 64-hex key: `openssl rand -hex 32`.
   - `CORS_ORIGINS`: `https://gambitchess.vercel.app`
   - `FRONTEND_URL`: `https://gambitchess.vercel.app`
   - `GOOGLE_CLIENT_ID`: Google OAuth Client ID.
   - `GOOGLE_CLIENT_SECRET`: Google OAuth Client Secret.
   - `GOOGLE_REDIRECT_URI`: `https://api.yourdomain.com/api/auth/google/callback`
   - `EMAIL_PROVIDER`: `resend` (or `development`)
   - `RESEND_API_KEY`: Your Resend API key.
6. Deploy the container and record its internal hostname / origin (e.g., `https://backend-container.internal`).

---

## 5. Step 4: Configure and Deploy Cloudflare Worker Edge Gateway

1. Open `wrangler.jsonc` in the project root.
2. Confirm the `BACKEND_ORIGIN` matches your container's upstream address.
3. Verify the Worker locally before deployment:
   ```bash
   npx wrangler dev
   ```
4. Deploy the Worker to Cloudflare's Global Network:
   ```bash
   npx wrangler deploy
   ```
5. Set sensitive secrets on the Worker:
   ```bash
   npx wrangler secret put BACKEND_ORIGIN
   ```

---

## 6. Step 5: Configure Custom Domain & SSL Routing

1. In the Cloudflare Dashboard, go to your domain (e.g., `gambitchess.com`).
2. Navigate to **Workers & Pages** > Select `gambit-backend`.
3. Click **Settings** > **Domains & Routes** > **Add Custom Domain**.
4. Enter your backend subdomain: `api.gambitchess.com`.
5. Cloudflare will automatically provision a global SSL/TLS certificate and configure Anycast DNS routing.

---

## 7. Step 6: Update Vercel Frontend Environment Variables

Once `api.gambitchess.com` is live:
1. Log in to [Vercel Dashboard](https://vercel.com/) and navigate to your `gambitchess` project.
2. Go to **Settings** > **Environment Variables**.
3. Update the production values:
   - `VITE_API_URL`: `https://api.gambitchess.com`
   - `VITE_WS_URL`: `wss://api.gambitchess.com/ws`
4. Trigger a fresh deployment in Vercel to rebuild the Vite bundle with the new URLs.

---

## 8. Step 7: Post-Deployment Verification Checklist

Execute these checks to verify end-to-end operational readiness:

### 8.1 Edge & Container Health
```bash
curl -I https://api.gambitchess.com/health
# Expected: 200 OK, Content-Type: application/json, "service": "gambit-cloudflare-edge"

curl -I https://api.gambitchess.com/api/health
# Expected: 200 OK (from backend container)
```

### 8.2 CORS Preflight Verification
```bash
curl -X OPTIONS https://api.gambitchess.com/api/auth/me \
  -H "Origin: https://gambitchess.vercel.app" \
  -H "Access-Control-Request-Method: GET" \
  -I
# Expected: 204 No Content, Access-Control-Allow-Origin: https://gambitchess.vercel.app
```

### 8.3 WebSocket Handshake Verification
Test connecting with `wscat`:
```bash
npx wscat -c "wss://api.gambitchess.com/ws"
# Expected: Connection established, receives connected event or ping frame
```

### 8.4 Functional Game Test
1. Open `https://gambitchess.vercel.app` in two separate browser profiles.
2. Log in or create guest accounts.
3. Start a 5+3 matchmaking or private invitation game.
4. Verify moves sync instantaneously, chess clocks count down accurately, and in-game chat delivers in real-time.
