import { z } from "zod";
import { guard, ok, fail, parseBody } from "@/lib/http";
import { getSessionUser } from "@/lib/auth";
import { run } from "@/lib/db";
import { audit } from "@/lib/audit";
import { CATEGORIES } from "@/lib/constants";
import { computeUtilisation } from "@/lib/booking";

const schema = z.object({
  title: z.string().min(4).max(160),
  category: z.string().min(2).max(60),
  subcategory: z.string().max(80).nullable().optional(),
  description: z.string().min(20).max(5000),
  brand: z.string().max(80).nullable().optional(),
  model: z.string().max(80).nullable().optional(),
  condition: z.enum(["new", "excellent", "good", "fair"]).default("good"),
  quantity_total: z.number().int().min(1).max(1000).default(1),
  quantity_active: z.number().int().min(0).max(1000).default(0),
  internal_usage_hours_month: z.number().int().min(0).max(100000).default(0),
  location_city: z.string().min(1).max(80),
  location_state: z.string().max(80).default(""),
  price_hourly: z.number().min(0).max(1e7).default(0),
  price_daily: z.number().min(0).max(1e7).default(0),
  price_weekly: z.number().min(0).max(1e7).default(0),
  deposit: z.number().min(0).max(1e7).default(0),
  eligibility: z.string().max(1000).nullable().optional(),
  training_required: z.boolean().default(false),
  supervision_required: z.boolean().default(false),
  usage_rules: z.string().max(2000).nullable().optional(),
  cancellation_policy: z.string().max(2000).nullable().optional(),
  min_hours: z.number().int().min(1).max(60).default(1),
  max_days: z.number().int().min(1).max(365).default(14),
  status: z.enum(["draft", "active", "paused"]).default("active"),
  model_3d: z.string().max(40).nullable().optional(),
  capabilities: z.array(z.string().max(60)).max(20).default([]),
  best_for: z.string().max(200).nullable().optional(),
  approval_mode: z.enum(["manual", "auto"]).default("manual"),
  booking_limit_days: z.number().int().min(1).max(365).default(14),
  images: z.array(z.string().max(300)).max(8).default([]),
  blocked_dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(400).default([]),
});

export const POST = guard(async (req: Request) => {
  const user = await getSessionUser();
  if (!user) return fail("Authentication required", 401);
  if (!user.provider) return fail("Create a provider profile before listing resources", 403);
  const parsed = await parseBody(req, schema);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  if (!CATEGORIES.some((c) => c.slug === d.category)) return fail("Unknown category", 422);
  if (d.quantity_active > d.quantity_total) return fail("Units in internal use cannot exceed the total quantity", 422);
  if (d.min_hours > d.max_days) return fail("Minimum duration cannot exceed the maximum duration", 422);
  if (d.price_daily === 0 && d.price_hourly === 0 && d.price_weekly === 0) {
    return fail("Set at least one rental price (hourly, daily or weekly)", 422);
  }

  const r = await run(
    `INSERT INTO resources (provider_id, title, category, subcategory, description, brand, model, condition,
      quantity_total, quantity_active, internal_usage_hours_month, location_city, location_state,
      price_hourly, price_daily, price_weekly, deposit, eligibility, training_required, supervision_required,
      usage_rules, cancellation_policy, min_hours, max_days, status, model_3d, capabilities, best_for,
      approval_mode, booking_limit_days)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    user.provider.id, d.title, d.category, d.subcategory ?? null, d.description, d.brand ?? null, d.model ?? null,
    d.condition, d.quantity_total, d.quantity_active, d.internal_usage_hours_month, d.location_city, d.location_state,
    d.price_hourly, d.price_daily, d.price_weekly, d.deposit, d.eligibility ?? null,
    d.training_required ? 1 : 0, d.supervision_required ? 1 : 0, d.usage_rules ?? null,
    d.cancellation_policy ?? null, d.min_hours, d.max_days, d.status, d.model_3d ?? null,
    JSON.stringify(d.capabilities), d.best_for ?? null, d.approval_mode, d.booking_limit_days
  );
  const id = Number(r.lastInsertRowid);
  await Promise.all(d.images.map(async (url, i) =>
    await run(`INSERT INTO resource_images (resource_id, url, alt, sort_order) VALUES (?,?,?,?)`, id, url, d.title, i)
  ));
  for (const date of [...new Set(d.blocked_dates)]) {
    await run(`INSERT INTO resource_availability (resource_id, date, status, note) VALUES (?,?,?,?)`, id, date, "blocked", "Provider hold");
  }
  await computeUtilisation(id);
  await audit({ actorId: user.id, actorEmail: user.email, action: "resource.create", entity: "resource", entityId: id, detail: { title: d.title, category: d.category } });

  return ok({ resourceId: id, message: "Listing created.", redirect: `/provider/resources/${id}` });
});
