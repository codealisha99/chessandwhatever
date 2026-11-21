# Environment Variables & Secrets Reference: Cloudflare Deployment

**Project:** Gambit (`chessandwhatever`)  
**Target Environment:** Cloudflare Worker Edge Gateway + Cloudflare Container Backend  
**Security Status:** Production Hardened  

---

## 1. Overview

This document provides a single-source-of-truth reference for all configuration variables and cryptographic secrets required to run Gambit on Cloudflare.

Never commit raw secrets, tokens, or production database credentials to version control. All secrets must be injected via the Cloudflare Dashboard or Wrangler CLI.

---

## 2. Cloudflare Worker Edge Gateway (`wrangler.jsonc`)

These variables govern the Anycast Edge Gateway Worker (`worker/index.ts`).

| Variable Name | Type | Sensitivity | Default / Production Value | Description |
| :--- | :--- | :--- | :--- | :--- |
| `ENVIRONMENT` | Plaintext | Low | `production` | Deployment environment identifier (`production`, `staging`). |
| `BACKEND_ORIGIN` | Secret / Var | Medium | `https://backend-container.internal` | The upstream URL of the containerized Node.js backend. Set via `wrangler secret put BACKEND_ORIGIN` or dashboard. |
| `ALLOWED_ORIGINS` | Plaintext | Low | `https://gambitchess.vercel.app,http://localhost:5173` | Comma-separated browser origins authorized for CORS preflight and requests. |
| `HYPERDRIVE` | Binding | High | `id: "<HYPERDRIVE_ID>"` | Cloudflare Hyperdrive binding accelerating Neon PostgreSQL queries. |

---

## 3. Backend Container Runtime (`backend1/Dockerfile`)

These variables are consumed by the Node.js process running inside the Cloudflare Container.

### 3.1 Core System & Networking
| Variable Name | Type | Sensitivity | Default / Example Value | Description |
| :--- | :--- | :--- | :--- | :--- |
| `PORT` | Plaintext | Low | `8080` | Port on which the Node.js HTTP/WebSocket server listens. |
| `NODE_ENV` | Plaintext | Low | `production` | Enables production optimizations in Node.js and dependencies. |
| `TRUST_PROXY` | Plaintext | Low | `1` | Instructs the server to trust upstream proxy headers (`CF-Connecting-IP`, `X-Forwarded-For`). |
| `CORS_ORIGINS` | Plaintext | Low | `https://gambitchess.vercel.app` | Comma-separated browser origins allowed by backend CORS middleware. |
| `FRONTEND_URL` | Plaintext | Low | `https://gambitchess.vercel.app` | Public canonical URL of the frontend SPA, used in OAuth redirects and emails. |

### 3.2 Persistent Database (Neon PostgreSQL)
| Variable Name | Type | Sensitivity | Default / Example Value | Description |
| :--- | :--- | :--- | :--- | :--- |
| `DATABASE_URL` | Secret | **High (P0)** | `postgres://user:pass@ep-xyz.us-east-2.aws.neon.tech/neondb?sslmode=require` | Connection URI for Neon PostgreSQL. In production, use the pooled endpoint or Hyperdrive URI. |

### 3.3 Redis 7 (Upstash / Redis Cloud)
| Variable Name | Type | Sensitivity | Default / Example Value | Description |
| :--- | :--- | :--- | :--- | :--- |
| `REDIS_URL` | Secret | **High (P0)** | `rediss://default:pass@xxxx.upstash.io:6379` | TLS-encrypted Redis connection URI. Note the `rediss://` scheme. |
| `REDIS_PREFIX` | Plaintext | Low | `gambit:prod:` | Namespace prepended to all Redis keys and pub/sub channels. |
| `LEASE_MS` | Plaintext | Low | `15000` | Lease duration (ms) for distributed turn clock ownership. |
| `HEARTBEAT_MS` | Plaintext | Low | `5000` | Lease renewal interval (ms) for active game clocks. |

### 3.4 Authentication & Identity
| Variable Name | Type | Sensitivity | Default / Example Value | Description |
| :--- | :--- | :--- | :--- | :--- |
| `AUTH_SECRET` | Secret | **High (P0)** | `64-character hex string` | Cryptographic secret for signing session JWTs and state nonces. Generate with `openssl rand -hex 32`. |
| `GOOGLE_CLIENT_ID` | Secret / Var | Medium | `xxxx.apps.googleusercontent.com` | Google Cloud OAuth 2.0 Web Client ID. |
| `GOOGLE_CLIENT_SECRET`| Secret | **High (P0)** | `GOCSPX-xxxx` | Google Cloud OAuth 2.0 Web Client Secret. |
| `GOOGLE_REDIRECT_URI` | Plaintext | Medium | `https://api.yourdomain.com/api/auth/google/callback` | Authorized redirect URI configured in Google Cloud Console. |
| `GUEST_RETENTION_DAYS`| Plaintext | Low | `7` | Retention window (days) before inactive zero-game guests are purged. |

### 3.5 Email & Communications
| Variable Name | Type | Sensitivity | Default / Example Value | Description |
| :--- | :--- | :--- | :--- | :--- |
| `EMAIL_PROVIDER` | Plaintext | Low | `resend` (or `development`) | Active transactional email driver. Options: `development`, `resend`, `smtp`. |
| `RESEND_API_KEY` | Secret | **High (P0)** | `re_xxxx` | API key from Resend.com for sending password reset emails. |

---

## 4. Vercel Frontend Configuration (`frontend/`)

When deploying the frontend to Vercel, configure these environment variables to point to the new Cloudflare backend:

| Variable Name | Production Value | Description |
| :--- | :--- | :--- |
| `VITE_API_URL` | `https://api.yourdomain.com` (Cloudflare Worker Edge URL) | Base HTTP URL for all REST API endpoints. |
| `VITE_WS_URL` | `wss://api.yourdomain.com/ws` | Base WebSocket URL for real-time game play and chat. |

---

## 5. Secret Provisioning & Management via Cloudflare CLI

To securely inject secrets into your Cloudflare Worker without exposing them in files:

```bash
# 1. Set backend target container origin
npx wrangler secret put BACKEND_ORIGIN

# 2. Set database connection string (if not using Hyperdrive binding directly)
npx wrangler secret put DATABASE_URL

# 3. Set Redis connection string
npx wrangler secret put REDIS_URL

# 4. Set authentication signing secret
npx wrangler secret put AUTH_SECRET

# 5. Set Google OAuth credentials
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET

# 6. Set Email credentials
npx wrangler secret put RESEND_API_KEY
```

---

## 6. Secret Rotation Guidelines

1. **`AUTH_SECRET` Rotation:**
   - Rotating `AUTH_SECRET` immediately invalidates all existing active user sessions, requiring players to log in again.
   - Recommended schedule: Once per year or immediately upon key leakage.
2. **`DATABASE_URL` Rotation:**
   - Neon allows creating new roles and connection passwords without downtime. Create the new credential, update `DATABASE_URL` in Cloudflare secrets, and retire the old role after all containers restart.
3. **`REDIS_URL` Rotation:**
   - Upstash provides dual-key rotation (`read-only` and `default`). Add the secondary password, update Cloudflare, and delete the legacy password.
