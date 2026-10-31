#!/usr/bin/env node
/**
 * RentLink 3D → Nestora rebranding.
 *
 * Deliberately NOT a blind global search/replace. It rewrites USER-FACING copy
 * only and leaves every technical identifier alone:
 *
 *   untouched: rl_session (cookie), rentlink.db (SQLite path), rentlink3d
 *              (Razorpay order notes), RENTLINK_ALLOW_INSECURE_PROD,
 *              RENTLINK_* document filenames, /api/* routes, table names,
 *              data/ and uploads/ paths, migration filenames.
 *
 * Run with --dry-run to list changes without writing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry-run");

const OLD = "RentLink 3D";
const NEW = "Nestora";

/** Files whose *content* is user-facing branding. */
const TARGETS = [
  "src/app",
  "src/components",
  "src/lib/recommend.ts",
  "src/lib/impact.ts",
  "src/lib/payments.ts",
  "src/lib/schema.sql",
  "src/lib/schema.pg.sql",
  "README.md",
  ".env.example",
  "docs/DEPLOYMENT.md",
  "package.json",
];

/** Lines that must never be rewritten even inside a target file. */
const PROTECTED = [
  /rentlink\.db/i,
  /rentlink3d/i,
  /rl_session/i,
  /RENTLINK_ALLOW_INSECURE_PROD/,
  /RENTLINK_[A-Z_]+\.md/,
  /data\/rentlink/i,
  /uploads\/rentlink/i,
];

function walk(p, out = []) {
  const abs = path.join(ROOT, p);
  if (!fs.existsSync(abs)) return out;
  const st = fs.statSync(abs);
  if (st.isFile()) {
    if (/\.(ts|tsx|sql|md|json|example|mjs)$/.test(p) || p === ".env.example") out.push(p);
    return out;
  }
  for (const e of fs.readdirSync(abs)) walk(path.join(p, e), out);
  return out;
}

let changed = 0;
const report = [];
for (const target of TARGETS.flatMap((t) => walk(t))) {
  const abs = path.join(ROOT, target);
  const original = fs.readFileSync(abs, "utf8");
  const lines = original.split("\n");
  let touched = false;
  const next = lines.map((line) => {
    // Two brand forms: "RentLink 3D" and the bare "RentLink" used in prose.
    if (!line.includes(OLD) && !line.includes("RentLink")) return line;
    if (PROTECTED.some((r) => r.test(line))) {
      // Rewrite only the brand token if the protected match is unrelated.
      if (/RENTLINK_[A-Z_]+\.md|RENTLINK_ALLOW_INSECURE_PROD/.test(line)) return line;
    }
    touched = true;
    return line.split(OLD).join(NEW).split("RentLink").join(NEW);
  });
  if (!touched) continue;
  const updated = next.join("\n");
  if (updated === original) continue;
  changed++;
  const count = (original.match(/RentLink/g) || []).length;
  report.push(`${String(count).padStart(3)}  ${target}`);
  if (!DRY) fs.writeFileSync(abs, updated);
}

report.sort().reverse();
console.log(report.join("\n"));
console.log(`\n${DRY ? "(dry run) would update" : "updated"} ${changed} files — "${OLD}" → "${NEW}"`);
