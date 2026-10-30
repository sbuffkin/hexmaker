import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { readSurface } from "./helpers/source";

/**
 * Drift guard for the overlay-panel hide rules (issue #32).
 *
 * The original bug: coord labels were migrated from per-hex spans /
 * SVG copies to `.duckmage-coord-labels-layer`, but the
 * `.duckmage-hide-coords` CSS rule kept targeting the old class names —
 * so the "Show coordinates" checkbox silently did nothing. The code
 * compiled; only the selector was dead.
 *
 * This test cross-checks, for every `cssClass` declared in
 * OVERLAY_OPTIONS (HexSidePanel.ts):
 *   1. styles.css has at least one rule scoped under that hide class, and
 *   2. every class name those rules target is actually referenced
 *      somewhere in the plugin source — i.e. the selector points at DOM
 *      the plugin still creates.
 */

const root = process.cwd();
const stylesCss = readFileSync(path.join(root, "styles.css"), "utf8");
const sidePanelSrc = readSurface("side-panel");

function allSourceText(dir: string): string {
  let out = "";
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out += allSourceText(p);
    else if (name.endsWith(".ts")) out += readFileSync(p, "utf8");
  }
  return out;
}
const srcText = allSourceText(path.join(root, "src"));

const hideClasses = [...sidePanelSrc.matchAll(/cssClass:\s*"([^"]+)"/g)].map(
  (m) => m[1],
);

describe("overlay hide rules (issue #32 drift guard)", () => {
  it("declares the expected overlay hide classes", () => {
    expect(hideClasses).toEqual(
      expect.arrayContaining([
        "duckmage-hide-coords",
        "duckmage-hide-terrain-icons",
        "duckmage-hide-icon-overrides",
        "duckmage-hide-paths",
      ]),
    );
  });

  for (const hideClass of hideClasses.length ? hideClasses : ["<none-parsed>"]) {
    describe(hideClass, () => {
      // Selectors of every rule scoped under the hide class
      const selectorRe = new RegExp(
        `^([^\\n{}]*\\.${hideClass}[^\\n{}]*)\\{`,
        "gm",
      );
      const selectors = [...stylesCss.matchAll(selectorRe)].map((m) =>
        m[1].trim(),
      );

      it("has at least one styles.css rule", () => {
        expect(selectors.length).toBeGreaterThan(0);
      });

      it("only targets class names the source still creates", () => {
        for (const selector of selectors) {
          const classNames = [...selector.matchAll(/\.([a-zA-Z0-9_-]+)/g)]
            .map((m) => m[1])
            .filter((c) => c !== hideClass);
          expect(classNames.length).toBeGreaterThan(0);
          for (const cls of classNames) {
            // The targeted class must be referenced in the TS source —
            // a selector aimed at DOM nobody creates is a dead rule.
            expect(
              srcText.includes(cls) ? cls : `MISSING-IN-SRC: ${cls} (from "${selector}")`,
            ).toBe(cls);
          }
        }
      });
    });
  }
});
