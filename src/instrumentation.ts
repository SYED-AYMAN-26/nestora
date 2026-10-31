/**
 * Next.js server instrumentation — runs once per server process, before the
 * first request is served (Node.js runtime only).
 *
 * This is where production configuration is ENFORCED (not merely logged): a
 * fatal misconfiguration throws, so an unsafe process never handles traffic.
 * That is the difference between "fail-fast" and "log a fatal line and degrade".
 *
 * Two entry points on purpose: `register()` is the documented hook, and
 * `assertProductionConfigReady()` is called from the root layout as a
 * belt-and-braces guard for runtimes/builds where instrumentation is not wired
 * in. Both funnel through the same idempotent enforcement.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { enforceProductionConfig } = await import("./lib/boot");
  enforceProductionConfig();
}

/**
 * Ensures the boot gate has run in this process. Safe to call on every request:
 * enforcement happens once, and it throws every time an unsafe configuration is
 * still present.
 */
export async function assertProductionConfigReady(): Promise<void> {
  const { enforceProductionConfig } = await import("./lib/boot");
  enforceProductionConfig();
}
