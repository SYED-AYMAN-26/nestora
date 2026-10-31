import { z } from "zod";
import { guard, ok, fail, parseBody } from "@/lib/http";
import { getSessionUser } from "@/lib/auth";
import { one, Row, run } from "@/lib/db";
import { audit, notify } from "@/lib/audit";
import { rateLimit } from "@/lib/audit";

const schema = z.object({
  resourceId: z.number().int(),
  reason: z.enum(["misleading", "unavailable", "unsafe", "inappropriate", "other"]),
  detail: z.string().max(1000).optional(),
});

/** Buyers can report a listing; reports go straight to the admin queue. */
export const POST = guard(async (req: Request) => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  const rl = await rateLimit(`report:${user.id}`, 10, 3600);
  if (!rl.ok) return fail("Too many reports submitted recently", 429);
  const parsed = await parseBody(req, schema);
  if (!parsed.ok) return parsed.res;
  const res = await one<Row>(`SELECT * FROM resources WHERE id = ?`, parsed.data.resourceId);
  if (!res) return fail("Resource not found", 404);
  await run(`INSERT INTO reports (reporter_id, resource_id, reason, detail) VALUES (?,?,?,?)`,
    user.id, res.id, parsed.data.reason, parsed.data.detail ?? null);
  const admin = await one<{ id: number }>(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
  if (admin) await notify(admin.id, "report", "Listing reported", `${user.full_name} reported "${res.title}": ${parsed.data.reason}`, "/admin/resources");
  await audit({ actorId: user.id, actorEmail: user.email, action: "report.create", entity: "resource", entityId: res.id, detail: { reason: parsed.data.reason } });
  return ok({ message: "Report submitted. An administrator will review it." });
});
