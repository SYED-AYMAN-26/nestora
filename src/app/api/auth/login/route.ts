import { z } from "zod";
import { guard, ok, fail, parseBody, clientIp } from "@/lib/http";
import { one, run } from "@/lib/db";
import { authenticate, createSession } from "@/lib/auth";
import { audit, rateLimit } from "@/lib/audit";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const POST = guard(async (req: Request) => {
  const ip = clientIp(req);
  const parsed = await parseBody(req, schema);
  if (!parsed.ok) return parsed.res;

  // Only *failed* attempts should burn the budget, so the counter is cleared on success.
  const rlKey = `login:${ip}:${parsed.data.email.toLowerCase()}`;
  const rl = await rateLimit(rlKey, 8, 600);
  if (!rl.ok) return fail(`Too many sign-in attempts. Try again in ${rl.retryAfter}s.`, 429);

  const res = await authenticate(parsed.data.email, parsed.data.password);
  if (res.ok) {
    await run(`DELETE FROM rate_limits WHERE key = ?`, rlKey);
  } else {
    await audit({ action: "auth.login_failed", entity: "user", detail: { email: parsed.data.email }, ip });
    return fail(res.error || "Invalid credentials", 401);
  }
  const user = res.user!;
  // Session regeneration: invalidate any prior sessions for this account.
  await run(`UPDATE sessions SET expires_at = ? WHERE user_id = ?`, new Date(0).toISOString(), user.id);
  await createSession(user.id, { ua: req.headers.get("user-agent") || undefined, ip });
  await audit({ actorId: user.id, actorEmail: user.email, action: "auth.login", entity: "user", entityId: user.id, ip });

  const dest =
    user.role === "admin" ? "/admin"
      : !user.onboarded ? "/onboarding"
        : user.active_mode === "provider" && await one(`SELECT 1 FROM provider_profiles WHERE user_id = ?`, user.id)
          ? "/provider"
          : "/marketplace";
  return ok({ redirect: dest });
});
