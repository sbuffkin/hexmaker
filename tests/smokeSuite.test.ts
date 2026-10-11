import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";
// The smoke suite's pure helpers (dev/smoke; the suite itself needs Windows Obsidian).
import { canon, jsonDiff, oneTimeOnly } from "../dev/smoke/lib/compare.mjs";
import { diff, hexDataFromFm, paletteTerrains, verifyPaletteUpgrade } from "../dev/smoke/lib/disk.mjs";

const read = (...p: string[]) => readFileSync(path.join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");

describe("smoke suite: comparison helpers", () => {
  it("canon ignores key order at every level", () => {
    expect(canon({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: 3 } })).toBe(canon({ a: { c: 3, d: [1, { x: 1, y: 2 }] }, b: 1 }));
    expect(canon([2, 1])).not.toBe(canon([1, 2]));
  });

  it("jsonDiff names the paths that differ", () => {
    const d = jsonDiff({ maps: [{ name: "a", zoom: 1 }], x: 1 }, { maps: [{ name: "a", zoom: 2 }], x: 1 });
    expect(d).toEqual(["maps[0].zoom: 1 → 2"]);
    expect(jsonDiff({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it("a restart may only write the one-time settings", () => {
    expect(oneTimeOnly({ a: 1 }, { a: 1, tableRangesPrompt: "done" })).toBe(true);
    expect(oneTimeOnly({ a: 1 }, { a: 1, advancedNudgeAt: "2026-10-11", tableRangesPrompt: "done" })).toBe(true);
    // The churn the suite found: maps' path lists written back on a later start.
    expect(oneTimeOnly({ maps: [{ name: "a" }] }, { maps: [{ name: "a", pathChains: [] }], tableRangesPrompt: "done" })).toBe(false);
    expect(oneTimeOnly({ a: 1 }, { a: 1 })).toBe(false);
  });

  it("snapshot diff tells changed, rewritten, added and removed apart", () => {
    const a = { x: { h: "1", m: 1 }, y: { h: "2", m: 1 }, z: { h: "3", m: 1 } };
    const b = { x: { h: "1", m: 1 }, y: { h: "9", m: 2 }, z: { h: "3", m: 5 }, w: { h: "4", m: 1 } };
    expect(diff(a, b)).toEqual({ added: ["w"], removed: [], changed: ["y"], touched: ["z"] });
    expect(diff(b, a).removed).toEqual(["w"]);
  });
});

describe("smoke suite: legacy hex data and palette upgrades", () => {
  it("reads 1.5.5 hex-note frontmatter like MapStore.hexDataFromFrontmatter", () => {
    expect(hexDataFromFm({ terrain: "grass", "gm-icon": "I_Ruins.png", "duckmage-submap": "harbour", locked: "true", tags: ["x"] }))
      .toEqual({ terrain: "grass", gmIcons: ["I_Ruins.png"], locations: ["harbour"], locked: true });
    expect(hexDataFromFm({ terrain: "" })).toEqual({});
    expect(hexDataFromFm(null)).toEqual({});
  });

  const OLD = [
    "---", "hexmaker-palette: 1", "---", "", "| Terrain | Color | Icon | Icon color | Category | Type |", "| --- | --- | --- | --- | --- | --- |",
    "| water | #60a5fa |  |  |  | water |", "| grass | #69a168 | bw-grassland.png |  | lowlands | grassland |", "",
  ].join("\n");
  const NEW = [
    "---", "hexmaker-palette: 1", "---", "", "| Terrain | Color | Icon | Icon color | Category | Type | Impassable |", "| --- | --- | --- | --- | --- | --- | --- |",
    "| water | `#60a5fa` |  |  |  | water | (yes) |", "| grass | `#69a168` | bw-grassland.png |  | lowlands | grassland | (no) |", "",
    "## Path types", "", "| Path | Color |", "| --- | --- |", "| Road | `#a16207` |", "",
  ].join("\n");

  it("a palette note upgrade that only adds columns and tables passes", () => {
    expect(paletteTerrains(NEW).get("grass")).toBe("#69a168|bw-grassland.png||lowlands|grassland");
    expect(paletteTerrains(NEW).has("Road")).toBe(false);
    expect(verifyPaletteUpgrade(OLD, NEW)).toEqual([]);
  });

  it("a rewrite that loses or changes a terrain is caught", () => {
    expect(verifyPaletteUpgrade(OLD, NEW.replace("| water |", "| sea |"))).toEqual(['terrain "water" gone', 'terrain "sea" added']);
    expect(verifyPaletteUpgrade(OLD, NEW.replace("`#69a168`", "`#000000`"))).toHaveLength(1);
  });
});

/**
 * Regression guards for the bugs the smoke suite's first run found
 * (2026-10-11). Each has a scripted check in dev/smoke too; these keep the
 * fixes from quietly reverting between smoke runs.
 */
describe("smoke suite findings stay fixed", () => {
  it("C6: a terrain stroke remembers the old terrain from the map data, not the hex note's frontmatter", () => {
    const src = read("src", "hex-map", "HexMapView.ts");
    const start = src.indexOf("  private onHexPaintClick(");
    const body = src.slice(start, src.indexOf("\n  }\n", start));
    expect(body).toMatch(/oldTerrain = pending \? pending\.terrain : getTerrainFromFile\(this\.app, path\)/);
    expect(body).not.toMatch(/getCache\(path\)\?\.frontmatter/);
  });

  it("C5: views restored as deferred tabs are skipped, never cast and called", () => {
    const src = read("src", "HexmakerPlugin.ts");
    expect(src).not.toMatch(/\(leaf\.view as Hex(Map|Table)View\)\./);
    expect(src).toMatch(/if \(leaf\.view instanceof HexMapView\) leaf\.view\.renderGrid\(\);/);
  });

  it("C5: startup saves wait for the map notes to load", () => {
    const src = read("src", "HexmakerPlugin.ts");
    expect(src).toMatch(/void storesReady\.then\(\(\) => maybePromptTableRanges\(this\)\);/);
    expect(src).toMatch(/void storesReady\.then\(\(\) => this\.saveSettings\(\)\);/);
  });
});
