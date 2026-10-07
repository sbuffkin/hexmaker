import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";

/**
 * Drift guard for the pan/zoom perf fix.
 *
 * Custom properties inherit by default, so writing a plain `--var` on the
 * map viewport re-styles every element under it. On chult (3843 hexes)
 * that made each pan/zoom frame cost ~430 ms instead of ~17 ms. Every
 * transform var HexMapView writes per frame (or per calibration drag)
 * must be registered with `@property { inherits: false }` in styles.css.
 */

const root = process.cwd();
const stylesCss = readFileSync(path.join(root, "styles.css"), "utf8");
const viewSrc = readFileSync(path.join(root, "src", "hex-map", "HexMapView.ts"), "utf8");

/** Keys of the setCssProps({...}) object literal inside method `name`. */
function varsWrittenBy(name: string): string[] {
  const start = viewSrc.indexOf(`private ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const body = viewSrc.slice(start, viewSrc.indexOf("\n  }\n", start));
  return [...body.matchAll(/"(--duckmage-[\w-]+)":/g)].map((m) => m[1]);
}

function isNonInheriting(name: string): boolean {
  const rule = new RegExp(`@property\\s+${name}\\s*\\{[^}]*inherits:\\s*false`);
  return rule.test(stylesCss);
}

describe("transform custom properties", () => {
  for (const method of ["applyTransform", "applyBgLayerVars", "applyGridLayerVars"]) {
    it(`${method} only writes non-inheriting vars`, () => {
      const vars = varsWrittenBy(method);
      expect(vars.length).toBeGreaterThan(0);
      for (const v of vars) expect([v, isNonInheriting(v)]).toEqual([v, true]);
    });
  }

  it("the viewport is only composited while it moves", () => {
    const viewportRule = stylesCss.match(/\.duckmage-hex-map-viewport\s*\{[^}]*\}/)?.[0] ?? "";
    expect(viewportRule).not.toMatch(/will-change/);
    expect(stylesCss).toMatch(/\.duckmage-hex-map-viewport\.is-moving\s*\{\s*will-change:\s*transform/);
  });
});
