import { cookies } from "next/headers";
import { all, one, run, today } from "./db";
import { hashPassword, hashToken, newSessionToken, verifyPassword } from "./crypto";
import { demoLoginBlocked } from "./env";
import type { Row } from "./db";

export const SESSION_COOKIE = "rl_session";
const SESSION_DAYS = 14;

export type SessionUser = {
  id: number;
  email: string;
  full_name: string;
  role: "user" | "admin";
  account_type: string;
  org_name: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  avatar_url: string | null;
  is_demo: number;
  onboarded: number;
  active_mode: "buyer" | "provider";
  phone: string | null;
  provider: {
    id: number;
    storefront_slug: string;
    display_name: string;
    verification_status: string;
    org_type: string;
    logo_url: string | null;
    description: string | null;
    /** Fair-allocation policy JSON, stored as text in SQLite. */
    priority_policy: string | null;
  } | null;
};

export async function createSession(userId: number, meta?: { ua?: string; ip?: string }) {
  const token = newSessionToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  await run(
    `INSERT INTO sessions (id, user_id, expires_at, user_agent, ip) VALUES (?,?,?,?,?)`,
    hashToken(token), userId, expires, meta?.ua ?? null, meta?.ip ?? null
  );
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
  return token;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await run(`DELETE FROM sessions WHERE id = ?`, hashToken(token));
  jar.delete(SESSION_COOKIE);
}

/** Resolve the current user from the session cookie. Returns null if absent/expired. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const id = hashToken(token);
  const row = await one<Row>(`SELECT * FROM sessions WHERE id = ?`, id);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await run(`DELETE FROM sessions WHERE id = ?`, id);
    return null;
  }
  const u = await one<Row>(`SELECT * FROM users WHERE id = ?`, row.user_id);
  if (!u) return null;
  const p = await one<Row>(`SELECT * FROM provider_profiles WHERE user_id = ?`, u.id);
  return {
    id: u.id,
    email: u.email,
    full_name: u.full_name,
    role: u.role,
    account_type: u.account_type,
    org_name: u.org_name,
    city: u.city,
    state: u.state,
    country: u.country,
    avatar_url: u.avatar_url,
    is_demo: u.is_demo,
    onboarded: u.onboarded,
    active_mode: u.active_mode,
    phone: u.phone,
    provider: p
      ? {
          id: p.id,
          storefront_slug: p.storefront_slug,
          display_name: p.display_name,
          verification_status: p.verification_status,
          org_type: p.org_type,
          logo_url: p.logo_url,
          description: p.description,
          priority_policy: p.priority_policy,
        }
      : null,
  };
}

export type AuthResult = { ok: true; user: SessionUser } | { ok: false; error: string; code: number };

/** Server-side authentication guard for route handlers. */
export async function requireUser(): Promise<AuthResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Authentication required", code: 401 };
  return { ok: true, user };
}

export async function requireAdmin(): Promise<AuthResult> {
  const res = await requireUser();
  if (!res.ok) return res;
  if (res.user.role !== "admin") return { ok: false, error: "Administrator access required", code: 403 };
  return res;
}

export async function requireProvider(): Promise<AuthResult> {
  const res = await requireUser();
  if (!res.ok) return res;
  if (!res.user.provider) return { ok: false, error: "Provider profile required", code: 403 };
  return res;
}

export async function authenticate(email: string, password: string): Promise<{ ok: boolean; user?: Row; error?: string }> {
  const u = await one<Row>(`SELECT * FROM users WHERE email = ?`, email.trim());
  if (!u) return { ok: false, error: "Invalid email or password" };
  if (u.locked_until && new Date(u.locked_until).getTime() > Date.now()) {
    return { ok: false, error: "Too many failed attempts. Try again later." };
  }
  if (!verifyPassword(password, u.password_hash)) {
    const failed = (u.failed_logins ?? 0) + 1;
    const lock = failed >= 8 ? new Date(Date.now() + 15 * 60000).toISOString() : null;
    await run(`UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?`, failed, lock, u.id);
    return { ok: false, error: "Invalid email or password" };
  }
  // A seeded demo account with a publicly-documented password must not be usable
  // on a public production deployment unless the operator opted in.
  if (demoLoginBlocked(Boolean(u.is_demo), password)) {
    return {
      ok: false,
      error:
        "Demo accounts are disabled on this deployment. Set ALLOW_DEMO_SEED=1 (and change DEMO_PASSWORD) if this is a demo environment.",
    };
  }
  await run(`UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?`, u.id);
  return { ok: true, user: u };
}

/** Creates a provider profile for a user if they don't have one. Idempotent. */
export async function ensureProviderProfile(user: Row, displayName?: string) {
  const existing = await one<Row>(`SELECT * FROM provider_profiles WHERE user_id = ?`, user.id);
  if (existing) return existing;
  let slug = slugify(displayName || user.org_name || user.full_name || `provider-${user.id}`);
  let n = 1;
  while (await one(`SELECT 1 FROM provider_profiles WHERE storefront_slug = ?`, slug)) {
    slug = `${slugify(displayName || user.org_name || user.full_name)}-${++n}`;
  }
  const r = await run(
    `INSERT INTO provider_profiles (user_id, storefront_slug, display_name, org_type, description, contact_email, contact_phone, is_demo)
     VALUES (?,?,?,?,?,?,?,?)`,
    user.id, slug, displayName || user.org_name || user.full_name, user.account_type,
    null, user.email, user.phone ?? null, user.is_demo ?? 0
  );
  return await one<Row>(`SELECT * FROM provider_profiles WHERE id = ?`, Number(r.lastInsertRowid))!;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "provider";
}

export async function expireStaleSessions() {
  await run(`DELETE FROM sessions WHERE expires_at < ?`, new Date().toISOString());
}

export { hashPassword, today };
export type { Row };
export const getUserById = async (id: number) => await one<Row>(`SELECT * FROM users WHERE id = ?`, id);
export const listNotifications = async (userId: number, limit = 30) =>
  await all<Row>(
    `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    userId, limit
  );
