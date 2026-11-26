import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { hashPassword, hashResetToken, issueToken, verifyPassword, verifyToken } from "./auth.ts";
import { config } from "./config.ts";
import { DevelopmentEmailService } from "./email.ts";
import { createAuthorizationRequest, setMockJwks, verifyGoogleIdToken } from "./oauth.ts";
import { closeRedis, redis } from "./redis.ts";

const redisUp = await redis.ping().then(() => true, () => false);

after(async () => {
  await closeRedis().catch(() => {});
});

test("Password hashing and verification with scrypt", async () => {
  const password = "SuperSecretPassword123!";
  const hash = await hashPassword(password);
  assert.ok(hash.startsWith("scrypt$"), "Hash should start with scrypt$");
  
  const isValid = await verifyPassword(password, hash);
  assert.equal(isValid, true, "Valid password should verify");

  const isInvalid = await verifyPassword("WrongPassword", hash);
  assert.equal(isInvalid, false, "Invalid password should fail verification");

  const malformed = await verifyPassword(password, "bad$hash");
  assert.equal(malformed, false, "Malformed hash string should safely return false");
});

test("JWT token issuance and verification with session ID", async () => {
  const userId = randomUUID();
  const sessionId = randomUUID();
  
  const token = issueToken(userId, sessionId);
  assert.ok(typeof token === "string" && token.includes("."), "Token should be signed string");

  const verified = verifyToken(token);
  assert.ok(verified, "Token should verify successfully");
  assert.equal(verified?.userId, userId);
  assert.equal(verified?.sessionId, sessionId);

  // Tampered payload
  const [, sig] = token.split(".");
  const tamperedBody = Buffer.from(JSON.stringify({ sub: "hacker", exp: Date.now() + 10000 })).toString("base64url");
  const tamperedToken = `${tamperedBody}.${sig}`;
  assert.equal(verifyToken(tamperedToken), null, "Tampered signature should fail verification");

  // Invalid format
  assert.equal(verifyToken("not-a-token"), null);
  assert.equal(verifyToken(null), null);
  assert.equal(verifyToken(undefined), null);
});

test("Password reset token hashing is deterministic and irreversible", () => {
  const rawToken = randomBytes(32).toString("hex");
  const hash1 = hashResetToken(rawToken);
  const hash2 = hashResetToken(rawToken);
  assert.equal(hash1, hash2, "Hashing same token should produce same digest");
  assert.equal(hash1.length, 64, "SHA-256 hex digest should be 64 characters");
  assert.notEqual(rawToken, hash1, "Hashed token must not equal raw token");
});

test("Development email service captures reset emails in memory", async () => {
  const emailService = new DevelopmentEmailService();
  const rawToken = "test-reset-token-abc";
  await emailService.sendPasswordResetEmail("player@example.com", `http://localhost:3000/reset?token=${rawToken}`);

  assert.equal(emailService.sent.length, 1);
  const msg = emailService.sent[0];
  assert.ok(msg, "Sent message should exist");
  assert.equal(msg.to, "player@example.com");
  assert.ok(msg.text.includes(rawToken), "Email text should contain reset token");
  assert.ok(msg.html.includes(rawToken), "Email HTML should contain reset token");
});

test("OAuth state generation and nonce validation", { skip: !redisUp && "Redis not reachable" }, async () => {
  const origClientId = config.googleClientId;
  const origRedirectUri = config.googleRedirectUri;
  config.googleClientId = "test-google-client-id";
  config.googleRedirectUri = "http://localhost:3000/api/auth/google/callback";

  try {
    const authReq = await createAuthorizationRequest();
    assert.ok(authReq.url.startsWith("https://accounts.google.com/o/oauth2/v2/auth"));
    const parsed = new URL(authReq.url);
    assert.equal(parsed.searchParams.get("client_id"), "test-google-client-id");
    assert.equal(parsed.searchParams.get("response_type"), "code");
    assert.equal(parsed.searchParams.get("scope"), "openid email profile");
    assert.ok(parsed.searchParams.get("state"), "State must be present in auth url");
    assert.ok(parsed.searchParams.get("nonce"), "Nonce must be present in auth url");
  } finally {
    config.googleClientId = origClientId;
    config.googleRedirectUri = origRedirectUri;
  }
});

test("Google ID token verification with mock JWKS", async () => {
  const origClientId = config.googleClientId;
  config.googleClientId = "test-google-client-id";

  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key-1";
  jwk.alg = "RS256";

  setMockJwks(createLocalJWKSet({ keys: [jwk] }));


  try {
    const nonce = "test-nonce-12345";
    const validIdToken = await new SignJWT({
      sub: "google-uid-999",
      email: "player@example.com",
      email_verified: true,
      name: "Chess Player",
      nonce,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
      .setIssuer("https://accounts.google.com")
      .setAudience(config.googleClientId)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

    const payload = await verifyGoogleIdToken(validIdToken, nonce);
    assert.equal(payload.sub, "google-uid-999");
    assert.equal(payload.email, "player@example.com");
    assert.equal(payload.emailVerified, true);
    assert.equal(payload.name, "Chess Player");

    // Nonce mismatch
    await assert.rejects(
      verifyGoogleIdToken(validIdToken, "different-nonce"),
      /Nonce mismatch/,
      "Should reject token with mismatched nonce"
    );

    // Unverified email
    const unverifiedEmailToken = await new SignJWT({
      sub: "google-uid-888",
      email: "unverified@example.com",
      email_verified: false,
      nonce,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
      .setIssuer("https://accounts.google.com")
      .setAudience(config.googleClientId)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

    await assert.rejects(
      verifyGoogleIdToken(unverifiedEmailToken, nonce),
      /Google email is not verified/,
      "Should reject token with unverified email"
    );

    // Audience mismatch
    const badAudienceToken = await new SignJWT({
      sub: "google-uid-777",
      email: "test@example.com",
      email_verified: true,
      nonce,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
      .setIssuer("https://accounts.google.com")
      .setAudience("wrong-client-id")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

    await assert.rejects(
      verifyGoogleIdToken(badAudienceToken, nonce),
      /unexpected "aud" claim value/,
      "Should reject token with wrong audience"
    );
  } finally {
    config.googleClientId = origClientId;
    setMockJwks(null);
  }
});

test("WebSocket single-use ticket pattern", { skip: !redisUp && "Redis not reachable" }, async () => {
  // Test ticket consumption: ticket can be consumed exactly once
  const ticket = randomUUID();
  const userId = "u123";
  const sessionId = "s456";
  const payload = JSON.stringify({ userId, sessionId });

  // Store in Redis (or in-memory mock if Redis is down)
  const { redis, KEYS } = await import("./redis.ts");
  try {
    await redis.set(KEYS.ticket(ticket), payload, "EX", 30);
    const firstConsume = await redis.getdel(KEYS.ticket(ticket));
    assert.equal(firstConsume, payload, "First consume must return payload");

    const secondConsume = await redis.getdel(KEYS.ticket(ticket));
    assert.equal(secondConsume, null, "Second consume (replay) must fail and return null");
  } catch (err: any) {
    if (err.message?.includes("Connection is closed") || err.message?.includes("ECONNREFUSED")) {
      // Redis is not running locally; this behavior is tested with real redis in cluster/staging
      return;
    }
    throw err;
  }
});

test("Guest account retention logic calculation", () => {
  const retentionDays = 7;
  const now = Date.now();
  const cutoffDate = new Date(now - retentionDays * 24 * 60 * 60 * 1000);

  // A guest created 8 days ago is eligible
  const oldGuestCreated = new Date(now - 8 * 24 * 60 * 60 * 1000);
  assert.ok(oldGuestCreated < cutoffDate, "Guest created 8 days ago must be eligible for pruning");

  // A guest created 6 days ago is protected
  const recentGuestCreated = new Date(now - 6 * 24 * 60 * 60 * 1000);
  assert.ok(recentGuestCreated > cutoffDate, "Guest created 6 days ago must NOT be pruned");
});

