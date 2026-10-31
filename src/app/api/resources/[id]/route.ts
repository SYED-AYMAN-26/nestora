import { z } from "zod";
import { guard, ok, fail, parseBody } from "@/lib/http";
import { getSessionUser } from "@/lib/auth";
import { ownedResource } from "@/lib/access";
import { Bind, one, run } from "@/lib/db";
import { audit } from "@/lib/audit";
import { resourceDetail } from "@/lib/resources";
import { CATEGORIES } from "@/lib/constants";

export const GET = guard(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const detail = await resourceDetail(id);
  if (!detail) return fail("Resource not found", 404);

  const user = await getSessionUser();
  const isOwner = Boolean(user?.provider && user.provider.id === detail.resource.provider_id);
  const isAdmin = user?.role === "admin";

  // Public page: only appropriate data. Private documents/transaction info are
  // excluded unless the caller is the owner or an admin.
  const payload: Record<string, unknown> = {
    resource: detail.resource,
    images: detail.images,
    reviews: detail.reviews,
    capabilities: detail.capabilities,
    completedBookings: detail.completedBookings,
    maintenance: isOwner || isAdmin ? detail.maintenance : detail.maintenance.map((m) => ({ start_date: m.start_date, end_date: m.end_date, kind: m.kind })),
    availabilityBlocks: detail.availabilityBlocks,
    viewer: { isOwner, isAdmin },
  };
  if (isOwner || isAdmin) {
    payload.private = {
      internal_usage_hours_month: detail.resource.internal_usage_hours_month,
      quantity_active: detail.resource.quantity_active,
      booking_limit_days: detail.resource.booking_limit_days,
    };
  }
  return ok(payload);
});

const updateSchema = z.object({
  title: z.string().min(4).max(160).optional(),
  category: z.string().optional(),
  subcategory: z.string().max(80).nullable().optional(),
  description: z.string().min(20).max(5000).optional(),
  brand: z.string().max(80).nullable().optional(),
  model: z.string().max(80).nullable().optional(),
  condition: z.enum(["new", "excellent", "good", "fair"]).optional(),
  quantity_total: z.number().int().min(1).max(1000).optional(),
  quantity_active: z.number().int().min(0).max(1000).optional(),
  internal_usage_hours_month: z.number().int().min(0).max(100000).optional(),
  location_city: z.string().max(80).optional(),
  location_state: z.string().max(80).optional(),
  price_hourly: z.number().min(0).max(1e7).optional(),
  price_daily: z.number().min(0).max(1e7).optional(),
  price_weekly: z.number().min(0).max(1e7).optional(),
  deposit: z.number().min(0).max(1e7).optional(),
  eligibility: z.string().max(1000).nullable().optional(),
  training_required: z.boolean().optional(),
  supervision_required: z.boolean().optional(),
  usage_rules: z.string().max(2000).nullable().optional(),
  cancellation_policy: z.string().max(2000).nullable().optional(),
  min_hours: z.number().int().min(1).max(60).optional(),
  max_days: z.number().int().min(1).max(365).optional(),
  status: z.enum(["draft", "active", "paused", "archived"]).optional(),
  model_3d: z.string().max(40).nullable().optional(),
  capabilities: z.array(z.string().max(60)).max(20).optional(),
  best_for: z.string().max(200).nullable().optional(),
  approval_mode: z.enum(["manual", "auto"]).optional(),
  booking_limit_days: z.number().int().min(1).max(365).optional(),
  images: z.array(z.string().max(300)).max(8).optional(),
  blocked_dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(400).optional(),
  maintenance: z.array(z.object({
    start_date: z.string(), end_date: z.string().nullable(),
    kind: z.enum(["service", "repair", "inspection"]), notes: z.string().max(500).optional(),
  })).max(50).optional(),
});

export const PATCH = guard(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  const { id } = await ctx.params;
  const existing = await ownedResource(Number(id), user);
  if (!existing) {
    // Distinguish "doesn't exist" from "not yours" without leaking existence.
    return fail("Resource not found in your storefront", user.provider ? 404 : 403);
  }
  const parsed = await parseBody(req, updateSchema);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  if (d.category && !CATEGORIES.some((c) => c.slug === d.category)) return fail("Unknown category", 422);
  if (d.quantity_total != null && d.quantity_active != null && d.quantity_active > d.quantity_total) {
    return fail("Units in internal use cannot exceed total quantity", 422);
  }
  if (d.quantity_active != null && d.quantity_total == null && d.quantity_active > existing.quantity_total) {
    return fail("Units in internal use cannot exceed total quantity", 422);
  }
  if (d.min_hours != null && d.max_days != null && d.min_hours > d.max_days) {
    return fail("Minimum duration cannot exceed maximum duration", 422);
  }

  const sets: string[] = [];
  const vals: Bind[] = [];
  const asBind = (x: unknown): Bind =>
    x === null || x === undefined ? null
      : typeof x === "string" || typeof x === "number" || typeof x === "bigint" || typeof x === "boolean" ? x
      : typeof x === "object" && x instanceof Uint8Array ? x
      : JSON.stringify(x);
  const assign = async (col: string, v: unknown, transform?: (x: unknown) => unknown) => {
    sets.push(`${col} = ?`);
    vals.push(asBind(transform ? transform(v) : v));
  };
  const simple: (keyof typeof d)[] = [
    "title", "category", "subcategory", "description", "brand", "model", "condition", "quantity_total",
    "quantity_active", "internal_usage_hours_month", "location_city", "location_state", "price_hourly",
    "price_daily", "price_weekly", "deposit", "eligibility", "usage_rules", "cancellation_policy",
    "min_hours", "max_days", "status", "model_3d", "best_for", "approval_mode", "booking_limit_days",
  ];
  for (const k of simple) if (d[k] !== undefined) assign(k, d[k]);
  if (d.training_required !== undefined) assign("training_required", d.training_required ? 1 : 0);
  if (d.supervision_required !== undefined) assign("supervision_required", d.supervision_required ? 1 : 0);
  if (d.capabilities !== undefined) assign("capabilities", d.capabilities, (v) => JSON.stringify(v));

  if (sets.length) {
    sets.push(`updated_at = ?`);
    vals.push(new Date().toISOString());
    await run(`UPDATE resources SET ${sets.join(", ")} WHERE id = ? AND provider_id = ?`, ...vals, existing.id, user.provider!.id);
  }

  if (d.images) {
    await run(`DELETE FROM resource_images WHERE resource_id = ?`, existing.id);
    await Promise.all(d.images.map(async (url, i) =>
      await run(`INSERT INTO resource_images (resource_id, url, alt, sort_order) VALUES (?,?,?,?)`, existing.id, url, existing.title, i)
    ));
  }
  if (d.blocked_dates) {
    await run(`DELETE FROM resource_availability WHERE resource_id = ?`, existing.id);
    for (const date of [...new Set(d.blocked_dates)]) {
      await run(`INSERT INTO resource_availability (resource_id, date, status, note) VALUES (?,?,?,?)`, existing.id, date, "blocked", "Provider hold");
    }
  }
  if (d.maintenance) {
    for (const m of d.maintenance) {
      await run(`INSERT INTO maintenance_records (resource_id, start_date, end_date, kind, notes, created_by) VALUES (?,?,?,?,?,?)`,
        existing.id, m.start_date, m.end_date, m.kind, m.notes ?? null, user.id);
    }
  }

  await audit({
    actorId: user.id, actorEmail: user.email, action: "resource.update", entity: "resource",
    entityId: existing.id, detail: { fields: Object.keys(d) },
  });
  return ok({ resourceId: existing.id });
});

export const DELETE = guard(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  const { id } = await ctx.params;
  const existing = await ownedResource(Number(id), user);
  if (!existing) return fail("Resource not found in your storefront", 404);

  const live = await one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM bookings WHERE resource_id = ? AND status IN
      ('pending','approved','awaiting_payment','paid','ready_for_handover','active','return_requested','disputed')`,
    existing.id
  )?.c ?? 0;
  if (Number(live) > 0) {
    // Soft-archive instead of destroying history.
    await run(`UPDATE resources SET status = 'archived', updated_at = ? WHERE id = ?`, new Date().toISOString(), existing.id);
    await audit({ actorId: user.id, actorEmail: user.email, action: "resource.archive", entity: "resource", entityId: existing.id, detail: { reason: "active bookings", live } });
    return ok({ archived: true, message: "This listing has active or pending bookings, so it was archived instead of deleted. Its history is preserved." });
  }
  await run(`DELETE FROM resources WHERE id = ? AND provider_id = ?`, existing.id, user.provider!.id);
  await audit({ actorId: user.id, actorEmail: user.email, action: "resource.delete", entity: "resource", entityId: existing.id });
  return ok({ deleted: true });
});
