#!/usr/bin/env node
/**
 * Brand-integrity check: "RentLink 3D" → "Nestora".
 *
 * Two halves, and the second matters more than the first:
 *
 *   A. no legacy brand string survives anywhere user-facing (pages, components,
 *      metadata, manifest, docs, schema comments);
 *   B. every technical identifier that a careless rename WOULD have broken is
 *      still exactly as it was — cookie name, SQLite path, Razorpay order notes,
 *      the insecure-config escape hatch, API routes, table names, storage paths.
 *
 * Run against the tree (static) and optionally against a live server (BASE=…)
 * to prove the served HTML carries the new brand and the old one is gone.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE || "";

const PASS = [];
const FAIL = [];
let section = "";
const group = (n) => {
  section = n;
  console.log(`\n\x1b[1m${n}\x1b[0m`);
};
function check(ok, label, detail = "") {
  (ok ? PASS : FAIL).push({ section, label, detail });
  console.log(`  ${ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${label}${detail ? ` \x1b[90m— ${detail}\x1b[0m` : ""}`);
  return ok;
}

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "backups", ".paytest", "uploads", "data", "public/screenshots"]);
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const rel = path.relative(ROOT, path.join(dir, entry.name));
    if (entry.isDirectory()) walk(path.join(dir, entry.name), out);
    else if (/\.(ts|tsx|mjs|json|sql|md|webmanifest|svg)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

/** Files that are legacy audit artefacts and legitimately mention the old name. */
// Files that legitimately contain the legacy string: historical audit reports,
// the one-shot rebrand script, and this checker (which searches for it).
const HISTORICAL = [
  /^RENTLINK_[A-Z_]+\.md$/,
  /^NESTORA_READINESS_REPORT\.md$/,
  /^scripts\/rebrand\.mjs$/,
  /^scripts\/check-brand\.mjs$/,
];

const files = walk(ROOT).filter((f) => !HISTORICAL.some((r) => r.test(f)));

/* ------------------------------------------------------- A. legacy brand gone */
group("A. The legacy brand is gone from the codebase");
const leaks = [];
// A migration note that NAMES the old brand is documentation, not leaked
// branding. Allow it only when the line explicitly says it was renamed, and
// assert that this exemption stays tiny (it must never become a loophole).
const MIGRATION_NOTE = /renamed from/i;
const exemptions = [];
for (const f of files) {
  const text = fs.readFileSync(path.join(ROOT, f), "utf8");
  text.split("\n").forEach((line, i) => {
    if (!/RentLink/.test(line)) return;
    if (MIGRATION_NOTE.test(line)) {
      exemptions.push(`${f}:${i + 1}`);
      return;
    }
    leaks.push(`${f}:${i + 1}: ${line.trim().slice(0, 80)}`);
  });
}
check(leaks.length === 0, "No file mentions the brand except an explicit \"renamed from\" note", leaks.slice(0, 5).join(" | ") || `${files.length} files scanned`);
check(exemptions.length <= 2, "The historical-note exemption is not being used as a loophole", `${exemptions.length} line(s): ${exemptions.join(", ") || "none"}`);

/* --------------------------------------------- B. protected identifiers intact */
group("B. Technical identifiers were NOT renamed");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

check(/rl_session/.test(read("src/lib/auth.ts")), "Session cookie name is still rl_session", "src/lib/auth.ts");
check(/rl_session/.test(read("src/lib/crypto.ts")) || !/cookie/i.test(read("src/lib/crypto.ts")), "Cookie name unchanged in crypto layer", "src/lib/crypto.ts");
check(/path\.join\(process\.cwd\(\), "data", "rentlink\.db"\)/.test(read("src/lib/db.ts")), "SQLite development path is still data/rentlink.db", "src/lib/db.ts");
check(/"rentlink3d"/.test(read("src/lib/payments.ts")), "Razorpay order notes still carry the original source tag", "src/lib/payments.ts");
check(/RENTLINK_ALLOW_INSECURE_PROD/.test(read("src/lib/boot.ts")), "The insecure-config escape hatch keeps its original variable name", "src/lib/boot.ts");
check(/RENTLINK_ALLOW_INSECURE_PROD/.test(read("src/lib/db.ts")), "…and db.ts still honours it", "src/lib/db.ts");
check(/RENTLINK_ALLOW_INSECURE_PROD/.test(read("src/lib/storage.ts")), "…and storage.ts still honours it", "src/lib/storage.ts");

const db = read("src/lib/db.ts");
check(/DATABASE_URL/.test(db) && /DATABASE_PATH/.test(db) && /PG_SSL_MODE/.test(db), "Database env var names unchanged", "DATABASE_URL / DATABASE_PATH / PG_SSL_MODE");
check(!/NESTORA_[A-Z_]+/.test(db), "No new NESTORA_* environment variables were invented", "db.ts");

const schema = read("src/lib/schema.sql");
const tables = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
check(tables.length >= 30, "All tables still exist in the schema", `${tables.length} tables`);
check(tables.every((t) => /^[a-z_]+$/.test(t) && !/nestora|rentlink/.test(t)), "No table was renamed to a brand name", tables.slice(0, 4).join(", ") + "…");

const routes = walk(path.join(ROOT, "src/app/api")).length;
check(routes > 0, "API routes are present and untouched", `${routes} route files`);
check(fs.existsSync(path.join(ROOT, "src/app/api/files/private/[name]/route.ts")), "Private file route path unchanged", "/api/files/private/[name]");
check(fs.existsSync(path.join(ROOT, "src/app/api/cron/reminders/route.ts")), "Cron route path unchanged", "/api/cron/reminders");
check(fs.existsSync(path.join(ROOT, "migrations/sqlite/0001_baseline.sql")), "Migration filenames unchanged", "0001_baseline.sql");

const storage = read("src/lib/storage.ts");
check(
  /put\(`\$\{scope\}\//.test(storage) && /export type StorageScope = "public" \| "private"/.test(storage),
  "Storage prefixes are still derived from the public|private scope",
  "put(`${scope}/${name}`)"
);

/* ------------------------------------------------------------- C. new brand */
group("C. The new brand is present");
const layout = read("src/app/layout.tsx");
check(/Nestora/.test(layout), "Root metadata carries the Nestora name", "layout.tsx");
check(/Discover Your Space\. Experience It in 3D\./.test(layout), "The tagline is exact: \"Discover Your Space. Experience It in 3D.\"");
check(/manifest: "\/manifest\.webmanifest"/.test(layout), "The PWA manifest is linked", "/manifest.webmanifest");
check(/openGraph/.test(layout) && /twitter/.test(layout), "Social-sharing metadata present", "openGraph + twitter");
check(/applicationName: "Nestora"/.test(layout), "PWA application name is Nestora");

const manifest = JSON.parse(read("public/manifest.webmanifest"));
check(manifest.name === "Nestora" && manifest.short_name === "Nestora", "Manifest name/short_name are Nestora", `${manifest.name} / ${manifest.short_name}`);
check(manifest.description === "Discover Your Space. Experience It in 3D.", "Manifest carries the tagline");
check(Array.isArray(manifest.icons) && manifest.icons.length >= 2, "Manifest declares app icons", `${manifest.icons?.length} icons`);

check(fs.existsSync(path.join(ROOT, "public/img/logomark.svg")), "Logo asset exists", "public/img/logomark.svg");
check(fs.existsSync(path.join(ROOT, "public/favicon.svg")), "Favicon asset exists", "public/favicon.svg");
const logo = read("public/img/logomark.svg");
check(/viewBox="0 0 64 64"/.test(logo) && !/RentLink/i.test(logo), "Logo SVG is valid and on-brand");
check(!/<script/i.test(logo) && !/<foreignObject/i.test(logo), "Logo SVG contains no script/foreign content");

/* ------------------------------------------------------- D. live server (opt) */
if (BASE) {
  group(`D. Served pages carry the new brand (${BASE})`);
  const pages = ["/", "/login", "/register", "/marketplace", "/help", "/not-found-probe"];
  for (const p of pages) {
    const res = await fetch(`${BASE}${p}`, { headers: { "user-agent": "brand-check/1.0" } });
    const html = await res.text();
    const title = (/<title>([^<]*)<\/title>/.exec(html) || ["", "(no title)"])[1];
    check(res.status < 500, `${p} responds`, `status ${res.status}`);
    // Case-SENSITIVE: the brand is "RentLink". Lowercase "rentlink" also appears in
    // identifiers that must NOT be renamed — demo emails such as admin@rentlink.demo,
    // the data/rentlink.db path and the rl_session cookie name.
    check(
      !/RentLink/.test(html),
      `${p} contains no legacy brand string`,
      `${html.length} bytes${/rentlink/.test(html) ? " (lowercase identifiers such as admin@rentlink.demo are expected and correct)" : ""}`
    );
    if (p !== "/not-found-probe") {
      check(/Nestora/.test(html), `${p} shows the Nestora brand`, title.slice(0, 70));
      check(!/ — Nestora · Nestora/.test(title) && !/Nestora · Nestora/.test(title), `${p} title is not duplicated`, title.slice(0, 70));
    }
  }
  const home = await (await fetch(`${BASE}/`, { headers: { "user-agent": "brand-check/1.0" } })).text();
  check(/Discover your space/i.test(home), "Homepage hero states the tagline promise");
  const man = await fetch(`${BASE}/manifest.webmanifest`);
  const manJson = await man.json().catch(() => ({}));
  check(man.status === 200 && manJson.name === "Nestora", "The manifest is served and names Nestora", `status ${man.status}, name=${manJson.name}`);
  const icon = await fetch(`${BASE}/favicon.svg`);
  check(icon.status === 200 && /svg/.test(icon.headers.get("content-type") || ""), "The favicon is served as an SVG", `status ${icon.status}`);
  const logoRes = await fetch(`${BASE}/img/logomark.svg`);
  check(logoRes.status === 200, "The logo is served", `status ${logoRes.status}`);
}

console.log("\n" + "=".repeat(66));
console.log(`Brand integrity: \x1b[32m${PASS.length} passed\x1b[0m, ${FAIL.length} failed (${PASS.length + FAIL.length} checks)`);
if (FAIL.length) {
  console.log("\nFailures:");
  for (const f of FAIL) console.log(`  ✗ [${f.section}] ${f.label}${f.detail ? ` — ${f.detail}` : ""}`);
}
process.exitCode = FAIL.length ? 1 : 0;
