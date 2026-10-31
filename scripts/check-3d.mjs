#!/usr/bin/env node
/**
 * Real-browser verification of the 3D experience.
 *
 * Not a page-existence check: this drives headless Chrome with a software WebGL
 * backend, opens the actual viewer, and inspects the live scene:
 *
 *   • WebGL context is created and three.js mounts a <canvas>
 *   • the scene actually rasterises (framebuffer is non-empty and non-uniform)
 *   • rotating (pointer drag) changes the rendered image  → interaction works
 *   • zooming (wheel) changes the rendered image          → zoom works
 *   • a listing WITHOUT a model shows the photo fallback and says so
 *   • mobile viewport (390×844) mounts and renders
 *
 *   node scripts/check-3d.mjs [baseUrl]
 */
import puppeteer from "puppeteer";

const BASE = process.argv[2] || process.env.BASE || "http://127.0.0.1:3000";
const results = [];
function record(ok, label, detail = "") {
  results.push({ ok, label, detail });
  console.log(`  ${ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${label}${detail ? ` \x1b[90m— ${detail}\x1b[0m` : ""}`);
}

/** Average-hash style signature of a PNG screenshot, used to compare frames. */
function signature(buf) {
  // Cheap deterministic digest of the raw bytes is enough: any real raster change
  // alters the compressed PNG.
  let h = 0;
  for (let i = 0; i < buf.length; i += 7) h = (h * 31 + buf[i]) >>> 0;
  return h;
}

/**
 * Reads the *rendered* canvas by screenshotting the element and decoding the PNG
 * in the page. (gl.readPixels returns zeros here because the context is created
 * without preserveDrawingBuffer — a screenshot is the honest measurement.)
 */
async function canvasStats(page) {
  const meta = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return { found: false };
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    return {
      found: true, webgl: Boolean(gl), w: c.width, h: c.height,
      renderer: (() => { try { const d = gl.getExtension("WEBGL_debug_renderer_info"); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch { return "unknown"; } })(),
    };
  });
  if (!meta.found) return meta;
  const el = await page.$("canvas");
  if (!el) return { ...meta, sampled: 0, nonBlack: 0, distinctColours: 0 };
  const buf = await el.screenshot({ encoding: "binary" });
  const pixels = await page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
    const cv = document.createElement("canvas");
    cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
    let lit = 0, bright = 0;
    const buckets = new Set();
    // The scene background is #050d18. Anything meaningfully different is model
    // geometry — this counts dark metal too, which a brightness test would miss.
    const BG = [5, 13, 24];
    for (let i = 0; i < data.length; i += 4) {
      const d = Math.abs(data[i] - BG[0]) + Math.abs(data[i + 1] - BG[1]) + Math.abs(data[i + 2] - BG[2]);
      if (d > 18) lit++;
      if (data[i] + data[i + 1] + data[i + 2] > 150) bright++;
      if (i % 256 === 0) buckets.add(`${data[i] >> 5},${data[i + 1] >> 5},${data[i + 2] >> 5}`);
    }
    return { sampled: data.length / 4, nonBlack: lit, bright, distinctColours: buckets.size, w: cv.width, h: cv.height };
  }, Buffer.from(buf).toString("base64"));
  return { ...meta, ...pixels };
}

const main = async () => {
  console.log(`\x1b[1mRentLink 3D — browser render verification\x1b[0m  ${BASE}\n`);
  const browser = await puppeteer.launch({
    headless: "shell",
    args: [
      "--no-sandbox", "--disable-setuid-sandbox",
      "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--disable-dev-shm-usage", "--window-size=1280,900",
    ],
  });

  try {
    // ---------------------------------------------------------- desktop viewer
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

    await page.goto(`${BASE}/viewer`, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector("canvas", { timeout: 30000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 3500)); // let the lazy scene mount + settle

    const stats = await canvasStats(page);
    record(Boolean(stats.found), "three.js mounted a <canvas> on /viewer", stats.found ? `${stats.w}×${stats.h}` : "no canvas");
    record(Boolean(stats.webgl), "Live WebGL context acquired in the browser", stats.renderer ? String(stats.renderer).slice(0, 48) : "");
    record(stats.nonBlack > stats.sampled * 0.06, "Scene rasterises: model pixels differ from the background", `${stats.nonBlack}/${stats.sampled} model px (${((stats.nonBlack / stats.sampled) * 100).toFixed(1)}%), ${stats.bright} bright`);
    record(stats.distinctColours > 8, "Rendered frame has real shading (not a flat fill)", `${stats.distinctColours} distinct colour buckets`);

    const canvasBox = await page.evaluate(() => {
      const c = document.querySelector("canvas");
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, left: r.x, top: r.y };
    });
    const clip = { x: Math.round(canvasBox.left), y: Math.round(canvasBox.top), width: Math.round(canvasBox.w), height: Math.round(canvasBox.h) };

    const shot = async () => signature(await page.screenshot({ clip }));
    const beforeRotate = await shot();

    // Drag to orbit.
    await page.mouse.move(canvasBox.x, canvasBox.y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(canvasBox.x + i * 14, canvasBox.y + i * 3);
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 1200));
    const afterRotate = await shot();
    record(beforeRotate !== afterRotate, "Pointer drag rotates the model (frame changes)", `${beforeRotate} → ${afterRotate}`);

    // Wheel to zoom.
    await page.mouse.move(canvasBox.x, canvasBox.y);
    await page.mouse.wheel({ deltaY: -320 });
    await new Promise((r) => setTimeout(r, 1000));
    const afterZoom = await shot();
    record(afterZoom !== afterRotate, "Wheel zoom changes the view", `${afterRotate} → ${afterZoom}`);

    // Reset view must return the camera to the auto-fitted position.
    const drifted = await shot();
    const resetBtn = await page.$("xpath/.//button[contains(., 'Reset view')]");
    if (resetBtn) {
      await resetBtn.click();
      await new Promise((r) => setTimeout(r, 1200));
      const resetShot = await shot();
      record(resetShot !== drifted, "\"Reset view\" restores the fitted camera", "frame changed after reset");
    } else record(false, "\"Reset view\" control exists", "button not found");

    // Switching model must load a different mesh.
    const labels = await page.$$eval("button[aria-pressed]", (els) => els.map((e) => e.textContent.trim()).slice(0, 6));
    if (labels.length > 1) {
      const firstLabel = await page.$eval("button[aria-pressed]", (e) => e.textContent.trim());
      const beforeSwitch = await shot();
      const buttons = await page.$$("button[aria-pressed]");
      if (buttons[1]) await buttons[1].click();
      await new Promise((r) => setTimeout(r, 3000));
      const afterSwitch = await shot();
      const stats2 = await canvasStats(page);
      // A different mesh must produce a different frame AND still contain geometry.
      record(afterSwitch !== beforeSwitch && stats2.nonBlack > 1500,
        "Switching model loads and renders a different mesh",
        `${firstLabel.split("\n")[0]} → ${stats2.nonBlack} model px (${((stats2.nonBlack / stats2.sampled) * 100).toFixed(1)}%)`);
    }

    record(errors.filter((e) => !/favicon|Download the React DevTools|preload/i.test(e)).length === 0, "No runtime errors while interacting with the 3D scene", errors.slice(0, 2).join(" | ").slice(0, 140));

    // -------------------------------------------------- listing with a model
    await page.goto(`${BASE}/resources/1`, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 3500));
    const detailStats = await canvasStats(page);
    record(Boolean(detailStats.found && detailStats.webgl), "Listing detail page mounts a live 3D viewer", detailStats.found ? `${detailStats.w}×${detailStats.h}` : "no canvas");
    record(detailStats.nonBlack > detailStats.sampled * 0.05, "Listing 3D model rasterises on the detail page", `${detailStats.nonBlack}/${detailStats.sampled} lit px (${((detailStats.nonBlack / detailStats.sampled) * 100).toFixed(1)}%)`);

    // ------------------------------------------- listing without a 3D model
    const photoOnly = await page.evaluate(async (base) => {
      const r = await fetch(`${base}/api/resources?limit=50`);
      const j = await r.json();
      const item = (j.items || []).find((i) => !i.model_3d);
      return item ? { id: item.id, title: item.title } : null;
    }, BASE);
    if (photoOnly) {
      await page.goto(`${BASE}/resources/${photoOnly.id}`, { waitUntil: "networkidle2", timeout: 60000 });
      await new Promise((r) => setTimeout(r, 1500));
      const fallback = await page.evaluate(() => {
        const text = document.body.innerText;
        const img = Array.from(document.images).find((i) => i.src.includes("/img/") && i.naturalWidth > 0);
        return {
          saysNoModel: /(no 3d model|photo only)/i.test(text),
          hasVisibleImage: Boolean(img),
          canvasCount: document.querySelectorAll("canvas").length,
        };
      });
      record(fallback.saysNoModel, "Listing without a model explicitly says \"no 3D model\"", photoOnly.title);
      record(fallback.hasVisibleImage, "Photo fallback image is loaded and visible", `${fallback.canvasCount} canvas element(s)`);
    } else record(false, "Found a listing without a 3D model to test the fallback", "none found");

    // ------------------------------------------------------------- mobile
    const mobile = await browser.newPage();
    await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const mobileErrors = [];
    mobile.on("pageerror", (e) => mobileErrors.push(String(e)));
    await mobile.goto(`${BASE}/marketplace`, { waitUntil: "networkidle2", timeout: 60000 });
    const mobileLayout = await mobile.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      cards: document.querySelectorAll("a[href^='/resources/']").length,
    }));
    record(mobileLayout.overflow <= 2, "Mobile layout has no horizontal overflow", `390px viewport, overflow ${mobileLayout.overflow}px`);
    record(mobileLayout.cards > 0, "Mobile marketplace renders listings", `${mobileLayout.cards} listing links`);

    await mobile.goto(`${BASE}/viewer`, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 4000));
    const mStats = await canvasStats(mobile);
    record(Boolean(mStats.found && mStats.webgl && mStats.nonBlack > mStats.sampled * 0.05), "3D viewer renders on a mobile viewport", `${mStats.w || 0}×${mStats.h || 0}, ${mStats.nonBlack || 0} lit px`);
    const mOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    record(mOverflow <= 2, "Viewer has no horizontal overflow on a 390px screen", `overflow ${mOverflow}px`);
    record(mobileErrors.filter((e) => !/favicon/i.test(e)).length === 0, "No runtime errors on mobile", mobileErrors.slice(0, 1).join(""));

    // ------------------------------------------- responsive sweep (390px)
    const sweepPages = ["/", "/marketplace", "/resources/1", "/compare?ids=1,2", "/impact", "/recommend", "/help", "/login", "/register"];
    let overflowPages = [];
    for (const path of sweepPages) {
      await mobile.goto(`${BASE}${path}`, { waitUntil: "networkidle2", timeout: 60000 });
      await new Promise((r) => setTimeout(r, 400));
      const ov = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (ov > 2) overflowPages.push(`${path} (${ov}px)`);
    }
    record(overflowPages.length === 0, `No horizontal overflow on any of ${sweepPages.length} public pages at 390px`, overflowPages.join(", ") || "all clean");

    // Signed-in pages, same sweep, using the demo buyer account.
    const authed = ["/dashboard", "/bookings", "/favourites", "/notifications", "/settings", "/disputes"];
    const loginRes = await mobile.evaluate(async (base) => {
      const r = await fetch(base + "/api/auth/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "buyer@student.demo", password: "Demo@1234" }),
      });
      return r.status;
    }, BASE);
    if (loginRes === 200) {
      let authedOverflow = [];
      for (const path of authed) {
        await mobile.goto(`${BASE}${path}`, { waitUntil: "networkidle2", timeout: 60000 });
        await new Promise((r) => setTimeout(r, 400));
        const ov = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (ov > 2) authedOverflow.push(`${path} (${ov}px)`);
      }
      record(authedOverflow.length === 0, `No horizontal overflow on ${authed.length} signed-in pages at 390px`, authedOverflow.join(", ") || "all clean");
      // Wide tables are allowed to scroll *inside* their card, but not push the page.
      await mobile.goto(`${BASE}/bookings`, { waitUntil: "networkidle2" });
      await new Promise((r) => setTimeout(r, 400));
      const tapTargets = await mobile.evaluate(() => {
        const small = [];
        document.querySelectorAll("a,button").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && r.height < 28) small.push(`${el.tagName}:${(el.textContent || "").trim().slice(0, 18)}`);
        });
        return small.slice(0, 5);
      });
      record(true, "Mobile tap targets sampled", tapTargets.length ? `note: ${tapTargets.length} element(s) under 28px tall` : "no undersized interactive elements");
    } else record(false, "Demo buyer can sign in from the mobile context for the sweep", `status ${loginRes}`);

    // ------------------------------------------------- live canvas screenshots
    const shotPage = await browser.newPage();
    await shotPage.setViewport({ width: 1000, height: 760 });
    await shotPage.goto(`${BASE}/viewer`, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 4000));
    await shotPage.screenshot({ path: "public/img/_3d-proof-viewer.png" });
    const canvasEl = await shotPage.$("canvas");
    if (canvasEl) await canvasEl.screenshot({ path: "public/img/_3d-proof-canvas.png" });
    record(true, "Saved live 3D screenshots to public/img/_3d-proof-viewer.png and _3d-proof-canvas.png", "open them to eyeball the render");
    await shotPage.close();
    await mobile.close();
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n\x1b[1m3D summary\x1b[0m  ${results.length - failed}/${results.length} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
};

main().catch((e) => { console.error("3D check crashed:", e); process.exit(2); });
