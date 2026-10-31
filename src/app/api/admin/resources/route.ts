import { z } from "zod";
import { guard, ok, fail, parseBody } from "@/lib/http";
import { requireAdmin } from "@/lib/auth";
import { all, one, Row, run } from "@/lib/db";
import { audit, notify } from "@/lib/audit";

export const GET = guard(async (req: Request) => {
  const auth = await requireAdmin();
  if (!auth.ok) return fail(auth.error, auth.code);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const items = await all(
    `SELECT r.*, p.display_name AS provider_name, p.verification_status, p.user_id AS provider_user_id,
            (SELECT COUNT(*) FROM bookings b WHERE b.resource_id = r.id) AS bookings,
            (SELECT COUNT(*) FROM reports rp WHERE rp.resource_id = r.id AND rp.status = 'open') AS open_reports,
            (SELECT url FROM resource_images i WHERE i.resource_id = r.id ORDER BY sort_order LIMIT 1) AS image_url
       FROM resources r JOIN provider_profiles p ON p.id = r.provider_id
       ${status && status !== "all" ? "WHERE r.status = ?" : ""}
       ORDER BY r.id DESC LIMIT 300`,
    ...(status && status !== "all" ? [status] : [])
  );
  const reports = await all(
    `SELECT rp.*, r.title AS resource_title, u.full_name AS reporter_name FROM reports rp
       LEFT JOIN resources r ON r.id = rp.resource_id LEFT JOIN users u ON u.id = rp.reporter_id
      ORDER BY rp.created_at DESC LIMIT 100`
  );
  return ok({ items, reports });
});

const schema = z.object({
  resourceId: z.number().int(),
  action: z.enum(["pause", "activate", "archive"]),
  note: z.string().max(500).optional(),
});

export const POST = guard(async (req: Request) => {
  const auth = await requireAdmin();
  if (!auth.ok) return fail(auth.error, auth.code);
  const parsed = await parseBody(req, schema);
  if (!parsed.ok) return parsed.res;
  const r = await one<Row>(`SELECT r.*, p.user_id FROM resources r JOIN provider_profiles p ON p.id = r.provider_id WHERE r.id = ?`, parsed.data.resourceId);
  if (!r) return fail("Resource not found", 404);
  const status = parsed.data.action === "pause" ? "paused" : parsed.data.action === "activate" ? "active" : "archived";
  await run(`UPDATE resources SET status = ?, updated_at = ? WHERE id = ?`, status, new Date().toISOString(), r.id);
  await run(`UPDATE reports SET status = 'actioned', handled_by = ? WHERE resource_id = ? AND status = 'open'`, auth.user.id, r.id);
  await notify(r.user_id, "listing", `Listing ${status} by admin`, `Your listing "${r.title}" was set to ${status}.${parsed.data.note ? " Note: " + parsed.data.note : ""}`, "/provider/resources");
  await audit({
    actorId: auth.user.id, actorEmail: auth.user.email, action: `admin.resource_${parsed.data.action}`,
    entity: "resource", entityId: r.id, detail: { title: r.title, note: parsed.data.note },
  });
  return ok({ status });
});
