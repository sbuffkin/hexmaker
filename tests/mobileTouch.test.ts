import { test } from "node:test";
import assert from "node:assert/strict";
import { LongPress, pinchFrame, pinchStep, MAX_ZOOM, MIN_ZOOM } from "../src/hex-map/pinchStep";
import { bodyPlatform, DESKTOP_ONLY_FEATURES, featureAvailable, featureUnavailableReason } from "../src/platform";
import { escapeBarePipes, splitBarePipes, stripTrailingBarePipe } from "../src/barePipes";
import { readSize } from "../src/worldgen/cellReaders";
import { parseClimateRange } from "../src/overworld/biomeClimate";

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test("pinchFrame: distance and map-relative midpoint", () => {
  const f = pinchFrame({ x: 110, y: 220 }, { x: 150, y: 280 }, { left: 10, top: 20 });
  close(f.dist, 72.11102550927978);
  assert.equal(f.mx, 120);
  assert.equal(f.my, 230);
});

test("pinchStep: spreading fingers zooms in about the midpoint", () => {
  const prev = { dist: 100, mx: 200, my: 150 };
  const cur = { dist: 200, mx: 200, my: 150 };
  const r = pinchStep(prev, cur, { zoom: 1, panX: 0, panY: 0 });
  assert.equal(r.zoom, 2);
  // the map point under the midpoint stays under it
  assert.equal(r.panX, -200);
  assert.equal(r.panY, -150);
});

test("pinchStep: a moving midpoint pans, no zoom change", () => {
  const r = pinchStep({ dist: 80, mx: 100, my: 100 }, { dist: 80, mx: 130, my: 90 }, { zoom: 1.5, panX: 5, panY: 5 });
  assert.equal(r.zoom, 1.5);
  assert.equal(r.panX, 35);
  assert.equal(r.panY, -5);
});

test("pinchStep: clamped to the wheel-zoom limits, pan follows the real factor", () => {
  const big = pinchStep({ dist: 10, mx: 0, my: 0 }, { dist: 1000, mx: 0, my: 0 }, { zoom: 4, panX: 0, panY: 0 });
  assert.equal(big.zoom, MAX_ZOOM);
  const small = pinchStep({ dist: 1000, mx: 0, my: 0 }, { dist: 10, mx: 0, my: 0 }, { zoom: 0.5, panX: 0, panY: 0 });
  assert.equal(small.zoom, MIN_ZOOM);
});

test("pinchStep: degenerate finger distance only pans", () => {
  const r = pinchStep({ dist: 0, mx: 0, my: 0 }, { dist: 50, mx: 10, my: 0 }, { zoom: 2, panX: 0, panY: 0 });
  assert.equal(r.zoom, 2);
  assert.equal(r.panX, 10);
});

function fakeTimers() {
  let fn: (() => void) | null = null;
  let ms = 0;
  let cleared = 0;
  return {
    setTimer: (f: () => void, m: number) => { fn = f; ms = m; return 1; },
    clearTimer: () => { cleared++; fn = null; },
    fire: () => fn?.(),
    get ms() { return ms; },
    get cleared() { return cleared; },
    get armed() { return fn !== null; },
  };
}

test("LongPress: fires once after 500ms where the finger went down", () => {
  const t = fakeTimers();
  const hits: [number, number][] = [];
  const lp = new LongPress({ onFire: (x, y) => hits.push([x, y]), setTimer: t.setTimer, clearTimer: t.clearTimer });
  lp.start(40, 60);
  assert.equal(t.ms, 500);
  assert.equal(lp.move(43, 62), true); // inside the slop
  t.fire();
  assert.deepEqual(hits, [[40, 60]]);
  assert.equal(lp.fired, true);
  assert.equal(lp.move(200, 200), false);
});

test("LongPress: wandering past the slop or lifting cancels it", () => {
  const t = fakeTimers();
  let n = 0;
  const lp = new LongPress({ onFire: () => n++, setTimer: t.setTimer, clearTimer: t.clearTimer });
  lp.start(0, 0);
  assert.equal(lp.move(30, 0), false);
  assert.equal(t.armed, false);
  t.fire();
  assert.equal(n, 0);
  lp.start(0, 0);
  lp.end();
  t.fire();
  assert.equal(n, 0);
  assert.equal(lp.fired, false);
});

test("platform gate: PDF is desktop-app only", () => {
  assert.equal(featureAvailable("pdf", { isMobile: false, isDesktopApp: true }), true);
  assert.equal(featureAvailable("pdf", { isMobile: true, isDesktopApp: false }), false);
  // emulateMobile(true) on desktop: still isDesktopApp, but isMobile
  assert.equal(featureAvailable("pdf", { isMobile: true, isDesktopApp: true }), false);
  assert.equal(featureUnavailableReason("pdf", { isMobile: false, isDesktopApp: true }), null);
  assert.equal(featureUnavailableReason("pdf", { isMobile: true, isDesktopApp: false }), DESKTOP_ONLY_FEATURES.pdf);
});

test("bodyPlatform: reads Obsidian's is-mobile body class", () => {
  const body = (cls: string[]) => ({ classList: { contains: (c: string) => cls.includes(c) } });
  assert.equal(featureAvailable("pdf", bodyPlatform(body(["theme-dark"]))), true);
  assert.equal(featureAvailable("pdf", bodyPlatform(body(["is-mobile", "is-phone"]))), false);
});

test("barePipes: same results as the lookbehind regexes they replaced", () => {
  const samples = ["a|b|c", "a\\|b|c", "|x||y|", "no pipes", "[[p\\|N]] | z \\|", "\\|", "a\\\\|b", ""];
  for (const s of samples) {
    assert.deepEqual(splitBarePipes(s), s.split(new RegExp("(?<!\\\\)\\|")), s);
    assert.equal(escapeBarePipes(s), s.replace(new RegExp("(?<!\\\\)\\|", "g"), "\\|"), s);
    assert.equal(stripTrailingBarePipe(s), s.replace(new RegExp("(?<!\\\\)\\|$"), ""), s);
  }
});

test("readSize / parseClimateRange still parse after the lookbehind removal", () => {
  assert.deepEqual(readSize("20x14"), readSize("20×14"));
  assert.deepEqual(readSize("20 x 14"), readSize("20 by 14"));
  assert.ok(readSize("20x14"));
  assert.equal(readSize("axb"), undefined);
  const words: [string, number, number][] = [["cold", 0, 0.3], ["warm", 0.3, 0.6], ["hot", 0.6, 1]];
  assert.deepEqual(parseClimateRange("cold-hot", words), parseClimateRange("cold to hot", words));
  assert.deepEqual(parseClimateRange("0.2-0.5", words), parseClimateRange("0.2..0.5", words));
  assert.ok(parseClimateRange("0.2 - 0.5", words).range);
});

test("no regex lookbehind anywhere in the source (old iOS can't parse it)", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(n) && /\(\?<[=!]/.test(readFileSync(p, "utf8"))) hits.push(p);
    }
  };
  walk(join(process.cwd(), "src"));
  assert.deepEqual(hits, []);
});
