import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

/**
 * ESLint (flat config) — lint failures are real failures.
 *
 * Nothing here is downgraded to "off" to make a build pass. `next build` used to
 * skip linting entirely (eslint.ignoreDuringBuilds); that is gone, so lint runs
 * as its own required gate in `npm run verify:full`.
 */
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "public/**",
      "data/**",
      "uploads/**",
      "coverage/**",
      "next-env.d.ts",
      "tsconfig.tsbuildinfo",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default config;
