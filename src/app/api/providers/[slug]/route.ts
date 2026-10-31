import { guard, ok, fail } from "@/lib/http";
import { one, all } from "@/lib/db";
import { searchResources } from "@/lib/resources";

export const GET = guard(async (_req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  const p = await one(
    `SELECT p.*, u.city AS user_city, u.state AS user_state, u.account_type, u.is_demo
       FROM provider_profiles p JOIN users u ON u.id = p.user_id
      WHERE p.storefront_slug = ?`, slug
  );
  if (!p) return fail("Storefront not found", 404);
  const { items } = await searchResources({ providerId: p.id, limit: 100 });
  const reviews = await all(
    `SELECT rv.rating, rv.body, rv.created_at, rv.condition_accuracy, u.full_name AS buyer_name, r.title AS resource_title
       FROM reviews rv JOIN users u ON u.id = rv.buyer_id JOIN resources r ON r.id = rv.resource_id
      WHERE rv.provider_id = ? ORDER BY rv.created_at DESC LIMIT 20`, p.id
  );
  return ok({ provider: p, resources: items, reviews });
});
