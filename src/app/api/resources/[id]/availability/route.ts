import { guard, ok, fail } from "@/lib/http";
import { one, all } from "@/lib/db";
import { checkAvailability, unitsBookedOn, quote } from "@/lib/booking";

/**
 * Public availability + pricing quote for a resource over a date range.
 * Availability is always computed from server-side booking records.
 */
export const GET = guard(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const resourceId = Number(id);
  const res = await one(`SELECT * FROM resources WHERE id = ?`, resourceId);
  if (!res) return fail("Resource not found", 404);

  const from = url.searchParams.get("from") || new Date().toISOString().slice(0, 10);
  const monthsParam = Math.min(6, Math.max(1, Number(url.searchParams.get("months") || 2)));

  // Month grid for the calendar UI
  const startDate = new Date(from + "T00:00:00Z");
  const endDate = new Date(startDate);
  endDate.setUTCMonth(endDate.getUTCMonth() + monthsParam);

  const capacity = Math.max(0, Number(res.quantity_total) - Number(res.quantity_active));
  const dayCursor = new Date(startDate);
  const calendar: { date: string; capacity: number; booked: number; available: number; blocked: boolean }[] = [];
  const blocks = new Set(
    (await all<{ date: string }>(`SELECT date FROM resource_availability WHERE resource_id = ? AND status != 'available'`, resourceId)).map((b) => b.date)
  );
  for (const m of await all<{ start_date: string; end_date: string | null }>(
    `SELECT start_date, end_date FROM maintenance_records WHERE resource_id = ? AND (end_date IS NULL OR end_date >= ?)`,
    resourceId, startDate.toISOString().slice(0, 10)
  )) {
    const s = new Date(m.start_date + "T00:00:00Z");
    const e = new Date((m.end_date || m.start_date) + "T00:00:00Z");
    for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) blocks.add(d.toISOString().slice(0, 10));
  }
  while (dayCursor < endDate) {
    const date = dayCursor.toISOString().slice(0, 10);
    const booked = await unitsBookedOn(resourceId, date);
    const blocked = blocks.has(date);
    calendar.push({ date, capacity, booked, available: blocked ? 0 : Math.max(0, capacity - booked), blocked });
    dayCursor.setUTCDate(dayCursor.getUTCDate() + 1);
  }

  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const units = Number(url.searchParams.get("units") || 1);
  const basis = (url.searchParams.get("basis") as "hourly" | "daily" | "weekly") || "daily";
  let check = null;
  let price = null;
  if (start && end) {
    check = await checkAvailability(resourceId, start, end, units);
    price = quote(res, start, end, units, basis);
  }
  return ok({
    resourceId,
    capacity,
    calendar,
    check,
    quote: price,
    pricing: {
      hourly: res.price_hourly, daily: res.price_daily, weekly: res.price_weekly,
      deposit: res.deposit, minDays: res.min_hours, maxDays: res.max_days,
    },
  });
});
