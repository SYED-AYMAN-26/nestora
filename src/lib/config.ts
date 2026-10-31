/**
 * Production environment validation, executed once per server start.
 *
 * The purpose is to fail LOUDLY and EARLY on a misconfigured deployment —
 * especially on Vercel, where a missing SESSION_SECRET used to mean each lambda
 * minted its own secret (writing to a read-only filesystem), so sessions broke
 * at random and nothing in the logs said why.
 *
 * This module only DESCRIBES problems. Enforcement — throwing so that an unsafe
 * process never serves traffic — lives in src/lib/boot.ts, which is called from
 * src/instrumentation.ts at process start. Nothing here throws during
 * `next build`: the build environment legitimately has no runtime secrets.
 */
import { isProduction } from "./env";

export type ConfigProblem = { level: "fatal" | "warning"; key: string; message: string };

const MIN_SECRET_LEN = 32;

function isSet(key: string): boolean {
  const v = process.env[key];
  return typeof v === "string" && v.trim().length > 0;
}

/** Every variable this application reads, with why it matters. */
export function configReport(): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const prod = isProduction();

  /* ------------------------------------------------------------- database */
  if (!isSet("DATABASE_URL")) {
    problems.push({
      level: prod ? "fatal" : "warning",
      key: "DATABASE_URL",
      message:
        "Not set, so the app falls back to the local SQLite file. A serverless filesystem is read-only and ephemeral: writes fail and data is lost. Production must point at PostgreSQL.",
    });
  } else if (prod && !/^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL!)) {
    // Anything that is not a PostgreSQL URL is not a database this app can use
    // in production; a `file:`/`sqlite:` URL must never silently mean "local disk".
    problems.push({
      level: "fatal",
      key: "DATABASE_URL",
      message:
        "Is not a PostgreSQL connection string (expected postgres:// or postgresql://). A file/SQLite URL cannot be used by a serverless deployment.",
    });
  } else if (prod && /^postgres(ql)?:\/\/[^/]*@(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL!)) {
    problems.push({
      level: "fatal",
      key: "DATABASE_URL",
      message: "Points at localhost. On Vercel localhost is the lambda itself, not your database.",
    });
  }

  /* --------------------------------------------------------------- secrets */
  if (!isSet("SESSION_SECRET")) {
    problems.push({
      level: prod ? "fatal" : "warning",
      key: "SESSION_SECRET",
      message:
        "Not set. On a serverless deployment there is no writable disk to persist a generated secret, so every instance would derive a different one and sessions would be invalidated unpredictably.",
    });
  } else if (prod && process.env.SESSION_SECRET!.length < MIN_SECRET_LEN) {
    problems.push({
      level: "fatal",
      key: "SESSION_SECRET",
      message: `Shorter than ${MIN_SECRET_LEN} characters. Generate one with: openssl rand -hex 32`,
    });
  }

  /* -------------------------------------------------------------- payments */
  const razorpayKeys = ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"];
  const anyRazorpay = razorpayKeys.some(isSet);
  if (anyRazorpay && !razorpayKeys.every(isSet)) {
    const missing = razorpayKeys.filter((k) => !isSet(k));
    problems.push({
      level: "fatal",
      key: missing.join(", "),
      message: "Razorpay is partially configured. Either set all three variables or none (demo mode).",
    });
  }
  if (prod && !anyRazorpay) {
    problems.push({
      level: "warning",
      key: "RAZORPAY_KEY_ID",
      message:
        "No gateway credentials: the app runs in clearly-labelled DEMO payment mode. No money moves. Set all three Razorpay variables to accept real payments.",
    });
  }
  if (isSet("RAZORPAY_KEY_ID") && !/^rzp_(test|live)_/.test(process.env.RAZORPAY_KEY_ID!)) {
    problems.push({
      level: "warning",
      key: "RAZORPAY_KEY_ID",
      message: "Does not look like a Razorpay key id (expected an rzp_test_… or rzp_live_… prefix).",
    });
  }

  /* --------------------------------------------------------------- storage */
  if (prod && !isSet("BLOB_READ_WRITE_TOKEN")) {
    problems.push({
      level: "fatal",
      key: "BLOB_READ_WRITE_TOKEN",
      message:
        "Uploads are written to the local filesystem. On a serverless deployment that filesystem is read-only, so every photo and every private verification document fails to save. Configure a Vercel Blob store (or set S3_* / R2_* and adapt src/lib/storage.ts).",
    });
  }

  /* ------------------------------------------------------------ transporter */
  if (prod && !isSet("RESEND_API_KEY") && !isSet("SMTP_URL")) {
    problems.push({
      level: "warning",
      key: "RESEND_API_KEY",
      message:
        "No email provider configured: notifications are stored in the database and shown in-app only. Nothing is emailed.",
    });
  }

  /* -------------------------------------------------------- demo accounts */
  const allowDemo = ["1", "true", "yes"].includes(String(process.env.ALLOW_DEMO_SEED ?? "").toLowerCase());
  if (prod && allowDemo) {
    problems.push({
      level: "warning",
      key: "ALLOW_DEMO_SEED",
      message:
        "Demo seeding is ENABLED in a production build. Every demo account shares one password, including an admin. Unset this for a real deployment.",
    });
  }
  if (prod && allowDemo && !isSet("DEMO_PASSWORD")) {
    problems.push({
      level: "fatal",
      key: "DEMO_PASSWORD",
      message: "ALLOW_DEMO_SEED is on but the documented default demo password is unchanged — that is a public admin login.",
    });
  }

  /* --------------------------------------------------------------- cron */
  if (prod && !isSet("CRON_SECRET")) {
    problems.push({
      level: "warning",

      key: "CRON_SECRET",
      message:
        "Not set: the scheduled reminder endpoint is disabled, so collection/return reminders never run. Set CRON_SECRET and a Vercel cron job to enable it.",
    });
  } else if (isSet("CRON_SECRET") && process.env.CRON_SECRET!.length < 16) {
    problems.push({
      level: "warning",
      key: "CRON_SECRET",
      message: "Shorter than 16 characters.",
    });
  }

  return problems;
}
