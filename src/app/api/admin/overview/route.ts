import { guard, ok, fail } from "@/lib/http";
import { requireAdmin } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { listAudit } from "@/lib/audit";
import { sweepReminders } from "@/lib/lifecycle";
import { CATEGORIES } from "@/lib/constants";

export const GET = guard(async () => {
  const auth = await requireAdmin();
  if (!auth.ok) return fail(auth.error, auth.code);

  const counts = {
    users: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM users`))?.c ?? 0,
    providers: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM provider_profiles`))?.c ?? 0,
    verifiedProviders: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM provider_profiles WHERE verification_status = 'verified'`))?.c ?? 0,
    pendingVerifications: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM verification_requests WHERE status = 'pending'`))?.c ?? 0,
    resources: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM resources`))?.c ?? 0,
    activeResources: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM resources WHERE status = 'active'`))?.c ?? 0,
    bookings: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM bookings`))?.c ?? 0,
    pendingBookings: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM bookings WHERE status = 'pending'`))?.c ?? 0,
    activeRentals: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM bookings WHERE status = 'active'`))?.c ?? 0,
    openDisputes: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM disputes WHERE status IN ('open','evidence_requested','under_review')`))?.c ?? 0,
    openReports: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM reports WHERE status = 'open'`))?.c ?? 0,
    paymentsPaid: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM payments WHERE status = 'paid'`))?.c ?? 0,
    refunds: (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM payments WHERE kind = 'refund'`))?.c ?? 0,
  };

  // These four were left un-awaited by the async migration: a Promise inside a
  // returned object serialises as `{}`, so the admin dashboard silently received
  // empty lists instead of data. Awaited explicitly here.
  const [recentBookings, recentPayments, categories, settings] = await Promise.all([
    all<Record<string, unknown>>(
      `SELECT b.id, b.code, b.status, b.start_date, b.end_date, b.total, r.title AS resource_title,
              p.display_name AS provider_name, u.full_name AS buyer_name, b.created_at
         FROM bookings b JOIN resources r ON r.id = b.resource_id JOIN provider_profiles p ON p.id = b.provider_id
         JOIN users u ON u.id = b.buyer_id ORDER BY b.created_at DESC LIMIT 15`
    ),
    all<Record<string, unknown>>(
      `SELECT pay.*, b.code FROM payments pay JOIN bookings b ON b.id = pay.booking_id ORDER BY pay.id DESC LIMIT 15`
    ),
    all<Record<string, unknown>>(`SELECT * FROM categories ORDER BY sort_order`),
    all<Record<string, unknown>>(`SELECT * FROM settings`),
  ]);

  return ok({
    counts,
    recentBookings,
    recentPayments,
    audit: await listAudit(40),
    categories,
    taxonomy: CATEGORIES,
    settings,
  });
});

/** Admin-only maintenance: run the reminder sweep (collection / return / overdue). */
export const POST = guard(async () => {
  const auth = await requireAdmin();
  if (!auth.ok) return fail(auth.error, auth.code);
  const result = await sweepReminders();
  return ok({ result, message: `Reminders sent: ${result.collections} collection, ${result.returns} return, ${result.overdue} overdue alerts.` });
});
