import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // The preview environment proxies the dev server under a *.e2b.app host.
  allowedDevOrigins: ["*.e2b.app", "localhost", "127.0.0.1"],
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
  // Lint failures are NOT silently ignored. `next build` type-checks and the
  // separate `npm run lint` gate (see package.json `verify:full`) fails the run
  // on any error, so a red lint can never be merged behind a green build.
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
