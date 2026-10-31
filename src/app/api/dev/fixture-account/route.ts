import { z } from "zod";
import { NextResponse } from "next/server";
import { one, Row, run, today } from "@/lib/db";
import { hashPassword } from "@/lib/crypto";
import { createSession, ensureProviderProfile } from "@/lib/auth";
import { audit } from "@/lib/audit";

/**
 * TEST-ONLY fixture factory.
 *
 * The real registration endpoint is deliberately rate-limited (10 per IP per
 * hour), which is correct behaviour but makes a repeatable end-to-end suite
 * impossible: every run needs fresh, isolated accounts. This endpoint creates
 * a throwaway account without touching that limit.
 *
 * It is hard-disabled unless NODE_ENV is not "production" or the operator sets
 * ALLOW_TEST_FIXTURES=1 explicitly, and it never creates admins. It is audited.
 */
export const dynamic = "force-dynamic";

const schema = z.object({
  full_name: z.string().min(2).max(120),
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  account_type: z.enum(["college_university", "company", "organisation", "community_organisation", "individual", "other_institution"]),
  org_name: z.string().max(160).nullable().optional(),
  city: z.string().max(80).default("Chennai"),
  state: z.string().max(80).default("Tamil Nadu"),
  wants_provider: z.boolean().default(false),
});

export async function POST(req: Request) {
  const enabled = process.env.NODE_ENV !== "production" || process.env.ALLOW_TEST_FIXTURES === "1";
  if (!enabled) {
    return NextResponse.json({ ok: false, error: "Test fixtures are disabled in this deployment" }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 422 });
  }
  const d = parsed.data;
  const email = d.email.toLowerCase();

  if (await one(`SELECT 1 FROM users WHERE email = ?`, email)) {
    return NextResponse.json({ ok: false, error: "That fixture account already exists" }, { status: 409 });
  }

  const r = await run(
    `INSERT INTO users (email, password_hash, full_name, phone, account_type, org_name, country, state, city, role, active_mode, onboarded, is_demo, created_at)
     VALUES (?,?,?,?,?,?,?,?,?, 'user', 'buyer', 1, 0, ?)`,
    email, hashPassword(d.password), d.full_name, "9876500000", d.account_type, d.org_name ?? null,
    "India", d.state, d.city, new Date().toISOString()
  );
  const userId = Number(r.lastInsertRowid);

  let providerId: number | null = null;
  if (d.wants_provider) {
    const user = await one<Row>(`SELECT * FROM users WHERE id = ?`, userId);
    if (!user) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    const profile = await ensureProviderProfile(user, d.org_name ?? d.full_name);
    if (!profile) return NextResponse.json({ error: "Could not create provider profile" }, { status: 500 });
    providerId = Number(profile.id);
    await run(`UPDATE users SET active_mode = 'provider' WHERE id = ?`, userId);
  }

  await createSession(userId, { ua: req.headers.get("user-agent") || "test-fixture", ip: "fixture" });
  await audit({
    actorId: userId, actorEmail: email, action: "dev.fixture_account",
    entity: "user", entityId: userId, detail: { providerId, accountType: d.account_type },
  });

  return NextResponse.json({ ok: true, userId, providerId, email, created: today() });
}
