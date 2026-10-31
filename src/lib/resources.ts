import { all, Bind, jsonParse, one, Row } from "./db";
import { checkAvailability } from "./booking";

export type ResourceSearch = {
  q?: string;
  category?: string;
  city?: string;
  minPrice?: number;
  maxPrice?: number;
  condition?: string;
  providerType?: string;
  verifiedOnly?: boolean;
  availableFrom?: string;
  availableTo?: string;
  capability?: string;
  sort?: "relevance" | "price_asc" | "price_desc" | "rating" | "newest";
  limit?: number;
  offset?: number;
  includeNonActive?: boolean;
  providerId?: number;
};

const BASE = `
  SELECT r.*, p.display_name AS provider_name, p.storefront_slug, p.verification_status, p.org_type,
         p.rating_cached, p.rating_count, p.is_demo AS provider_is_demo,
         (SELECT url FROM resource_images i WHERE i.resource_id = r.id ORDER BY sort_order LIMIT 1) AS image_url,
         (SELECT COUNT(*) FROM resource_images i WHERE i.resource_id = r.id) AS image_count,
         (SELECT COUNT(*) FROM reviews rv WHERE rv.resource_id = r.id) AS review_count
    FROM resources r JOIN provider_profiles p ON p.id = r.provider_id
`;

/** Single source of truth for marketplace search — used by API and server pages. */
/**
 * Result rows are the columns listed in BASE, which line up with the public
 * ResourceCard contract — so callers get a typed row instead of `Row`.
 */
export type ResourceListItem = CardResource & { capabilities?: string | null; provider_id?: number };

import type { CardResource } from "@/components/ResourceCard";

export async function searchResources(s: ResourceSearch) {
  const where: string[] = [];
  const params: Bind[] = [];
  if (!s.includeNonActive) where.push(`r.status = 'active'`);
  if (s.providerId) { where.push(`r.provider_id = ?`); params.push(s.providerId); }
  if (s.q) {
    where.push(`(r.title LIKE ? OR r.description LIKE ? OR r.brand LIKE ? OR r.model LIKE ? OR r.capabilities LIKE ? OR p.display_name LIKE ?)`);
    const like = `%${s.q}%`;
    params.push(like, like, like, like, like, like);
  }
  if (s.category) { where.push(`r.category = ?`); params.push(s.category); }
  if (s.city) { where.push(`LOWER(r.location_city) LIKE ?`); params.push(`%${s.city.toLowerCase()}%`); }
  if (s.condition) { where.push(`r.condition = ?`); params.push(s.condition); }
  if (s.providerType) { where.push(`p.org_type = ?`); params.push(s.providerType); }
  if (s.verifiedOnly) where.push(`p.verification_status = 'verified'`);
  if (s.capability) { where.push(`r.capabilities LIKE ?`); params.push(`%${s.capability}%`); }
  if (s.minPrice != null) { where.push(`(r.price_daily >= ? OR r.price_hourly >= ?)`); params.push(s.minPrice, s.minPrice); }
  if (s.maxPrice != null) {
    where.push(`((r.price_daily > 0 AND r.price_daily <= ?) OR (r.price_daily = 0 AND r.price_hourly <= ?))`);
    params.push(s.maxPrice, s.maxPrice);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  let orderSql = `ORDER BY (p.verification_status = 'verified') DESC, r.id DESC`;
  if (s.sort === "price_asc") orderSql = `ORDER BY CASE WHEN r.price_daily > 0 THEN r.price_daily ELSE r.price_hourly * 8 END ASC`;
  if (s.sort === "price_desc") orderSql = `ORDER BY CASE WHEN r.price_daily > 0 THEN r.price_daily ELSE r.price_hourly * 8 END DESC`;
  if (s.sort === "rating") orderSql = `ORDER BY p.rating_cached DESC, p.rating_count DESC`;
  if (s.sort === "newest") orderSql = `ORDER BY r.created_at DESC`;

  const rows = await all<ResourceListItem>(`${BASE} ${whereSql} ${orderSql} LIMIT ? OFFSET ?`, ...params, s.limit ?? 48, s.offset ?? 0);
  const total = (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM resources r JOIN provider_profiles p ON p.id = r.provider_id ${whereSql}`, ...params))?.c ?? 0;

  // Live availability filter (server-side, after the SQL pass).
  let items = rows;
  if (s.availableFrom && s.availableTo) {
    const checks = await Promise.all(
      rows.map(async (r) => (await checkAvailability(r.id, s.availableFrom!, s.availableTo!, 1)).ok)
    );
    items = rows.filter((_, i) => checks[i]);
  }
  return { items, total: Number(total) };
}

export async function resourceDetail(idOrSlug: string) {
  const isNumeric = /^\d+$/.test(idOrSlug);
  const r = await one<Row>(`${BASE} WHERE ${isNumeric ? "r.id = ?" : "r.id = ?"}`, Number(idOrSlug));
  if (!r) return null;
  const images = await all<Row>(`SELECT * FROM resource_images WHERE resource_id = ? ORDER BY sort_order`, r.id);
  const reviews = await all<Row>(
    `SELECT rv.*, u.full_name AS buyer_name, u.account_type AS buyer_type
       FROM reviews rv JOIN users u ON u.id = rv.buyer_id
      WHERE rv.resource_id = ? ORDER BY rv.created_at DESC LIMIT 20`, r.id
  );
  const maintenance = await all<Row>(`SELECT * FROM maintenance_records WHERE resource_id = ? ORDER BY start_date DESC LIMIT 20`, r.id);
  const bookingsCount = (await one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM bookings WHERE resource_id = ? AND status = 'completed'`, r.id
  ))?.c ?? 0;
  const availabilityBlocks = await all<Row>(
    `SELECT date, status, note FROM resource_availability WHERE resource_id = ? AND date >= date('now') ORDER BY date`, r.id
  );
  return {
    resource: r,
    images: images.length ? images.map((i) => i.url) : [r.image_url].filter(Boolean),
    reviews,
    maintenance,
    completedBookings: Number(bookingsCount),
    availabilityBlocks,
    capabilities: jsonParse<string[]>(r.capabilities, []),
  };
}

/** Underused-resource identification, derived from real records only. */
export async function underusedForProvider(providerId: number) {
  const rows = await all<Row>(
    `SELECT r.*,
       (SELECT COUNT(*) FROM bookings b WHERE b.resource_id = r.id AND b.status IN
          ('pending','approved','awaiting_payment','paid','ready_for_handover','active','return_requested','disputed')) AS active_bookings,
       (SELECT COUNT(*) FROM bookings b WHERE b.resource_id = r.id AND b.status = 'completed') AS completed_bookings,
       (SELECT COALESCE(SUM(COALESCE(u.utilisation_pct,0)),0) FROM utilisation_snapshots u
          WHERE u.resource_id = r.id AND u.snapshot_date = (SELECT MAX(snapshot_date) FROM utilisation_snapshots WHERE resource_id = r.id)) AS utilisation_pct
     FROM resources r WHERE r.provider_id = ? ORDER BY utilisation_pct ASC`,
    providerId
  );
  // Explicit return type keeps the resource columns visible to callers alongside the derived fields.
  return rows.map((r: Row): Row & { idle_units: number; utilisation_pct: number; classification: string; estimate_note: string } => {
    const total = Number(r.quantity_total) || 0;
    const inUse = Number(r.quantity_active) || 0;
    const idle = Math.max(0, total - inUse);
    const pct = Number(r.utilisation_pct) || 0;
    const state = pct >= 55 ? "frequently_used" : pct >= 12 ? "underused" : Number(r.completed_bookings) === 0 ? "no_recent_bookings" : "underused";
    return {
      ...r,
      idle_units: idle,
      utilisation_pct: Math.round(pct * 10) / 10,
      classification: state,
      // Clear separation between estimated idleness and confirmed availability.
      estimate_note:
        idle > 0
          ? `${idle} of ${total} units are declared as not in internal use. This is an ESTIMATE — availability must be confirmed by the provider in the listing's availability calendar.`
          : "No estimated idle units recorded.",
    };
  });
}
