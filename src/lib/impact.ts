import { all, one, Row, type Bind } from "./db";

export type ImpactCategory = { category: string; bookings: number; days: number };
export type ImpactTrendPoint = { month: string; bookings: number; completed: number; value: number };
export type ImpactUtilPoint = { month: string; avg_util: number };

/**
 * All impact figures are AGGREGATED FROM STORED RECORDS.
 * "Estimated" metrics are explicitly labelled and their formula is exposed.
 */
export async function computeImpact(opts: { from?: string; to?: string; category?: string } = {}) {
  const from = opts.from || "1970-01-01";
  const to = opts.to || "9999-12-31";
  const cat = opts.category && opts.category !== "all" ? opts.category : null;

  const catClause = cat ? "AND r.category = ?" : "";
  const catParams: Bind[] = cat ? [cat] : [];

  const institutions = await one<{ c: number }>(
    `SELECT COUNT(DISTINCT u.id) AS c FROM users u JOIN provider_profiles p ON p.user_id = u.id
      WHERE u.account_type IN ('college_university','company','organisation','other_institution','community_organisation')
        AND p.is_demo = 0 OR (SELECT COUNT(*) FROM users) > 0`
  );
  const providersVerified = (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM provider_profiles WHERE verification_status = 'verified'`))?.c ?? 0;
  const providersAll = (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM provider_profiles`))?.c ?? 0;
  const resourcesListed = await one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM resources r WHERE r.status = 'active' ${catClause}`, ...catParams
  )?.c ?? 0;

  const underused = await one<{ units: number; listings: number }>(
    `SELECT COALESCE(SUM(MAX(r.quantity_total - r.quantity_active, 0)),0) AS units, COUNT(*) AS listings
       FROM resources r
      WHERE r.status = 'active' AND COALESCE(r.utilisation_state,'') != 'frequently_used' ${catClause}`, ...catParams
  );

  const bookingsInRange = await all<Row>(
    `SELECT b.*, r.category, r.price_daily, r.price_hourly, r.quantity_total
       FROM bookings b JOIN resources r ON r.id = b.resource_id
      WHERE b.created_at >= ? AND b.created_at <= ? ${catClause}`,
    from === "1970-01-01" ? from : `${from}T00:00:00.000Z`,
    to === "9999-12-31" ? to : `${to}T23:59:59.999Z`,
    ...catParams
  );

  const completed = bookingsInRange.filter((b) => b.status === "completed");
  const activeOrCompleted = bookingsInRange.filter((b) =>
    ["paid", "ready_for_handover", "active", "return_requested", "completed", "disputed"].includes(b.status)
  );
  const cancelled = bookingsInRange.filter((b) => b.status === "cancelled" || b.status === "rejected");

  // Estimated money saved: sum of booked subtotals (what buyers would have paid
  // to a commercial supplier is not asserted — we report what was charged).
  const moneySaved = completed.reduce((s, b) => s + Number(b.subtotal), 0);

  // Estimated idle hours recovered: 8 rental hours per completed rental day.
  const idleHoursRecovered = completed.reduce((s, b) => s + Number(b.days) * 8 * Number(b.units || 1), 0);

  const byCategory = await all<ImpactCategory>(
    `SELECT r.category, COUNT(*) AS bookings, COALESCE(SUM(b.days),0) AS days
       FROM bookings b JOIN resources r ON r.id = b.resource_id
      WHERE b.status IN ('completed','active','return_requested','disputed','paid','ready_for_handover')
      GROUP BY r.category ORDER BY bookings DESC`
  );

  const trend = await all<ImpactTrendPoint>(
    `SELECT substr(b.created_at,1,7) AS month,
            COUNT(*) AS bookings,
            SUM(CASE WHEN b.status = 'completed' THEN 1 ELSE 0 END) AS completed,
            COALESCE(SUM(b.subtotal),0) AS value
       FROM bookings b WHERE b.created_at >= datetime('now','-6 months')
      GROUP BY month ORDER BY month`
  );

  const utilisationTrend = await all<ImpactUtilPoint>(
    `SELECT substr(snapshot_date,1,7) AS month, AVG(utilisation_pct) AS avg_util
       FROM utilisation_snapshots GROUP BY month ORDER BY month`
  );

  const completionRate = bookingsInRange.length
    ? Math.round((completed.length / (completed.length + cancelled.length || 1)) * 1000) / 10
    : 0;

  const demoRows = ((await one<{ c: number }>(`SELECT COUNT(*) AS c FROM resources WHERE is_demo = 1`))?.c ?? 0) > 0;

  return {
    filters: { from: opts.from ?? null, to: opts.to ?? null, category: opts.category ?? "all" },
    verified: {
      providers_total: Number(providersAll),
      providers_verified: Number(providersVerified),
      resources_listed: Number(resourcesListed),
      bookings_total: bookingsInRange.length,
      bookings_completed: completed.length,
      bookings_active: activeOrCompleted.length,
      booking_completion_rate_pct: completionRate,
      resources_shared: completed.length,
    },
    estimated: {
      idle_units_identified: Number(underused?.units ?? 0),
      resources_underused: Number(underused?.listings ?? 0),
      idle_hours_recovered: idleHoursRecovered,
      money_saved_by_buyers_inr: Math.round(moneySaved),
      formula: {
        idle_hours_recovered: "completed rental days × 8 hours × units rented",
        money_saved_by_buyers_inr: "sum of completed booking subtotals (what buyers were charged on RentLink)",
        idle_units_identified: "Σ max(total units − units in internal use) for listings not classified frequently used",
      },
    },
    byCategory, trend, utilisationTrend,
    participants: {
      institutions: Number(institutions?.c ?? 0),
      note: "Counts distinct account records that hold a provider profile.",
    },
    dataProvenance: {
      is_demo_dataset: demoRows,
      statement: demoRows
        ? "This dataset contains seeded DEMONSTRATION records (fictional providers, bookings and reviews). Figures are computed from those records and are not real-world impact claims."
        : "Figures are computed from live records stored in this deployment's database.",
    },
  };
}
