import { z } from "zod";
import { guard, ok, fail, parseBody } from "@/lib/http";
import { run, one } from "@/lib/db";
import { hashPassword } from "@/lib/crypto";
import { createSession, ensureProviderProfile, getSessionUser, destroySession } from "@/lib/auth";
import { audit, rateLimit } from "@/lib/audit";
import { ACCOUNT_TYPES } from "@/lib/constants";

const registerSchema = z.object({
  full_name: z.string().min(2).max(120),
  email: z.string().email().max(200),
  phone: z.string().min(6).max(30),
  password: z.string().min(8).max(200),
  account_type: z.enum(ACCOUNT_TYPES.map((a) => a.value) as [string, ...string[]]),
  org_name: z.string().max(160).optional().nullable(),
  country: z.string().min(2).max(80),
  state: z.string().min(1).max(80),
  city: z.string().min(1).max(80),
  address: z.string().max(300).optional().nullable(),
  wants_provider: z.boolean().optional().default(false),
});

export const POST = guard(async (req: Request) => {
  const ip = req.headers.get("x-forwarded-for") || "local";
  const rl = await rateLimit(`register:${ip}`, 10, 3600);
  if (!rl.ok) return fail(`Too many registrations from this address. Retry in ${rl.retryAfter}s.`, 429);

  const parsed = await parseBody(req, registerSchema);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  if (await one(`SELECT 1 FROM users WHERE email = ?`, d.email.trim())) {
    return fail("An account with that email already exists", 409);
  }
  const needsOrg = d.account_type !== "individual";
  if (needsOrg && !d.org_name?.trim()) return fail("Organisation or institution name is required for this account type", 422);

  const r = await run(
    `INSERT INTO users (email, password_hash, full_name, phone, account_type, org_name, country, state, city, address, active_mode)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    d.email.trim().toLowerCase(), hashPassword(d.password), d.full_name.trim(), d.phone.trim(),
    d.account_type, d.org_name?.trim() || null, d.country, d.state, d.city, d.address?.trim() || null,
    d.wants_provider ? "provider" : "buyer"
  );
  const userId = Number(r.lastInsertRowid);
  const user = await one(`SELECT * FROM users WHERE id = ?`, userId);
  if (!user) return fail("Account could not be created", 500);
  if (d.wants_provider) await ensureProviderProfile(user, d.org_name || d.full_name);

  await createSession(userId, { ua: req.headers.get("user-agent") || undefined, ip });
  await audit({ actorId: userId, actorEmail: d.email, action: "user.register", entity: "user", entityId: userId, detail: { account_type: d.account_type, wants_provider: d.wants_provider }, ip });
  return ok({ userId, redirect: d.wants_provider ? "/onboarding?role=provider" : "/onboarding" });
});

export const GET = guard(async () => {
  const user = await getSessionUser();
  return ok({ user });
});

export const DELETE = guard(async () => {
  await destroySession();
  return ok({ signedOut: true });
});
