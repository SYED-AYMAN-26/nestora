import { z } from "zod";
import { guard, ok, fail, parseBody } from "@/lib/http";
import { requireAdmin } from "@/lib/auth";
import { all, Bind, one, Row, run } from "@/lib/db";
import { audit } from "@/lib/audit";

export const GET = guard(async (req: Request) => {
  const auth = await requireAdmin();
  if (!auth.ok) return fail(auth.error, auth.code);
  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  const role = url.searchParams.get("role");
  const where: string[] = [];
  const params: Bind[] = [];
  if (q) { where.push(`(u.email LIKE ? OR u.full_name LIKE ? OR u.org_name LIKE ?)`); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (role && role !== "all") { where.push(`u.role = ?`); params.push(role); }
  const items = await all(
    `SELECT u.id, u.email, u.full_name, u.account_type, u.org_name, u.city, u.state, u.role, u.active_mode,
            u.is_demo, u.created_at,
            (SELECT COUNT(*) FROM bookings b WHERE b.buyer_id = u.id) AS bookings,
            p.id AS provider_id, p.verification_status, p.storefront_slug,
            (SELECT COUNT(*) FROM resources r WHERE r.provider_id = p.id) AS resources
       FROM users u LEFT JOIN provider_profiles p ON p.user_id = u.id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY u.id DESC LIMIT 300`, ...params
  );
  return ok({ items });
});

const schema = z.object({
  userId: z.number().int(),
  action: z.enum(["suspend_sessions", "promote_admin", "set_role_user"]),
});

export const POST = guard(async (req: Request) => {
  const auth = await requireAdmin();
  if (!auth.ok) return fail(auth.error, auth.code);
  const parsed = await parseBody(req, schema);
  if (!parsed.ok) return parsed.res;
  const target = await one<Row>(`SELECT * FROM users WHERE id = ?`, parsed.data.userId);
  if (!target) return fail("User not found", 404);
  if (target.id === auth.user.id && parsed.data.action !== "suspend_sessions") {
    return fail("You cannot change your own admin role", 422);
  }

  if (parsed.data.action === "suspend_sessions") {
    await run(`DELETE FROM sessions WHERE user_id = ?`, target.id);
  } else if (parsed.data.action === "promote_admin") {
    await run(`UPDATE users SET role = 'admin' WHERE id = ?`, target.id);
  } else {
    await run(`UPDATE users SET role = 'user' WHERE id = ?`, target.id);
  }
  await audit({
    actorId: auth.user.id, actorEmail: auth.user.email, action: `admin.${parsed.data.action}`,
    entity: "user", entityId: target.id, detail: { email: target.email },
  });
  return ok({ message: "Action applied." });
});
