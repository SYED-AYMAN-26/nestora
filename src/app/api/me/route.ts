import { z } from "zod";
import { guard, ok, fail, parseBody } from "@/lib/http";
import { getSessionUser } from "@/lib/auth";
import { Bind, one, run } from "@/lib/db";
import { audit } from "@/lib/audit";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { ACCOUNT_TYPES } from "@/lib/constants";

export const GET = guard(async () => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  const full = await one(`SELECT id, email, full_name, phone, account_type, org_name, country, state, city, address, avatar_url, bio, role, active_mode, onboarded, created_at FROM users WHERE id = ?`, user.id);
  const provider = user.provider ? await one(`SELECT * FROM provider_profiles WHERE id = ?`, user.provider.id) : null;
  const verification = provider
    ? await one(`SELECT id, status, legal_name, reviewer_note, reviewed_at, created_at, identity_doc_url, ownership_doc_url, extra_doc_url FROM verification_requests WHERE provider_id = ? ORDER BY id DESC LIMIT 1`, provider.id)
    : null;
  return ok({ user: full, provider, verification });
});

const profileSchema = z.object({
  full_name: z.string().min(2).max(120).optional(),
  phone: z.string().max(30).nullable().optional(),
  account_type: z.enum(ACCOUNT_TYPES.map((a) => a.value) as [string, ...string[]]).optional(),
  org_name: z.string().max(160).nullable().optional(),
  country: z.string().max(80).optional(),
  state: z.string().max(80).optional(),
  city: z.string().max(80).optional(),
  address: z.string().max(300).nullable().optional(),
  avatar_url: z.string().max(300).nullable().optional(),
  bio: z.string().max(1000).nullable().optional(),
  onboarded: z.boolean().optional(),
});

export const PATCH = guard(async (req: Request) => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  const parsed = await parseBody(req, profileSchema);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  // Users can only ever modify their OWN row: id comes from the session.
  const sets: string[] = [];
  const vals: Bind[] = [];
  for (const k of ["full_name", "phone", "account_type", "org_name", "country", "state", "city", "address", "avatar_url", "bio"] as const) {
    if (d[k] !== undefined) { sets.push(`${k} = ?`); vals.push(d[k]); }
  }
  if (d.onboarded !== undefined) { sets.push("onboarded = ?"); vals.push(d.onboarded ? 1 : 0); }
  if (!sets.length) return ok({ updated: false });
  await run(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, ...vals, user.id);
  await audit({ actorId: user.id, actorEmail: user.email, action: "user.profile_update", entity: "user", entityId: user.id, detail: Object.keys(d) });
  return ok({ updated: true });
});

const pwSchema = z.object({
  current: z.string().min(1),
  next: z.string().min(8).max(200),
});

export const POST = guard(async (req: Request) => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  const parsed = await parseBody(req, pwSchema);
  if (!parsed.ok) return parsed.res;
  const row = await one<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = ?`, user.id);
  if (!row || !verifyPassword(parsed.data.current, row.password_hash)) return fail("Current password is incorrect", 401);
  await run(`UPDATE users SET password_hash = ? WHERE id = ?`, hashPassword(parsed.data.next), user.id);
  // Invalidate other sessions after a password change.
  await run(`DELETE FROM sessions WHERE user_id = ?`, user.id);
  await audit({ actorId: user.id, actorEmail: user.email, action: "user.password_change", entity: "user", entityId: user.id });
  return ok({ changed: true, message: "Password updated. Please sign in again." });
});
