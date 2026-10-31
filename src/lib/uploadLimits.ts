import { MAX_UPLOAD_BYTES } from "./constants";

/**
 * Upload budget, derived from where the app is running.
 *
 * There are three limits that matter and they are not the same number:
 *
 *   1. Vercel's serverless request body cap — 4.5 MB, enforced by the platform
 *      before any of our code runs. Exceeding it produces a 413 the user cannot
 *      understand, so the application must reject first.
 *   2. The per-file limit we advertise — MAX_UPLOAD_BYTES (5 MB) locally, where
 *      there is no platform cap.
 *   3. The per-request limit, because /api/uploads accepts up to 6 files.
 *
 * On Vercel the request budget wins: the app enforces a request-level total so
 * users get "that upload is too large, try fewer or smaller files" instead of an
 * opaque platform error.
 */

export const MULTIPART_OVERHEAD_BYTES = 128 * 1024;
/** Vercel's documented serverless payload ceiling, less a small safety margin. */
export const PLATFORM_BODY_LIMIT_BYTES = Math.floor(4.5 * 1024 * 1024) - MULTIPART_OVERHEAD_BYTES;

export const onServerless = Boolean(
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY
);

/** Largest single file we will accept. */
export const maxFileBytes = onServerless ? Math.min(MAX_UPLOAD_BYTES, PLATFORM_BODY_LIMIT_BYTES) : MAX_UPLOAD_BYTES;

/** Largest total payload we will accept for one upload request. */
export const maxRequestBytes = onServerless ? PLATFORM_BODY_LIMIT_BYTES : MAX_UPLOAD_BYTES * 6;

export function fileTooLargeMessage(bytes: number) {
  const mb = (bytes / 1048576).toFixed(1).replace(/\.0$/, "");
  return onServerless
    ? `That file is too large. This deployment accepts at most ${mb} MB per file (the platform caps a request at 4.5 MB).`
    : `File too large (max ${mb} MB).`;
}

export function requestTooLargeMessage(bytes: number) {
  const mb = (bytes / 1048576).toFixed(1).replace(/\.0$/, "");
  return `Those files total more than ${mb} MB. Upload fewer or smaller files in one request.`;
}

export function uploadLimitsReport() {
  return {
    serverless: onServerless,
    maxFileBytes,
    maxRequestBytes,
    note: onServerless
      ? "Per-file and per-request limits are held below the platform's 4.5 MB body cap."
      : "No platform body cap detected; local limits apply.",
  };
}
