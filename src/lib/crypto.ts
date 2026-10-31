import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// --- password hashing (scrypt, per-user salt) -----------------------------
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
  return `scrypt$16384$8$1$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, N, r, p, salt, hash] = stored.split("$");
    if (scheme !== "scrypt") return false;
    const candidate = crypto.scryptSync(password, salt, 64, {
      N: Number(N), r: Number(r), p: Number(p),
    });
    const expected = Buffer.from(hash, "hex");
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

// --- session secret -------------------------------------------------------
let memoSecret: string | null = null;

/**
 * The key that signs session tokens.
 *
 * Production MUST set SESSION_SECRET. The old behaviour — silently generating one
 * and writing it to `data/.session-secret` — is fine on a laptop but wrong on a
 * serverless platform: the filesystem is read-only outside /tmp, so either the
 * write throws or (worse, when it succeeds in /tmp) every instance gets its OWN
 * secret and sessions are invalidated at random as requests land on different
 * lambdas. On a production build a missing secret is therefore a hard error, and
 * src/lib/config.ts reports it at startup.
 */
function sessionSecret(): string {
  const configured = process.env.SESSION_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET is not set. A production deployment cannot derive a stable session secret; " +
        "set SESSION_SECRET (openssl rand -hex 32) in the environment."
    );
  }
  if (memoSecret) return memoSecret;
  const file = path.join(process.cwd(), "data", ".session-secret");
  try {
    memoSecret = fs.readFileSync(file, "utf8").trim();
  } catch {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    memoSecret = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(file, memoSecret, { mode: 0o600 });
  }
  return memoSecret;
}

export function newSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Sessions are stored as a SHA-256 hash of the token, never the token itself. */
export function hashToken(token: string): string {
  return crypto.createHmac("sha256", sessionSecret()).update(token).digest("hex");
}

export function randomCode(prefix: string, len = 6): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return `${prefix}-${out}`;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function hmacHex(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}
