import { z } from "zod";
import { guard, ok, fail, parseBody } from "@/lib/http";
import { getSessionUser } from "@/lib/auth";
import { all, run, one } from "@/lib/db";

export const GET = guard(async () => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  const items = await all(
    `SELECT r.id, r.title, r.category, r.condition, r.price_daily, r.price_hourly, r.location_city, r.status,
            p.display_name AS provider_name, p.verification_status, p.storefront_slug,
            (SELECT url FROM resource_images i WHERE i.resource_id = r.id ORDER BY sort_order LIMIT 1) AS image_url,
            f.created_at AS saved_at
       FROM favourites f JOIN resources r ON r.id = f.resource_id JOIN provider_profiles p ON p.id = r.provider_id
      WHERE f.user_id = ? ORDER BY f.created_at DESC`, user.id
  );
  return ok({ items });
});

const schema = z.object({ resourceId: z.number().int() });

export const POST = guard(async (req: Request) => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  const parsed = await parseBody(req, schema);
  if (!parsed.ok) return parsed.res;
  if (!await one(`SELECT 1 FROM resources WHERE id = ?`, parsed.data.resourceId)) return fail("Resource not found", 404);
  const existing = await one(`SELECT 1 FROM favourites WHERE user_id = ? AND resource_id = ?`, user.id, parsed.data.resourceId);
  if (existing) {
    await run(`DELETE FROM favourites WHERE user_id = ? AND resource_id = ?`, user.id, parsed.data.resourceId);
    return ok({ favourited: false });
  }
  await run(`INSERT INTO favourites (user_id, resource_id) VALUES (?,?)`, user.id, parsed.data.resourceId);
  return ok({ favourited: true });
});
