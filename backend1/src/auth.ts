import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { config } from "./config.ts";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const KEY_LEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LEN);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

const sign = (data: string) => createHmac("sha256", config.authSecret).update(data).digest("base64url");

export interface TokenPayload {
  sub: string;
  sid?: string;
  exp: number;
}

/** Compact signed token: base64url(json).signature */
export function issueToken(userId: string, sessionId?: string): string {
  const payload: TokenPayload = {
    sub: userId,
    exp: Date.now() + config.tokenTtlMs,
  };
  if (sessionId) payload.sid = sessionId;
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyToken(token: string | null | undefined): { userId: string; sessionId?: string } | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { sub, sid, exp } = JSON.parse(Buffer.from(body, "base64url").toString()) as { sub?: unknown; sid?: unknown; exp?: unknown };
    return typeof sub === "string" && typeof exp === "number" && exp > Date.now()
      ? { userId: sub, sessionId: typeof sid === "string" ? sid : undefined }
      : null;
  } catch {
    return null;
  }
}

export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 128;

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}


