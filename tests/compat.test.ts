import { describe, it } from "node:test";
import expect from "expect";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { isModelMarkdown, parseModelMarkdown, solve } from "../packages/hex-wfc/src";
import { compareVersions, migrateMapData, VERSION_KEY } from "../src/compat";
import { isSaveMarkdown, parseSave, retargetSave, serializeSave, decodeCells, encodeCells } from "../src/worldgen/saveFormat";
import { exampleFiles } from "./compat/examples";
import { MAP_NOTE_FORMAT, mapNoteKey, parseMapNote, updateMapNote } from "../src/maps/mapNote";

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

      // Map notes arrived in 1.5.6; older sets have none.
      const mapNoteFile = path.join(dir, "map-note.md");
      if (existsSync(mapNoteFile)) {
        it("map note still reads, every setting and hex intact", () => {
          const d = parseMapNote(read(mapNoteFile));
          if (!d) throw new Error("map note didn't parse");
          const s = d.settings as Record<string, unknown>;
          expect(s).toMatchObject({
            displayName: "Compat Example",
            createdWith: version,
            paletteName: "Default",
            gridSize: { cols: 14, rows: 10 },
            gridOffset: { x: 0, y: 0 },
            staggerOffset: "odd",
            baseTerrain: "grass",
            terrainType: "forest",
            weatherTable: "world/tables/weather.md",
            showCoords: true,
            showGmLayer: false,
            hiddenLinkBadges: ["Quests"],
            parent: { map: "compat-world", hex: "3_4" },
            world: { id: "w-compat", cx: 1, cy: -1 },
            biome: { generator: "preset-valley", from: ["preset-deep-forest"] },
            originX: 2,
          });
          expect(s.backgroundImage).toMatchObject({ path: "world/maps/compat example.png", offsetX: 12.5, offsetY: -4, scale: 1.25, rotation: 0, opacity: 0.8 });
          expect(s.gridDisplayScaleX as number).toBeCloseTo(1.0123, 3);
          expect(s.gridDisplayOffsetX as number).toBeCloseTo(-3.3333, 3);
          expect(d.hexes.get("3_4")).toMatchObject({ name: "Glass Wastes", terrain: "hills", icon: "bw-castle.png", gmIcons: ["skull.png", "trap.png"], region: "Basin", locked: true });
          // A Submap (format 2 and older) reads as the first location; later sets add more.
          expect(d.hexes.get("3_4")!.locations?.[0]).toBe("compat-example-3-4");
          expect(d.hexes.get("6_2")).toEqual({ terrain: "grass", extra: { Notes: "a newer build's column" } });
          expect(d.hexes.get("4_5")).toEqual({ terrain: "shallows" });
          expect(d.paths.map((p) => p.typeName)).toEqual(["Road", "River"]);
          expect(d.paths[1].branches[0].anchors[0]).toBe("4_0");
        });

        it("map note rewritten by this build keeps its values and the user's text", () => {
          const text = read(mapNoteFile).replace("\n## Hexes", "\nMy notes about the coast.\n\n## Hexes") + "\n## Session log\nWe crossed the river.\n";
          const d = parseMapNote(text)!;
          const out = updateMapNote(text, "compat-example", d);
          expect(out).toContain("My notes about the coast.");
          expect(out).toContain("## Session log\nWe crossed the river.");
          const back = parseMapNote(out)!;
          // Same data, except long decimals are written to 4 places.
          const round = (x: unknown) => (typeof x === "number" ? Math.round(x * 10000) / 10000 : x);
          const rounded = { ...d, settings: Object.fromEntries(Object.entries(d.settings).map(([k, v]) => [k, round(v)])) };
          expect(mapNoteKey(back)).toBe(mapNoteKey(rounded));
          // Converted to the current format: plain keys, no JSON, the help box once.
          const fm = out.slice(0, out.indexOf("\n---", 4));
          expect(fm).toMatch(new RegExp(`^hexmaker-map: ${MAP_NOTE_FORMAT}$`, "m"));
          expect(fm).not.toMatch(/[{}]/);
          expect(fm).not.toContain("hexmaker-extra");
          expect(out.match(/\[!info\]- How to edit this note/g)).toHaveLength(1);
          // and a second write changes nothing
          expect(updateMapNote(out, "compat-example", back)).toBe(out);
        });
      }

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

/**
 * Map-note formats by their hexmaker-map number (format 2 = readable keys,
 * one Submap column). Written before a format change; the current code must
 * keep reading each one and convert it on write.
 */
describe("map note formats", () => {
  const formatsDir = path.join(compatDir, "map-note-formats");
  it("format 2 reads every setting and hex", () => {
    const d = parseMapNote(read(formatsDir, "format-2.md"));
    if (!d) throw new Error("format 2 note didn't parse");
    expect(d.format).toBe(2);
    expect(d.problems).toEqual([]);
    expect(d.settings).toMatchObject({ displayName: "Compat Example", parent: { map: "compat-world", hex: "3_4" }, world: { id: "w-compat", cx: 1, cy: -1 }, originX: 2 });
    expect(d.hexes.get("3_4")).toEqual({ name: "Glass Wastes", terrain: "hills", icon: "bw-castle.png", gmIcons: ["skull.png", "trap.png"], region: "Basin", locations: ["compat-example-3-4"], locked: true });
    expect(d.hexes.get("6_2")).toEqual({ terrain: "grass", extra: { Notes: "a newer build's column" } });
  });

  it("format 3 reads every setting, hex and path", () => {
    const d = parseMapNote(read(formatsDir, "format-3.md"));
    if (!d) throw new Error("format 3 note didn't parse");
    expect(d.format).toBe(3);
    expect(d.problems).toEqual([]);
    expect(d.settings).toMatchObject({ displayName: "Compat Example", baseTerrain: "grass", parent: { map: "compat-world", hex: "3_4" }, originX: 2 });
    expect(d.hexes.get("3_4")).toEqual({ name: "Glass Wastes", terrain: "hills", icon: "bw-castle.png", gmIcons: ["skull.png", "trap.png"], region: "Basin", regionMap: "compat-example-region", locations: ["compat-example-3-4", "compat-example-inn"], locked: true });
    expect(d.hexes.get("6_2")).toEqual({ terrain: "grass", extra: { Notes: "a newer build's column" } });
    // Old every-hex rows read as paths with every hex an anchor, named after their type.
    expect(d.paths).toEqual([
      { name: "Road", typeName: "Road", branches: [{ anchors: Array.from({ length: 14 }, (_, x) => `${x}_8`) }] },
      { name: "River", typeName: "River", branches: [{ anchors: ["4_0", "4_1", "4_2", "4_3", "4_4", "4_5"] }] },
    ]);
    expect(d.legacyPaths).toEqual(["Road", "River"]);
  });

  it("format 4 reads every setting, hex and path (derived Route and Warning ignored, Notes kept)", () => {
    const d = parseMapNote(read(formatsDir, "format-4.md"));
    if (!d) throw new Error("format 4 note didn't parse");
    expect(d.format).toBe(4);
    expect(d.problems).toEqual([]);
    expect(d.settings).toMatchObject({ displayName: "Compat Example", baseTerrain: "grass", parent: { map: "compat-world", hex: "3_4" }, originX: 2 });
    expect(d.hexes.get("3_4")).toEqual({ name: "Glass Wastes", terrain: "hills", icon: "bw-castle.png", gmIcons: ["skull.png", "trap.png"], region: "Basin", regionMap: "compat-example-region", locations: ["compat-example-3-4", "compat-example-inn"], locked: true });
    expect(d.paths.map((p) => [p.name, p.typeName, p.branches.map((b) => b.anchors.join(" ")), p.notes ?? ""])).toEqual([
      ["Road", "Road", ["0_8 1_8 2_8 3_8 4_8 5_8 6_8 7_8 8_8 9_8 10_8 11_8 12_8 13_8"], "Paved as far as Saltmere."],
      ["River", "River", ["4_0 4_1 4_2 4_3 4_4 4_5"], ""],
      ["Road 2", "Road", ["9_8 9_9 9_10 9_11"], ""],
      ["Old Track", "Old Track", ["2_2 3_2 4_2 5_1 6_1"], ""],
      ["Road 3", "Road", ["12_2"], ""],
    ]);
    expect(d.legacyPaths).toEqual(["Road", "River", "Road 2", "Old Track", "Road 3"]);
  });

  it("format 3 converts once: the derived Summary is added, paths move to Paths + Path routes, nothing else changes", () => {
    const text = read(formatsDir, "format-3.md").replace("\n## Hexes", "\nMy notes.\n\n## Hexes");
    const d = parseMapNote(text)!;
    const out = updateMapNote(text, "compat-example", d);
    expect(out).toMatch(new RegExp(`^hexmaker-map: ${MAP_NOTE_FORMAT}$`, "m"));
    expect(out).toContain("My notes.\n\n## Summary\n");
    expect(out).toContain("| Path | Type | Route | Notes |");
    expect(out).toContain("| River | River | 4, 0 → 4, 5 |  |");
    expect(out).toContain("## Path routes\n\n| Path | Branch | Anchors |");
    expect(out).toContain("| River | main | 4, 0 → 4, 1 → 4, 2 → 4, 3 → 4, 4 → 4, 5 |");
    expect(out).not.toContain("| Type | Hexes |");
    expect(out).toContain("The plugin fills in *Route*");
    expect(out).toContain("edit *Path* in both tables");
    // The Hexes table is untouched.
    const hexTable = (s: string) => s.slice(s.indexOf("| Hex |"), s.indexOf("## Paths"));
    expect(hexTable(out)).toBe(hexTable(text));
    const back = parseMapNote(out)!;
    expect(mapNoteKey(back)).toBe(mapNoteKey(d));
    expect(updateMapNote(out, "compat-example", back)).toBe(out);
  });

  it("format 2 converts once: Submap becomes Locations, maps and regions become links, nothing else changes", () => {
    const text = read(formatsDir, "format-2.md").replace("\n## Hexes", "\nMy notes.\n\n## Hexes");
    const d = parseMapNote(text)!;
    const out = updateMapNote(text, "compat-example", d);
    expect(out).toMatch(new RegExp(`^hexmaker-map: ${MAP_NOTE_FORMAT}$`, "m"));
    expect(out).toContain("My notes.");
    expect(out).toContain("| Hex | Name | Terrain | Icon | GM icons | Region | Locations | Locked | Notes |");
    expect(out).toContain("| 3_4 | Glass Wastes | hills | bw-castle.png | skull.png, trap.png | [[Basin]] | [[_compat-example-3-4]] | yes |  |");
    expect(out).toContain("*Locations* links the maps");
    const back = parseMapNote(out)!;
    expect(mapNoteKey(back)).toBe(mapNoteKey(d));
    expect(updateMapNote(out, "compat-example", back)).toBe(out);
  });
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

  it("points a save at a renamed generator, and leaves other saves alone", () => {
    const text = exampleFiles("9.9.9")["save.md"];
    const parsed = parseSave(text);
    if ("error" in parsed) throw new Error(parsed.error);
    const from = { name: parsed.save.generatorName, path: parsed.save.generatorPath };
    const to = { name: "new name", path: "world/generators/new name.md" };
    const moved = parseSave(retargetSave(text, from, to));
    if ("error" in moved) throw new Error(moved.error);
    expect([moved.save.generatorName, moved.save.generatorPath]).toEqual([to.name, to.path]);
    // Only the two lines change: cells, settings and the generator copy stay.
    expect({ ...moved.save, generatorName: "", generatorPath: "" }).toEqual({ ...parsed.save, generatorName: "", generatorPath: "" });
    expect(retargetSave(text, { name: "other", path: "world/generators/other.md" }, to)).toBe(text);
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

  it("turns pre-path-type roadChains / riverChains into Road and River paths", () => {
    const m = migrateMapData({
      name: "old",
      roadChains: [["0_0", "1_0"], []],
      riverChains: [["2_2", "2_3", "3_3"]],
      pathChains: [{ typeName: "Trail", hexes: ["5_5", "5_6"] }],
    });
    expect(m.pathChains).toEqual([
      { typeName: "Trail", hexes: ["5_5", "5_6"] },
      { typeName: "Road", hexes: ["0_0", "1_0"] },
      { typeName: "River", hexes: ["2_2", "2_3", "3_3"] },
    ]);
    expect("roadChains" in m || "riverChains" in m).toBe(false);
  });
});
