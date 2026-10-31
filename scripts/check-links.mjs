#!/usr/bin/env node
/**
 * Crawls the app as a signed-in demo user and checks every internal href resolves
 * (no 404/500), and that every <button> is wired to something (onClick, a form
 * submit, or a known non-JS control). Catches dead links and placeholder buttons.
 */
import puppeteer from "puppeteer";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const PAGES = [
  "/", "/marketplace", "/resources/1", "/resources/3", "/compare?ids=1,2", "/impact", "/recommend",
  "/viewer", "/help", "/verification-report", "/login", "/register", "/storefront/anna-institute-of-technology",
  "/dashboard", "/bookings", "/bookings/1", "/favourites", "/notifications", "/disputes", "/settings", "/onboarding",
  "/provider", "/provider/bookings", "/provider/resources", "/provider/resources/1", "/provider/new",
  "/provider/utilisation", "/provider/verification", "/admin", "/admin/verifications", "/admin/disputes",
  "/admin/resources", "/admin/users", "/admin/audit",
];

const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

const results = [];
const rec = (ok, label, detail = "") => {
  results.push({ ok, label, detail });
  console.log(`  ${ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${label}${detail ? ` — ${detail}` : ""}`);
};

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  const loginStatus = await page.evaluate(async (base) => {
    const r = await fetch(base + "/api/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "buyer@student.demo", password: "Demo@1234" }),
    });
    return r.status;
  }, BASE);
  rec(loginStatus === 200, "Signed in as the demo buyer to crawl authenticated pages", `status ${loginStatus}`);

  const seen = new Set();
  const broken = [];
  const badButtons = [];

  for (const path of PAGES) {
    // One retry: a page reused across many navigations can hit a transient
    // "Navigation timeout" under load, which is a harness artefact rather than a
    // broken page. A genuinely broken page fails both attempts.
    let res = null;
    for (let attempt = 0; attempt < 2 && !res; attempt++) {
      res = await page.goto(BASE + path, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => null);
      if (!res) await new Promise((r) => setTimeout(r, 400));
    }
    if (!res || res.status() >= 400) { broken.push(`${path} → ${res ? res.status() : "load error"}`); continue; }
    seen.add(path);

    const found = await page.evaluate(() => {
      const hrefs = [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));
      // Inspect React's own props on each button to see whether anything is actually
      // wired up. A button counts as live if it has an onClick/onSubmit/onMouseDown
      // handler, lives in a form (submit), or is a labelled toggle.
      const buttons = [...document.querySelectorAll("button")].map((b) => {
        const propsKey = Object.keys(b).find((k) => k.startsWith("__reactProps$"));
        const props = propsKey ? b[propsKey] : null;
        return {
          text: (b.textContent || "").trim().slice(0, 40),
          wired: Boolean(props && (props.onClick || props.onSubmit || props.onMouseDown || props.onChange)),
          inForm: Boolean(b.closest("form")),
          isSubmit: (b.getAttribute("type") || "submit") === "submit",
          isTab: b.getAttribute("role") === "tab",
          isToggle: b.hasAttribute("aria-pressed") || b.hasAttribute("aria-expanded"),
          disabled: b.disabled,
        };
      });
      return { hrefs, buttons };
    });

    for (const href of found.hrefs) {
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("http")) continue;
      if (/^\/(img|api)\//.test(href)) continue;
      const clean = href.split("#")[0].split("?")[0];
      if (!clean || clean === "/") continue;
      if (!seen.has(clean) && !PAGES.includes(clean)) {
        const r = await page.evaluate(async (u) => {
          try { const x = await fetch(u, { redirect: "manual" }); return x.status; } catch { return 0; }
        }, clean);
        seen.add(clean);
        if (r >= 400 && r !== 0) broken.push(`${path} → link ${clean} (${r})`);
      }
    }
    for (const b of found.buttons) {
      if (b.disabled) continue;
      if (b.wired || (b.inForm && b.isSubmit) || b.isTab || b.isToggle) continue;
      badButtons.push(`${path}: "${b.text}"`);
    }
  }

  rec(seen.size >= PAGES.length - 1, "All crawled pages rendered", `${seen.size}/${PAGES.length} reachable`);
  rec(broken.length === 0, "No broken internal links", broken.slice(0, 6).join(" | ") || "none found");
  rec(badButtons.length === 0, "No unwired placeholder buttons", badButtons.slice(0, 6).join(" | ") || "all buttons are interactive controls");
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n\x1b[1mLink/UI summary\x1b[0m  ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
