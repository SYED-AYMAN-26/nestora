/**
 * Demo-data environment policy.
 *
 * Every seeded account is fictional and shares one password. That is fine for a
 * demo/laptop deployment and dangerous in public production, so two switches
 * exist:
 *
 *   ALLOW_DEMO_SEED=1   explicitly acknowledge that demo accounts are live.
 *   DEMO_PASSWORD=...   seed with a password other than the documented default.
 *
 * With neither set, a production deployment refuses to seed demo data and
 * refuses to sign in any demo account that still uses the default password.
 */

export const DEFAULT_DEMO_PASSWORD = "Demo@1234";

export function demoSeedingAllowed() {
  const v = (process.env.ALLOW_DEMO_SEED ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function demoPassword() {
  return process.env.DEMO_PASSWORD || DEFAULT_DEMO_PASSWORD;
}

export function isProduction() {
  return process.env.NODE_ENV === "production";
}

/**
 * True when this deployment would be handing out a publicly-known credential.
 *
 * Only the DOCUMENTED default is refused — an operator who sets DEMO_PASSWORD to
 * something unguessable has genuinely fixed the problem, so that password is
 * allowed. (Blocking it too was a bug: it made a secure demo unusable.)
 */
export function demoLoginBlocked(isDemoUser: boolean, usedPassword: string) {
  if (!isDemoUser) return false;
  if (!isProduction()) return false;
  if (demoSeedingAllowed()) return false;
  if (demoPassword() !== DEFAULT_DEMO_PASSWORD) return false; // customised → not a known credential
  return usedPassword === DEFAULT_DEMO_PASSWORD;
}
