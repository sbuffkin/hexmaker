import { describe, it } from "node:test";
import expect from "expect";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { isModelMarkdown, parseModelMarkdown, solve } from "../packages/hex-wfc/src";
import { compareVersions, migrateMapData, VERSION_KEY } from "../src/compat";
import { isSaveMarkdown, parseSave, serializeSave, decodeCells, encodeCells } from "../src/worldgen/saveFormat";
import { exampleFiles } from "./compat/examples";

/**
 * Every released version leaves an example generator, save and map in
 * tests/fixtures/compat/<version>/ (written by `npm run version`). The
 * current code must still load all of them. If one breaks, add a migration
 * keyed on the file's version instead of editing the old example.
 */

const root = process.cwd();
const compatDir = path.join(root, "tests", "fixtures", "compat");
// Checkouts on Windows may turn the examples CRLF; the files were written LF.
const read = (...p: string[]) => readFileSync(path.join(...p), "utf8").replace(/\r\n/g, "\n");
const versions = existsSync(compatDir)
  ? readdirSync(compatDir).filter((d) => /^\d+(\.\d+)*$/.test(d)).sort(compareVersions)
  : [];
const current = (JSON.parse(read(root, "manifest.json")) as { version: string }).version;

describe("compat examples", () => {
  it("exist for the current version (npm run version writes them)", () => {
    expect(versions).toContain(current);
  });

  for (const version of versions) {
    describe(version, () => {
      const dir = path.join(compatDir, version);

      it("generator loads and still generates", () => {
        const text = read(dir, "generator.md");
        expect(isModelMarkdown(text)).toBe(true);
        const { model, warnings } = parseModelMarkdown(text, "example");
        expect(warnings).toEqual([]);
        expect(model.meta[VERSION_KEY]).toBe(version);
        expect(model.terrains.length).toBeGreaterThan(1);
        const r = solve(model, { cols: 14, rows: 10, orientation: "flat", seed: 1 });
        expect(r.ok).toBe(true);
      });

      it("save loads with its map, settings and generator copy", () => {
        const text = read(dir, "save.md");
        expect(isSaveMarkdown(text)).toBe(true);
        expect(isModelMarkdown(text)).toBe(false);
        const parsed = parseSave(text);
        if ("error" in parsed) throw new Error(parsed.error);
        const { save, warnings } = parsed;
        expect(warnings).toEqual([]);
        expect(save.version).toBe(version);
        expect(save.cells.size).toBe(save.cols * save.rows);
        expect(Object.keys(save.settings).length).toBeGreaterThan(0);
        expect(parseModelMarkdown(save.generatorMarkdown, "copy").warnings).toEqual([]);
      });

      it("map entry migrates to the current shape", () => {
        const map = migrateMapData(JSON.parse(read(dir, "map.json")));
        expect(map.createdWith).toBe(version);
        expect(map.gridSize.cols).toBeGreaterThan(0);
        expect(Array.isArray(map.pathChains)).toBe(true);
        expect(map.paletteName).toBeTruthy();
      });
    });
  }
});

describe("save format", () => {
  it("round-trips a save written now", () => {
    const text = exampleFiles("9.9.9")["save.md"];
    const parsed = parseSave(text);
    if ("error" in parsed) throw new Error(parsed.error);
    expect(serializeSave(parsed.save)).toBe(text);
  });

  it("run-length encodes the terrain grid, including unpainted hexes", () => {
    const cells = new Map([["0_0", "Grass"], ["1_0", "Grass"], ["2_0", "Water"], ["0_1", "Water"], ["2_1", "Grass"]]);
    const text = encodeCells(cells, 3, 2);
    expect(text).toBe("legend: Grass; Water\n0*2 1\n1 - 0");
    const back = decodeCells(text, 3, 2);
    expect("cells" in back && [...back.cells].sort()).toEqual([...cells].sort());
  });

  it("explains a damaged terrain block", () => {
    expect(decodeCells("legend: Grass\n0*2", 3, 1)).toHaveProperty("error");
    expect(decodeCells("legend: Grass\n0 5 0", 3, 1)).toHaveProperty("error");
  });
});

describe("compareVersions", () => {
  it("orders dotted versions numerically, unknown first", () => {
    expect(compareVersions("1.5.10", "1.5.9")).toBeGreaterThan(0);
    expect(compareVersions("1.5.5", "1.5.5")).toBe(0);
    expect(compareVersions("unknown", "1.0.0")).toBeLessThan(0);
  });
});

describe("migrateMapData", () => {
  it("fills what old map entries lack and keeps unknown fields", () => {
    const m = migrateMapData({ name: "old", gridSize: { cols: 3, rows: 2 }, futureField: 1 });
    expect(m).toMatchObject({ paletteName: "Default", gridOffset: { x: 0, y: 0 }, pathChains: [], futureField: 1 });
  });
});
