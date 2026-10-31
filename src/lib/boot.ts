/**
 * Production boot gate — the fail-fast half of src/lib/config.ts.
 *
 * `configReport()` only DESCRIBES problems. This module ENFORCES the ones that
 * make a production deployment unsafe or non-functional. It is called from
 * `instrumentation.ts`, which Next.js runs once per server process before the
 * first request, so a misconfigured deployment refuses to serve traffic at all
 * instead of logging a line and quietly degrading.
 *
 * Design rules
 * ------------
 *  - Only genuinely unsafe/unserviceable conditions are fatal. A missing email
 *    provider or payment gateway is a warning: the app has a clearly-labelled
 *    degraded path for both (in-app notifications, DEMO payments).
 *  - Error messages name the VARIABLE, never its value, so a bad deploy cannot
 *    leak a secret into build logs, function logs or an error page.
 *  - Nothing here runs during `next build`: the build environment legitimately
 *    has no runtime secrets. It runs on the first process start in a real
 *    deployment, which is the earliest moment enforcement is meaningful.
 *  - Every rejection can be deliberately bypassed with
 *    `RENTLINK_ALLOW_INSECURE_PROD=1`, which exists only so an operator who
 *    truly needs a throwaway demo deployment is not locked out. The bypass is
 *    itself reported as a warning, so it can never be silent.
 */
import { configReport, type ConfigProblem } from "./config";

export class InsecureProductionConfigError extends Error {
  readonly problems: ConfigProblem[];
  constructor(problems: ConfigProblem[]) {
    // Values are never interpolated — only keys and reasons.
    super(
      "Refusing to start: production configuration is unsafe.\n" +
        problems.map((p) => `  - ${p.key}: ${p.message}`).join("\n") +
        "\nSet the variables above, or set RENTLINK_ALLOW_INSECURE_PROD=1 to override (not recommended)."
    );
    this.name = "InsecureProductionConfigError";
    this.problems = problems;
  }
}

/**
 * `next build` runs with NODE_ENV=production but has no runtime secrets, and it
 * prerenders pages — which would trip the gate and break the build. Enforcement
 * therefore starts only once the build phase is over. `next start` and Vercel
 * functions do not set this phase, so they are still gated.
 */
const isBuildPhase = () => process.env.NEXT_PHASE === "phase-production-build";

const bypassed = () =>
  ["1", "true", "yes"].includes(String(process.env.RENTLINK_ALLOW_INSECURE_PROD ?? "").toLowerCase());

let enforced = false;

/**
 * Throws when the process must not serve traffic. Idempotent: the report is
 * emitted once per process.
 */
export function enforceProductionConfig(): void {
  if (isBuildPhase()) return;
  const problems = configReport();
  const fatal = problems.filter((p) => p.level === "fatal");
  const warnings = problems.filter((p) => p.level === "warning");

  if (!enforced) {
    enforced = true;
    for (const w of warnings) console.warn(`[config] WARN ${w.key}: ${w.message}`);
    // Logged once per process; the throw below still happens on every call.
    for (const f of fatal) console.error(`[config] FATAL ${f.key}: ${f.message}`);
  }
  if (!fatal.length) return;

  if (bypassed()) {
    console.error(
      "[config] RENTLINK_ALLOW_INSECURE_PROD is set: continuing with an unsafe configuration. " +
        "This deployment must not be treated as production-ready."
    );
    return;
  }
  throw new InsecureProductionConfigError(fatal);
}
