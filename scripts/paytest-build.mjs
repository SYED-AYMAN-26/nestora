#!/usr/bin/env node
/**
 * Builds a runnable copy of the payment library for TESTS ONLY.
 *
 * The payment code is TypeScript with `@/…` path aliases. Rather than pulling in
 * a bundler, this transpiles the handful of modules involved into
 * .paytest/build/, rewriting aliases to relative paths and adding the .js
 * extensions Node's ESM loader needs. Production code is untouched.
 *
 * Every test that uses the build points DATABASE_PATH at its own throwaway
 * SQLite file, so production data is never touched.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, ".paytest", "build");

const MODULES = [
  "src/lib/db.ts",
  "src/lib/crypto.ts",
  "src/lib/booking.ts",
  "src/lib/audit.ts",
  "src/lib/payments.ts",
  "src/lib/env.ts",
  "src/lib/schema.generated.ts",
];

export function rewriteImports(source) {
  let out = source;
  // "@/lib/x" → "./x.js" (all modules are flattened into one directory)
  out = out.replace(/from\s+"@\/lib\/([^"]+)"/g, (_m, p) => `from "./${p}.js"`);
  // relative imports inside src/lib
  out = out.replace(/from\s+"\.\/([^"]+)"/g, (m, p) => (p.endsWith(".json") ? m : `from "./${p}.js"`));
  // type-only imports must be erased (Node can't resolve them at runtime)
  out = out.replace(/^import\s+type\s+[^;]+;\s*$/gm, "");
  out = out.replace(/import\s+\{([^}]*)\}\s+from/g, (m, inner) => {
    const names = inner
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !s.startsWith("type "));
    return names.length ? `import { ${names.join(", ")} } from` : `import { } from`;
  });
  return out;
}

export function build() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  for (const rel of MODULES) {
    const abs = path.join(ROOT, rel);
    const js = execFileSync(
      path.join(ROOT, "node_modules/.bin/tsc"),
      [abs, "--outDir", "/tmp/paytest-tsc", "--target", "es2022", "--module", "es2022",
       "--moduleResolution", "bundler", "--skipLibCheck", "--allowJs", "false"],
      { encoding: "utf8" }
    );
    void js;
    const base = path.basename(rel).replace(/\.ts$/, ".js");
    const from = path.join("/tmp/paytest-tsc", rel.replace(/^src\/lib\//, "").replace(/\.ts$/, ".js"));
    const source = fs.existsSync(from)
      ? fs.readFileSync(from, "utf8")
      : fs.readFileSync(path.join("/tmp/paytest-tsc", base), "utf8");
    fs.writeFileSync(path.join(OUT, base), rewriteImports(source));
  }
  // The schema now ships as a generated TS module (schema.generated.ts) and is
  // in MODULES above, so nothing has to be read from disk at runtime.
  fs.writeFileSync(path.join(OUT, "package.json"), JSON.stringify({ type: "module" }, null, 2));
  console.log("payment test build ready:", path.relative(ROOT, OUT));
  return OUT;
}

if (import.meta.url === `file://${process.argv[1]}`) build();
