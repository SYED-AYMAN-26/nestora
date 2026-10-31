import { z } from "zod";
import { guard, ok } from "@/lib/http";
import { getSessionUser } from "@/lib/auth";
import { all, run } from "@/lib/db";

const schema = z.object({ resourceId: z.number().int() });

/** Recently viewed (signed-in users only). */
export const POST = guard(async (req: Request) => {
  const user = await getSessionUser();
  if (!user) return ok({ tracked: false });
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return ok({ tracked: false });
  await run(
    `INSERT INTO recently_viewed (user_id, resource_id, viewed_at) VALUES (?,?,?)
     ON CONFLICT(user_id, resource_id) DO UPDATE SET viewed_at = excluded.viewed_at`,
    user.id, parsed.data.resourceId, new Date().toISOString()
  );
  return ok({ tracked: true });
});

export const GET = guard(async () => {
  const user = await getSessionUser();
  if (!user) return ok({ items: [] });
  const items = await all(
    `SELECT r.id, r.title, r.price_daily, r.price_hourly, r.location_city, r.category,
            (SELECT url FROM resource_images i WHERE i.resource_id = r.id ORDER BY sort_order LIMIT 1) AS image_url,
            p.display_name AS provider_name, rv.viewed_at
       FROM recently_viewed rv JOIN resources r ON r.id = rv.resource_id JOIN provider_profiles p ON p.id = r.provider_id
      WHERE rv.user_id = ? ORDER BY rv.viewed_at DESC LIMIT 8`, user.id
  );
  return ok({ items });
});
