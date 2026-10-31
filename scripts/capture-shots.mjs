#!/usr/bin/env node
/**
 * Captures the desktop + mobile screenshots referenced by the verification report.
 * Writes into public/screenshots/ so they can be opened directly.
 */
import puppeteer from "puppeteer";
import fs from "node:fs";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const OUT = "public/screenshots";
fs.mkdirSync(OUT, { recursive: true });

const DESKTOP = [
  ["/", "01-landing"],
  ["/marketplace", "02-marketplace"],
  ["/resources/1", "03-listing-detail-3d"],
  ["/viewer", "04-3d-viewer"],
  ["/compare?ids=1,2", "05-compare"],
  ["/recommend", "06-recommend"],
  ["/impact", "07-impact"],
  ["/storefront/anna-institute-of-technology", "08-storefront"],
  ["/bookings/1", "09-booking-workspace"],
  ["/resources/1/passport", "10-equipment-passport"],
  ["/provider", "11-provider-dashboard"],
  ["/provider/utilisation", "12-utilisation"],
  ["/admin", "13-admin-overview"],
  ["/admin/verifications", "14-admin-verifications"],
  ["/verification-report", "15-verification-report"],
];
const MOBILE = [
  ["/", "m01-landing"],
  ["/marketplace", "m02-marketplace"],
  ["/resources/1", "m03-listing"],
  ["/viewer", "m04-3d-viewer"],
  ["/dashboard", "m05-dashboard"],
  ["/bookings", "m06-bookings"],
];

const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--force-device-scale-factor=1"],
});

async function signIn(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  return page.evaluate(async (base) => {
    const r = await fetch(base + "/api/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "buyer@student.demo", password: "Demo@1234" }),
    });
    return r.status;
  }, BASE);
}

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 950, deviceScaleFactor: 1 });
  await signIn(page);
  for (const [path, name] of DESKTOP) {
    await page.goto(BASE + path, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((r) => setTimeout(r, path.includes("viewer") || path === "/resources/1" ? 4000 : 900));
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log("desktop", name);
  }
  // Provider + admin views need their own sessions.
  await page.evaluate(async (base) => {
    await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "provider@anna.demo", password: "Demo@1234" }) });
  }, BASE);
  for (const [path, name] of [["/provider", "11-provider-dashboard"], ["/provider/utilisation", "12-utilisation"], ["/provider/bookings", "16-provider-bookings"]]) {
    await page.goto(BASE + path, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 900));
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log("desktop", name);
  }
  await page.evaluate(async (base) => {
    await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "admin@rentlink.demo", password: "Demo@1234" }) });
  }, BASE);
  for (const [path, name] of [["/admin", "13-admin-overview"], ["/admin/verifications", "14-admin-verifications"], ["/admin/disputes", "17-admin-disputes"]]) {
    await page.goto(BASE + path, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 900));
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log("desktop", name);
  }

  const mobile = await browser.newPage();
  await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await signIn(mobile);
  for (const [path, name] of MOBILE) {
    await mobile.goto(BASE + path, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((r) => setTimeout(r, path.includes("viewer") ? 4500 : 900));
    await mobile.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
    console.log("mobile", name);
  }
} finally {
  await browser.close();
}
console.log("done →", OUT);
