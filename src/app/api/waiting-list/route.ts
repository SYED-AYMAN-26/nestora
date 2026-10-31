import { z } from "zod";
import { guard, ok, fail, parseBody } from "@/lib/http";
import { getSessionUser } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { cancelWaiting, joinWaitingList } from "@/lib/lifecycle";

export const GET = guard(async () => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  const items = await all(
    `SELECT w.*, r.title AS resource_title, r.id AS resource_id, p.display_name AS provider_name,
            (SELECT url FROM resource_images i WHERE i.resource_id = r.id ORDER BY sort_order LIMIT 1) AS image_url
       FROM waiting_list w JOIN resources r ON r.id = w.resource_id JOIN provider_profiles p ON p.id = r.provider_id
      WHERE w.user_id = ? ORDER BY w.created_at DESC`, user.id
  );
  return ok({ items });
});

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("join"), resourceId: z.number().int(), start: z.string(), end: z.string(), units: z.number().int().min(1).max(50).default(1) }),
  z.object({ action: z.literal("cancel"), waitingId: z.number().int() }),
]);

export const POST = guard(async (req: Request) => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  const parsed = await parseBody(req, schema);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;
  if (d.action === "cancel") {
    const res = await cancelWaiting({ userId: user.id }, d.waitingId);
    return res.ok ? ok({ message: res.message }) : fail(res.error, res.code ?? 400);
  }
  const resource = await one(`SELECT * FROM resources WHERE id = ? AND status = 'active'`, d.resourceId);
  if (!resource) return fail("Resource not found or not active", 404);
  const res = await joinWaitingList({ resource, userId: user.id }, d.start, d.end, d.units);
  return res.ok ? ok({ message: res.message }) : fail(res.error, res.code ?? 400);
});
