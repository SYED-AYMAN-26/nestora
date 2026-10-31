/**
 * Row digests used by scripts/migrate-to-postgres.mjs to prove that a migration
 * copied the same VALUES, not merely the same number of rows.
 *
 * Extracted into a module so it can be tested directly (scripts/test-migration-
 * integrity.mjs) — a verification routine that cannot be shown to notice a
 * changed value is not a verification routine.
 */
import { createHash } from "node:crypto";

/** Normalises engine-specific types to comparable primitives. */
export function normalise(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "object") return JSON.parse(JSON.stringify(v));
  return v;
}

/**
 * Stable digest of every row and every column.
 *
 * Each row is serialised as sorted [column, value] pairs (so column ORDER cannot
 * hide a difference) and the row strings are sorted (so physical row order cannot
 * either). Every column of every row therefore contributes to the hash.
 */
export function digestRows(rows) {
  const h = createHash("sha256");
  const lines = rows
    .map((r) => JSON.stringify(Object.keys(r).sort().map((k) => [k, normalise(r[k])])))
    .sort();
  for (const line of lines) h.update(line);
  return h.digest("hex");
}
