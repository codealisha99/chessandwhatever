import { createHash, randomBytes } from "node:crypto";
import * as jose from "jose";
import { config } from "./config.ts";
import { redis, K } from "./redis.ts";
import { log } from "./logger.ts";

export interface GoogleProfile {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

interface StoredState {
  nonce: string;
  redirectUri: string;
  createdAt: number;
}

export interface StoredExchangeData {
  token: string;
  userId: string;
}

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

let jwksCache: jose.JWTVerifyGetKey | null = null;
function getGoogleJwks(): jose.JWTVerifyGetKey {
  if (!jwksCache) {
    jwksCache = jose.createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  }
  return jwksCache;
}

/** Testing hook: override JWKS resolver in unit tests */
export function setMockJwks(mock: jose.JWTVerifyGetKey | null): void {
  jwksCache = mock;
}

let mockStateStore: Map<string, { value: string; expiresAt: number }> | null = null;
/** Testing hook: in-memory state store for tests when Redis is not running */
export function setMockStateStore(mock: Map<string, { value: string; expiresAt: number }> | null): void {
  mockStateStore = mock;
}

let mockExchangeStore: Map<string, { value: string; expiresAt: number }> | null = null;
/** Testing hook: in-memory exchange store for tests when Redis is not running */
export function setMockExchangeStore(mock: Map<string, { value: string; expiresAt: number }> | null): void {
  mockExchangeStore = mock;
}

/** One-way SHA-256 hash of single-use authorization exchange codes */
export function hashExchangeCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/**
 * Creates a cryptographically random, short-lived (60s) single-use exchange code.
 * Only the SHA-256 hash of the code is persisted server-side.
 */
export async function createOAuthExchangeCode(token: string, userId: string): Promise<string> {
  const rawCode = randomBytes(32).toString("base64url");
  const codeHash = hashExchangeCode(rawCode);
  const data: StoredExchangeData = { token, userId };
  const serialized = JSON.stringify(data);

  if (mockExchangeStore) {
    mockExchangeStore.set(codeHash, { value: serialized, expiresAt: Date.now() + 60_000 });
    return rawCode;
  }

  // 60 second single-use expiration in Redis
  await redis.set(K.oauthExchange(codeHash), serialized, "EX", 60);
  return rawCode;
}

/**
 * Atomically consumes and validates an authorization exchange code.
 * Ensures single-use redemption and guarantees replay protection.
 */
export async function redeemOAuthExchangeCode(rawCode: string): Promise<StoredExchangeData | null> {
  if (!rawCode || typeof rawCode !== "string") return null;
  const codeHash = hashExchangeCode(rawCode);

  if (mockExchangeStore) {
    const entry = mockExchangeStore.get(codeHash);
    if (!entry) return null;
    mockExchangeStore.delete(codeHash); // Atomic consumption
    if (Date.now() > entry.expiresAt) return null; // Expired
    try {
      return JSON.parse(entry.value) as StoredExchangeData;
    } catch {
      return null;
    }
  }

  const raw = await redis.getdel(K.oauthExchange(codeHash));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredExchangeData;
  } catch {
    return null;
  }
}

/** Generate cryptographically secure state and nonce for OAuth 2.0 / OIDC */
export async function createAuthorizationRequest(customRedirectUri?: string): Promise<{ url: string; state: string }> {
  if (!config.googleClientId) {
    throw new Error("GOOGLE_CLIENT_ID is not configured");
  }
  const redirectUri = customRedirectUri || config.googleRedirectUri;
  if (!redirectUri) {
    throw new Error("GOOGLE_REDIRECT_URI is not configured");
  }

  const state = randomBytes(24).toString("hex");
  const nonce = randomBytes(24).toString("hex");
  const stored: StoredState = { nonce, redirectUri, createdAt: Date.now() };

  if (mockStateStore) {
    mockStateStore.set(state, { value: JSON.stringify(stored), expiresAt: Date.now() + 600_000 });
  } else {
    // 10 minute expiration for login completion
    await redis.set(K.oauthState(state), JSON.stringify(stored), "PX", 600_000);
  }

  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    prompt: "select_account",
  });

  return { url: `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`, state };
}

/** Atomically validate OAuth state from Redis, preventing replay attacks */
export async function consumeOAuthState(state: string): Promise<StoredState | null> {
  if (!state) return null;

  if (mockStateStore) {
    const entry = mockStateStore.get(state);
    if (!entry) return null;
    mockStateStore.delete(state); // Atomic deletion
    if (Date.now() > entry.expiresAt) return null;
    try {
      return JSON.parse(entry.value) as StoredState;
    } catch {
      return null;
    }
  }

  const raw = await redis.getdel(K.oauthState(state));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredState;
  } catch {
    return null;
  }
}

/** Exchange authorization code for tokens and verify OpenID Connect ID token */
export async function exchangeAndVerifyCode(code: string, state: string, requestHost?: string): Promise<GoogleProfile> {
  const stored = await consumeOAuthState(state);
  if (!stored) {
    throw new Error("Invalid, replayed, or expired OAuth state");
  }

  if (!config.googleClientId || !config.googleClientSecret) {
    throw new Error("Google OAuth credentials are not configured on this server");
  }

  let tokenRes: Response;
  try {
    tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        redirect_uri: stored.redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });
  } catch (err) {
    log.error("Google token exchange network failure", err);
    throw new Error("Unable to contact Google authentication service");
  }

  if (!tokenRes.ok) {
    const errorBody = await tokenRes.text().catch(() => "");
    log.warn("Google token exchange rejected code", { status: tokenRes.status, body: errorBody });
    throw new Error("Google rejected the authorization code");
  }

  const tokenData = (await tokenRes.json()) as { id_token?: string; access_token?: string };
  if (!tokenData.id_token) {
    throw new Error("Google response did not include an ID token");
  }

  return verifyGoogleIdToken(tokenData.id_token, stored.nonce);
}

/** Verifies Google ID token signature, issuer, audience, expiration, and nonce using jose */
export async function verifyGoogleIdToken(idToken: string, expectedNonce?: string): Promise<GoogleProfile> {
  const JWKS = getGoogleJwks();
  const { payload } = await jose.jwtVerify(idToken, JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: config.googleClientId,
  });

  if (expectedNonce && payload.nonce !== expectedNonce) {
    throw new Error("Nonce mismatch in Google ID token");
  }

  const sub = payload.sub;
  if (!sub || typeof sub !== "string") {
    throw new Error("Missing subject claim in ID token");
  }

  if (payload.email && payload.email_verified === false) {
    throw new Error("Google email is not verified");
  }

  return {
    sub,
    email: typeof payload.email === "string" ? payload.email : null,
    emailVerified: Boolean(payload.email_verified),

    name: typeof payload.name === "string" ? payload.name : undefined,
    picture: typeof payload.picture === "string" ? payload.picture : undefined,
  };
}
