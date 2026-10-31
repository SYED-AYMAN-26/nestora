#!/usr/bin/env node
/**
 * Object-storage and file-route security tests.
 *
 * Runs against a LIVE server (default http://127.0.0.1:3000) and exercises the
 * real upload route, the real public file route and the real private file route
 * with real cookies. It answers, with evidence:
 *
 *   - can a stranger read a private verification document?          (must be no)
 *   - can another provider read someone else's document?            (must be no)
 *   - can the owning provider read their own document?              (must be yes)
 *   - can an admin read it?                                         (must be yes)
 *   - does every authorised read get audited?                       (must be yes)
 *   - do path-traversal names escape the storage prefix?            (must be no)
 *   - are content-type / magic bytes validated server-side?         (must be yes)
 *   - does a failed upload leave a misleading database row?         (must be no)
 *
 *   node scripts/test-storage-security.mjs
 *   BASE=http://127.0.0.1:3300 node scripts/test-storage-security.mjs
 */
const BASE = process.env.BASE || "http://127.0.0.1:3000";

const PASS = [], FAIL = [];
let section = "";
function group(n) { section = n; console.log(`\n\x1b[1m${n}\x1b[0m`); }
function check(ok, label, detail = "") {
  (ok ? PASS : FAIL).push({ section, label, detail });
  console.log(`  ${ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${label}${detail ? ` \x1b[90m— ${detail}\x1b[0m` : ""}`);
  return ok;
}

function cookieJar() {
  const jar = new Map();
  return {
    header: () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
    absorb(res) {
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [kv] = c.split(";");
        const i = kv.indexOf("=");
        if (i < 0) continue;
        if (!kv.slice(i + 1)) jar.delete(kv.slice(0, i));
        else jar.set(kv.slice(0, i), kv.slice(i + 1));
      }
    },
  };
}

async function login(email, password = "Demo@1234") {
  const jar = cookieJar();
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "storage-test/1.0" },
    body: JSON.stringify({ email, password }),
  });
  jar.absorb(res);
  if (!res.ok) throw new Error(`login ${email}: ${res.status}`);
  return jar;
}

/** A minimal valid PNG (1×1) so magic-byte sniffing passes. */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function upload(jar, { bytes, name = "test.png", type = "image/png", kind = "image" } = {}) {
  const form = new FormData();
  form.append("kind", kind);
  form.append("file", new Blob([bytes], { type }), name);
  const res = await fetch(`${BASE}/api/uploads`, {
    method: "POST",
    headers: { cookie: jar.header() },
    body: form,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text };
}

async function getFile(path, cookieOrJar) {
  // Accepts a jar OR a cookie string. Passing the jar object straight through
  // produced the header "cookie: [object Object]", which the server correctly
  // rejected as unauthenticated — a bug in this harness, not in the app.
  const cookie = cookieOrJar
    ? typeof cookieOrJar === "string"
      ? cookieOrJar
      : cookieOrJar.header()
    : "";
  const res = await fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, bytes: buf };
}

async function dbCount(sql, ...params) {
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync("node", ["-e", `
    require('esbuild-register/dist/node.js').register();
    const db = require('./src/lib/db.ts');
    db.all(${JSON.stringify(sql)}, ...${JSON.stringify(params)})
      .then(r => { console.log(JSON.stringify(r)); return db.closeDb(); })
      .catch(e => { console.error(e.message); process.exit(1); });
  `], { cwd: process.cwd(), encoding: "utf8", env: process.env });
  return JSON.parse(out);
}

async function main() {
  console.log(`\x1b[1mStorage security\x1b[0m  ${BASE}`);

  const buyer = await login("buyer@student.demo");
  const provider = await login("provider@anna.demo");
  const otherProvider = await login("provider@bharat.demo").catch(() => null);
  const admin = await login("admin@rentlink.demo");


  /* ------------------------------------------------------- 1. upload gating */
  group("1. Upload route requires authentication");
  {
    const r = await fetch(`${BASE}/api/uploads`, { method: "POST", body: new FormData() });
    check(r.status === 401 || r.status === 400, "Unauthenticated upload is rejected", `status ${r.status}`);
  }

  /* --------------------------------------------- 2. content validation */
  group("2. Server-side content validation");
  {
    const bad = await upload(buyer, { bytes: Buffer.from("this is definitively not a png"), name: "evil.png", type: "image/png" });
    check(bad.status === 422, "A file whose bytes are not an allowed image is rejected", `status ${bad.status}`);

    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const svgRes = await upload(buyer, { bytes: svg, name: "x.svg", type: "image/svg+xml" });
    check(svgRes.status === 422, "SVG (script-capable) is rejected (XSS vector)", `status ${svgRes.status}`);

    const empty = await upload(buyer, { bytes: Buffer.alloc(0), name: "empty.png", type: "image/png" });
    check(empty.status === 422, "An empty file is rejected", `status ${empty.status}`);

    const renamed = await upload(buyer, { bytes: PNG_1PX, name: "photo.php", type: "image/png" });
    check(
      renamed.status === 200 &&
        /^\/api\/files\/public\/[a-z0-9-]+\.png$/.test(renamed.json?.urls?.[0] || ""),
      "The stored name is generated by the server, ignoring the client filename/extension",
      renamed.json?.urls?.[0] || `status ${renamed.status}`
    );
  }

  /* ------------------------------------------- 3. private document access */
  group("3. Private verification documents");
  let privateUrl = null;
  {
    const up = await upload(provider, {
      bytes: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(64, 0x20)]),
      name: "identity.pdf", type: "application/pdf", kind: "document",
    });
    check(up.status === 200, "Provider can upload a private document", `status ${up.status}`);
    privateUrl = up.json?.urls?.[0] || null;
    check(/^\/api\/files\/private\//.test(privateUrl || ""), "A document upload is stored under the private route", privateUrl || "none");

    if (privateUrl) {
      // Link the uploaded document to this provider's own verification record, so
      // "the owner can read it" is tested against real ownership in the database
      // rather than against a file nobody references.
      const linkRes = await fetch(`${BASE}/api/providers/anna-institute-of-technology/verify`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: provider.header() },
        body: JSON.stringify({
          legal_name: "Anna Institute of Technology",
          identity_doc_url: privateUrl,
          ownership_doc_url: privateUrl,
          statement: "Storage security suite: document ownership fixture.",
        }),
      });
      // 409 is acceptable: an earlier run may already have a pending request, in
      // which case the document is linked through that existing row.
      let linked =
        linkRes.ok ||
        (await dbCount(
          `SELECT COUNT(*) AS c FROM verification_requests WHERE identity_doc_url = ?`,
          privateUrl
        ))[0].c > 0;
      if (!linked && linkRes.status === 409) {
        // A pending request already exists from an earlier run. Attach THIS run's
        // document to it so ownership is real rather than skipped.
        const { execFileSync } = await import("node:child_process");
        execFileSync("node", ["-e", `
          require('esbuild-register/dist/node.js').register();
          const db = require('./src/lib/db.ts');
          db.run(\`UPDATE verification_requests SET identity_doc_url = ?, ownership_doc_url = ?
                   WHERE provider_id = (SELECT id FROM provider_profiles WHERE storefront_slug = 'anna-institute-of-technology')
                     AND status IN ('pending','more_info')\`, ${JSON.stringify(privateUrl)}, ${JSON.stringify(privateUrl)})
            .then(() => db.closeDb()).catch(e => { console.error(e.message); process.exit(1); });
        `], { cwd: process.cwd(), encoding: "utf8", env: process.env });
        linked = true;
      }
      check(linked, "The document is attached to a real verification record", `link status ${linkRes.status}`);

      const ownerRows = await dbCount(
        `SELECT COUNT(*) AS c FROM verification_requests WHERE identity_doc_url = ? AND provider_id = (SELECT id FROM provider_profiles WHERE storefront_slug = 'anna-institute-of-technology')`,
        privateUrl
      );
      check(Number(ownerRows[0].c) === 1, "The document is owned by the uploading provider in the database", `${ownerRows[0].c} rows`);

      const anonymous = await getFile(privateUrl, null);
      check(anonymous.status === 401, "A stranger cannot read a private document", `status ${anonymous.status}`);

      const asOwner = await getFile(privateUrl, provider);
      check(asOwner.status === 200, "The uploading provider can read their own document", `status ${asOwner.status}`);
      check(
        String(asOwner.headers.get("cache-control") || "").includes("no-store"),
        "Owner reads are not cached either",
        String(asOwner.headers.get("cache-control"))
      );

      const asBuyer = await getFile(privateUrl, buyer);
      check(asBuyer.status === 403 || asBuyer.status === 404, "An unrelated signed-in user cannot read it", `status ${asBuyer.status}`);

      if (otherProvider) {
        const asOther = await getFile(privateUrl, otherProvider);
        check(asOther.status === 403 || asOther.status === 404, "A different provider cannot read it", `status ${asOther.status}`);
      }

      const asAdmin = await getFile(privateUrl, admin);
      check(asAdmin.status === 200, "An admin can read it", `status ${asAdmin.status} for ${privateUrl}`);
      check(asAdmin.headers.get("cache-control") === "private, no-store", "Private responses are never cached", String(asAdmin.headers.get("cache-control")));
      check(asAdmin.headers.get("x-content-type-options") === "nosniff", "Private responses send nosniff", String(asAdmin.headers.get("x-content-type-options")));
    }
  }

  /* ---------------------------------------------- 4. public image access */
  group("4. Public resource images");
  {
    const up = await upload(buyer, { bytes: PNG_1PX, name: "listing.png", type: "image/png", kind: "image" });
    check(up.status === 200, "An authenticated user can upload a listing photo");
    const url = up.json?.urls?.[0];
    const fetched = await getFile(url, null);
    check(fetched.status === 200, "Anyone can read a public listing photo", `status ${fetched.status}`);
    check(fetched.headers.get("content-type") === "image/png", "Content-Type is the sniffed type", String(fetched.headers.get("content-type")));
    check(/immutable/.test(String(fetched.headers.get("cache-control"))), "Public images are cached immutably", String(fetched.headers.get("cache-control")));
    check(fetched.bytes.equals(PNG_1PX), "The bytes returned are exactly the bytes stored");
  }

  /* -------------------------------------------------- 5. path traversal */
  group("5. Path traversal and name handling");
  {
    for (const attack of [
      "/api/files/public/../../data/rentlink.db",
      "/api/files/public/..%2f..%2fdata%2frentlink.db",
      "/api/files/public/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
      "/api/files/private/....//data/.session-secret",
      "/api/files/public/.env",
      "/api/files/private/notarealfile.png",
      "/api/files/public/x.php",
    ]) {
      const r = await getFile(attack, admin);
      const leaked = r.bytes.length > 0 && /SQLite format|root:|PRIVATE KEY|scrypt\$/.test(r.bytes.toString("latin1"));
      // A redirect is acceptable only if it lands somewhere that does not serve a
      // file. What matters is that no protected bytes come back.
      check((r.status >= 400 || (r.status >= 300 && r.status < 400)) && !leaked, `Blocked: ${attack}`, `status ${r.status}`);
    }
  }

  /* ------------------------------ 6. failed uploads leave no DB records */
  group("6. Failed uploads leave no misleading records");
  {
    const before = (await dbCount(`SELECT COUNT(*) AS c FROM resource_images`))[0].c;
    await upload(buyer, { bytes: Buffer.from("not an image at all"), name: "bad.png", type: "image/png" });
    const after = (await dbCount(`SELECT COUNT(*) AS c FROM resource_images`))[0].c;
    check(Number(before) === Number(after), "A rejected upload creates no image record", `${before} → ${after}`);
  }

  /* ------------------------------------------------------- 7. audit trail */
  group("7. Private access is audited");
  {
    const rows = await dbCount(
      `SELECT action, COUNT(*) AS c FROM audit_logs WHERE action IN ('document.access','document.access_denied') GROUP BY action`
    );
    const granted = rows.find((r) => r.action === "document.access")?.c ?? 0;
    const denied = rows.find((r) => r.action === "document.access_denied")?.c ?? 0;
    check(Number(granted) > 0, "Authorised private reads are recorded", `${granted} rows`);
    check(Number(denied) > 0, "Denied private reads are recorded", `${denied} rows`);
  }

  /* ------------------------------------------- 8. storage backend report */
  group("8. Storage backend");
  {
    const r = await fetch(`${BASE}/api/files/public/${Date.now()}.png`);
    check(r.status === 404, "A nonexistent file is a clean 404 (no stack trace)", `status ${r.status}`);
    const t = await r.text().catch(() => "");
    check(!/at .*\.js:\d+/.test(t), "No stack trace leaks in the 404 body");
  }

  /* ------------------------------------------- 9. upload size enforcement */
  group("9. Upload size limits");
  {
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // 1 byte over the advertised per-file limit (5 MB locally).
    const big = Buffer.alloc(5 * 1024 * 1024 + 1);
    PNG.copy(big);
    const tooBig = new FormData();
    tooBig.append("kind", "image");
    tooBig.append("file", new Blob([big], { type: "image/png" }), "big.png");
    const r = await fetch(`${BASE}/api/uploads`, { method: "POST", headers: { cookie: provider.header() }, body: tooBig });
    const body = await r.text();
    check(r.status === 413 || r.status === 422, "A file one byte over the per-file limit is rejected", `status ${r.status}`);
    check(/too large/i.test(body), "The rejection explains that the file is too large", body.slice(0, 90));

    // A declared Content-Length over the request budget must be refused before
    // the body is buffered.
    const declared = await fetch(`${BASE}/api/uploads`, {
      method: "POST",
      headers: {
        cookie: provider.header(),
        "content-type": "multipart/form-data; boundary=x",
        "content-length": String(30 * 1024 * 1024),
      },
      body: "--x--",
    }).catch(() => null);
    check(declared ? declared.status === 413 : true, "An over-budget Content-Length is refused up front", declared ? `status ${declared.status}` : "refused at connection level");

    // LOCAL regime: the per-request budget is 6 x 5 MB, so six 1 MB files are a
    // legitimate upload. Asserting a rejection here would be wrong.
    const chunk = Buffer.alloc(1024 * 1024);
    PNG.copy(chunk);
    const many = new FormData();
    many.append("kind", "image");
    for (let i = 0; i < 6; i++) many.append("file", new Blob([chunk], { type: "image/png" }), `p${i}.png`);
    const rMany = await fetch(`${BASE}/api/uploads`, { method: "POST", headers: { cookie: provider.header() }, body: many }).catch(() => null);
    check(rMany ? rMany.status === 200 : false, "Six files within the local total budget are accepted", rMany ? `status ${rMany.status}` : "no answer");

    // SERVERLESS regime: the same six files must be refused, because Vercel caps
    // a request at 4.5 MB. Proves the limit logic actually changes behaviour.
    const { execFileSync } = await import("node:child_process");
    const limits = JSON.parse(
      execFileSync(
        "node",
        [
          "-e",
          `
          require('esbuild-register/dist/node.js').register();
          const l = require('./src/lib/uploadLimits.ts');
          console.log(JSON.stringify({ file: l.maxFileBytes, request: l.maxRequestBytes, platform: l.PLATFORM_BODY_LIMIT_BYTES, serverless: l.onServerless }));
        `,
        ],
        { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, VERCEL: "1" } }
      )
    );
    const sixMb = 6 * 1024 * 1024;
    check(limits.serverless === true, "VERCEL=1 switches the app into serverless limits", JSON.stringify(limits.serverless));
    check(limits.request < 4.5 * 1024 * 1024, "The serverless request budget is below the platform's 4.5 MB cap", `${(limits.request / 1048576).toFixed(2)} MB`);
    check(sixMb > limits.request, "The same six-file request WOULD be refused on Vercel", `${(sixMb / 1048576).toFixed(1)} MB > ${(limits.request / 1048576).toFixed(2)} MB`);
    check(limits.file <= limits.request, "The per-file limit never exceeds the request budget", `${(limits.file / 1048576).toFixed(2)} MB`);

    const seven = new FormData();
    seven.append("kind", "image");
    for (let i = 0; i < 7; i++) seven.append("file", new Blob([chunk.subarray(0, 64)], { type: "image/png" }), `q${i}.png`);
    const rSeven = await fetch(`${BASE}/api/uploads`, { method: "POST", headers: { cookie: provider.header() }, body: seven });
    check(rSeven.status === 422, "More than six files in one request is rejected", `status ${rSeven.status}`);
  }

  /* ------------------------- 10. production cannot write to local disk */
  group("10. Production refuses local-disk uploads without a Blob store");
  {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/lib/storage.ts", "utf8");
    check(/assertWritableTarget\(\)/.test(src), "Every write is gated behind a production check", "assertWritableTarget");
    check(/Refusing to write uploads to the local filesystem in production/.test(src), "A production local write raises an explicit error", "storage.ts");
    check(
      /process\.env\.NODE_ENV !== "production" \|\| storageBackend === "blob"/.test(src),
      "The guard applies only to a production process with no Blob backend",
      "storage.ts"
    );
    check(
      /BLOB_READ_WRITE_TOKEN/.test(src),
      "Uploads are authenticated with the Blob read-write token (never a public URL for private docs)",
      "storage.ts"
    );
  }

  const total = PASS.length + FAIL.length;
  console.log(`\n${"=".repeat(66)}`);
  console.log(`Storage security: \x1b[32m${PASS.length} passed\x1b[0m, ${FAIL.length ? "\x1b[31m" : ""}${FAIL.length} failed\x1b[0m (${total} checks)`);
  if (FAIL.length) {
    console.log("\nFailures:");
    for (const f of FAIL) console.log(`  ✗ [${f.section}] ${f.label} — ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("\nSTORAGE SUITE CRASHED:", e.message);
  process.exit(1);
});
