import { z } from "zod";
import { guard, ok, fail, parseBody } from "@/lib/http";
import { requireAdmin } from "@/lib/auth";
import { all, run, one } from "@/lib/db";
import { audit } from "@/lib/audit";

export const GET = guard(async () => {
  const auth = await requireAdmin();
  if (!auth.ok) return fail(auth.error, auth.code);
  const cats = await all(
    `SELECT c.*, (SELECT COUNT(*) FROM resources r WHERE r.category = c.slug) AS resource_count
       FROM categories c ORDER BY c.sort_order`
  );
  return ok({ items: cats });
});

const schema = z.object({
  slug: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/),
  name: z.string().min(2).max(80),
  icon: z.string().max(30).default("tag"),
  sort_order: z.number().int().min(0).max(999).default(99),
});

export const POST = guard(async (req: Request) => {
  const auth = await requireAdmin();
  if (!auth.ok) return fail(auth.error, auth.code);
  const parsed = await parseBody(req, schema);
  if (!parsed.ok) return parsed.res;
  if (await one(`SELECT 1 FROM categories WHERE slug = ?`, parsed.data.slug)) return fail("That category slug already exists", 409);
  await run(`INSERT INTO categories (slug, name, icon, sort_order) VALUES (?,?,?,?)`,
    parsed.data.slug, parsed.data.name, parsed.data.icon, parsed.data.sort_order);
  await audit({ actorId: auth.user.id, actorEmail: auth.user.email, action: "admin.category_create", entity: "category", entityId: parsed.data.slug });
  return ok({ created: true });
});
