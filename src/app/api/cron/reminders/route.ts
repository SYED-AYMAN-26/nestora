import { NextResponse } from "next/server";
import { sweepReminders } from "@/lib/lifecycle";
import { audit } from "@/lib/audit";

/**
 * Scheduled reminder sweep — collection, return and overdue notices.
 *
 * These notices used to be triggered as a side effect of an admin opening the
 * admin overview page, which means they only ever ran when a human happened to
 * look. On a deployed system that is silently broken: nobody is notified unless
 * an administrator browses the dashboard.
 *
 * This endpoint is what a Vercel cron job (see vercel.json) calls instead.
 *
 * Protection: `Authorization: Bearer $CRON_SECRET`, which is how Vercel signs
 * scheduled invocations. Without CRON_SECRET configured the endpoint stays
 * disabled (503) rather than becoming an unauthenticated write endpoint.
 *
 * Idempotency: sweepReminders() only inserts a notification when one for the
 * same booking+kind does not already exist, so an overlapping or retried cron
 * run cannot spam users.
 */
export const dynamic = "force-dynamic";

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  // Constant-time compare: the secret is short-lived but there is no reason to
  // leak it a byte at a time.
  if (token.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

async function run(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { ok: false, error: "Scheduled reminders are disabled: CRON_SECRET is not configured." },
      { status: 503 }
    );
  }
  if (!authorised(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }

  const started = Date.now();
  const result = await sweepReminders();
  const ms = Date.now() - started;

  await audit({
    actorId: null,
    actorEmail: "system:cron",
    action: "cron.reminders",
    entity: "notification",
    detail: { ...result, ms, source: "scheduled" },
  });

  return NextResponse.json({ ok: true, result, ms });
}

/** Vercel cron invokes a GET. */
export const GET = run;
/** Also POSTable so an external scheduler (or a manual run) can use it. */
export const POST = run;
