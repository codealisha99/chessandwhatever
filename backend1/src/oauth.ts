import { randomBytes } from "node:crypto";
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

  // 10 minute expiration for login completion
  await redis.set(K.oauthState(state), JSON.stringify(stored), "PX", 600_000);

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
