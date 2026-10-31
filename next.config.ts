import type { NextConfig } from "next";

/**
 * The largest request body the platform will deliver to a function.
 *
 * Vercel caps a serverless function's request body at 4.5 MB. Anything above
 * that is rejected by the platform BEFORE the application sees it, so an
 * application-level limit of 5 MB (the old value) meant users on the deployed
 * site got an opaque 413 from the edge instead of the app's own clear "file too
 * large" message.
 *
 * VERCEL_MAX_BODY_BYTES is set to the platform limit when the app detects it is
 * running on Vercel (see src/lib/uploadLimits.ts), so the app rejects oversized
 * files first, with a message the user can act on.
 */
const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // The preview environment proxies the dev server under a *.e2b.app host.
  allowedDevOrigins: ["*.e2b.app", "localhost", "127.0.0.1"],
  experimental: {
    // Matches the platform ceiling rather than exceeding it. Multiple-file
    // uploads (up to 6 per request) therefore have a per-file budget enforced in
    // application code — see src/lib/uploadLimits.ts.
    serverActions: { bodySizeLimit: "4mb" },
  },
  // Lint failures are NOT silently ignored. `next build` type-checks and the
  // separate `npm run lint` gate (see package.json `verify:full`) fails the run
  // on any error, so a red lint can never be merged behind a green build.
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
