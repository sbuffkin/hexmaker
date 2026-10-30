#!/usr/bin/env node
/** Reproduces the renderCoordLabelsLayer layout-thrash regression (commit
 *  10475fd) and validates the read-then-write fix, at the real chult map's
 *  hex count, with and without a bg image. Headless Chromium — absolute ms
 *  differ from the user's machine but the thrash→batch ratio is the signal.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { withBrowser } from "/mnt/c/Users/markr/work/tools/chromium-driver/lib/browser.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const sandbox = path.join(here, "coord-label-thrash-bench.html");

const ITERS = 3;
const r = await withBrowser(async ({ page }) => {
  await page.goto(pathToFileURL(sandbox).href, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.title === "ready", { timeout: 10000 });
  const hexCount = await page.evaluate(() => window.__hexCount);
  const m = (which, bg) => page.evaluate((w, b, n) => window.__measure(w, b, n), which, bg, ITERS);
  return {
    hexCount,
    iters: ITERS,
    thrash_noBg: await m("thrash", false),
    batch_noBg: await m("batch", false),
    thrash_bg: await m("thrash", true),
    batch_bg: await m("batch", true),
    uncharted_noBg: await m("uncharted", false),
    uncharted_bg: await m("uncharted", true),
  };
});

const f = (n) => n.toFixed(1).padStart(9);
console.log(`\nrenderCoordLabelsLayer cost — hexes=${r.hexCount}, median of ${r.iters} (ms)\n`);
console.log(`                 no bg image     with bg image`);
console.log(`thrash (current) ${f(r.thrash_noBg)}      ${f(r.thrash_bg)}   ← regression`);
console.log(`batch  (fixed)   ${f(r.batch_noBg)}      ${f(r.batch_bg)}`);
console.log(`batch + uncharted ${f(r.uncharted_noBg)}      ${f(r.uncharted_bg)}   (the ? layer reuses the read positions)`);
console.log(`\nspeedup  no-bg: ${(r.thrash_noBg / r.batch_noBg).toFixed(1)}×   with-bg: ${(r.thrash_bg / r.batch_bg).toFixed(1)}×`);
console.log(`bg amplifies thrash by ${(r.thrash_bg / r.thrash_noBg).toFixed(1)}× (vs ${(r.batch_bg / r.batch_noBg).toFixed(1)}× when batched)\n`);
