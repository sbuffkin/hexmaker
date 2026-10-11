/**
 * Map note format 5 (plan-path-anchors section 2 and 6): named paths in
 * `## Paths`, anchors in `## Path routes`, the forgiving reader, hand edits,
 * old every-hex tables, the old-build guard, and MapStore's side (the
 * three-way merge, legacy conversion, the compatibility view, readiness and
 * pinning when the routing context changes).
 */
import { describe, it, beforeEach } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { Notice } from "obsidian";
import {
  buildMapNote,
  MAP_NOTE_FORMAT,
  mapNoteKey,
  parseMapNote,
  readMapNote,
  refreshProblemCallouts,
  updateMapNote,
  type MapNoteData,
} from "../src/maps/mapNote";
import * as format4 from "./fixtures/compat/map-note-formats/parser-format-4";
import { MapStore, mergePaths } from "../src/maps/MapStore";
import { MemVault } from "./helpers/memVault";
import type { MapData, MapPath, PathChain } from "../src/types";
import { DEFAULT_PATH_TYPES, DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { mapRouteContext, pathTypeStyleFor } from "../src/paths/mapContext";
import { resolvePaths, resolvedToChains } from "../src/paths/resolve";
import { compactLegacy, stepsOf } from "../src/paths/fromHexes";
import { legacyChainsToPaths } from "../src/paths/legacy";
import { impassableNames } from "../src/impassable";
import { buildView, reconcile } from "../src/paths/chainView";

(globalThis as Record<string, unknown>).window ??= globalThis;

const compat = path.join(process.cwd(), "tests", "fixtures", "compat");
const read = (...p: string[]) => readFileSync(path.join(compat, ...p), "utf8").replace(/\r\n/g, "\n");

const P = (name: string, typeName: string, ...branches: string[][]): MapPath => ({ name, typeName, branches: branches.map((anchors) => ({ anchors })) });
const data = (paths: MapPath[]): MapNoteData => ({ settings: { paletteName: "Default", gridSize: { cols: 20, rows: 20 }, gridOffset: { x: 0, y: 0 } }, hexes: new Map(), paths });

/** A format-5 note with the given Paths and Path routes table lines. */
const note5 = (paths: string[], routes: string[]) => [
  "---", `hexmaker-map: ${MAP_NOTE_FORMAT}`, "palette: Default", "cols: 20", "rows: 20", "offset-x: 0", "offset-y: 0", "---", "# m", "",
  "## Hexes", "", "| Hex | Terrain |", "| --- | --- |", "| 1_1 | forest |", "",
  "## Paths", "", ...paths, "",
  "## Path routes", "", ...routes, "",
].join("\n");

const KINGS: MapPath = {
  name: "King's Road", typeName: "Road", notes: "Paved as far as Saltmere.",
  branches: [{ anchors: ["0_8", "9_8", "13_8"] }, { anchors: ["9_8", "9_12", "11_14"], label: "to Saltmere" }, { anchors: ["13_8", "15_5"] }],
};

describe("map note format 5: Paths + Path routes", () => {
  it("round-trips names, types, notes, forks, labels and extra columns", () => {
    const glass: MapPath = { name: "Glass River", typeName: "River", branches: [{ anchors: ["4_0", "4_5"], extra: { Ford: "at 4, 3" } }], extra: { Danger: "eels" } };
    const d = data([KINGS, glass]);
    const text = buildMapNote("m", d);
    expect(text).toContain("## Paths\n\n| Path | Type | Route | Notes | Danger |\n| --- | --- | --- | --- | --- |\n| King's Road | Road | 0, 8 → 13, 8 · 2 forks | Paved as far as Saltmere. |  |\n| Glass River | River | 4, 0 → 4, 5 |  | eels |");
    expect(text).toContain("## Path routes\n\n| Path | Branch | Anchors | Ford |\n| --- | --- | --- | --- |\n| King's Road | main | 0, 8 → 9, 8 → 13, 8 |  |\n| King's Road | to Saltmere | 9, 8 → 9, 12 → 11, 14 |  |\n| King's Road | fork | 13, 8 → 15, 5 |  |\n| Glass River | main | 4, 0 → 4, 5 | at 4, 3 |");
    const back = parseMapNote(text)!;
    expect(back.paths).toEqual([KINGS, glass]);
    expect(back.problems).toEqual([]);
    expect(back.legacyPaths).toBeUndefined();
    expect(mapNoteKey(back)).toBe(mapNoteKey(d));
    expect(updateMapNote(text, "m", back)).toBe(text);
  });

  it("the help box explains both tables and to rename a path in both", () => {
    const text = buildMapNote("m", data([]));
    expect(text).toContain("> - **Paths**: one row per path.");
    expect(text).toContain("A path's `main` row is its main line; every other row is a fork that leaves the path at its first hex. To rename a path, edit *Path* in both tables.");
  });
});

describe("map note format 5: forgiving Path routes (section 2)", () => {
  const paths = ["| Path | Type | Route | Notes |", "| --- | --- | --- | --- |", "| King's Road | Road |  |  |"];

  it("reads every coordinate form and separator, and writes them back canonically", () => {
    const forms: [string, string[]][] = [
      ["3, 4 → 9, 4", ["3_4", "9_4"]],
      ["3,4 -> 9,4", ["3_4", "9_4"]],
      ["3_4 > 9_4", ["3_4", "9_4"]],
      ["(3, 4); (9, 4)", ["3_4", "9_4"]],
      ["-1, -4 → 0, -3", ["-1_-4", "0_-3"]],
      ["3, 4  9, 4  9, 6", ["3_4", "9_4", "9_6"]],
    ];
    for (const [cell, anchors] of forms) {
      const text = note5(paths, ["| Path | Branch | Anchors |", "| --- | --- | --- |", `| King's Road | main | ${cell} |`]);
      const d = parseMapNote(text)!;
      expect(d.problems).toEqual([]);
      expect(d.paths[0].branches).toEqual([{ anchors }]);
      const out = updateMapNote(text, "m", d);
      expect(out).toContain(`| King's Road | main | ${anchors.map((k) => k.replace("_", ", ")).join(" → ")} |`);
    }
  });

  it("header case, spacing, column order and a missing |---| row don't matter", () => {
    const text = note5(["path | TYPE | notes", "King's Road | Road | old"], ["| anchors |  Branch | PATH |", "| 3, 4 → 9, 4 | main | King's Road |"]);
    const d = parseMapNote(text)!;
    expect(d.problems).toEqual([]);
    expect(d.paths).toEqual([{ name: "King's Road", typeName: "Road", notes: "old", branches: [{ anchors: ["3_4", "9_4"] }] }]);
    const out = updateMapNote(text, "m", d);
    // Route, which the table lacked, goes right after Type.
    expect(out).toContain("| Path | Type | Route | Notes |\n| --- | --- | --- | --- |\n| King's Road | Road | 3, 4 → 9, 4 | old |");
    expect(out).toContain("| Anchors | Branch | Path |\n| --- | --- | --- |\n| 3, 4 → 9, 4 | main | King's Road |");
    expect(updateMapNote(out, "m", parseMapNote(out)!)).toBe(out);
  });

  it("a path's rows may be anywhere: the main row is the main line, the others keep their order", () => {
    const text = note5(paths, [
      "| Path | Branch | Anchors |", "| --- | --- | --- |",
      "| King's Road | fork | 13, 8 → 15, 5 |",
      "| Other | main | 1, 1 → 2, 1 |",
      "| King's Road | main | 0, 8 → 13, 8 |",
      "| King's Road | west | 0, 8 → 0, 2 |",
    ]);
    const d = parseMapNote(text)!;
    expect(d.paths[0].branches).toEqual([{ anchors: ["0_8", "13_8"] }, { anchors: ["13_8", "15_5"] }, { anchors: ["0_8", "0_2"], label: "west" }]);
    const out = updateMapNote(text, "m", d);
    expect(out).toContain("| King's Road | main | 0, 8 → 13, 8 |\n| King's Road | fork | 13, 8 → 15, 5 |\n| King's Road | west | 0, 8 → 0, 2 |\n| Other | main | 1, 1 → 2, 1 |");
  });

  it("matches a routes row to its Paths row ignoring case and spacing; the next write fixes the spelling", () => {
    const text = note5(paths, ["| Path | Branch | Anchors |", "| --- | --- | --- |", "|  king's   ROAD | main | 3, 4 → 9, 4 |"]);
    const d = parseMapNote(text)!;
    expect(d.paths).toHaveLength(1);
    expect(d.paths[0].branches[0].anchors).toEqual(["3_4", "9_4"]);
    expect(updateMapNote(text, "m", d)).toContain("| King's Road | main | 3, 4 → 9, 4 |");
  });

  it("rows that can't be read are kept as written, listed, and never half-imported", () => {
    const bad = [
      "| King's Road | fork | 3, 4 → nine, 4 |",
      "| King's Road | fork | 3, 4, 9 |",
      "| King's Road | fork |  |",
      "|  | main | 1, 1 → 2, 2 |",
    ];
    const text = note5(paths, ["| Path | Branch | Anchors |", "| --- | --- | --- |", "| King's Road | main | 3, 4 → 9, 4 |", ...bad]);
    const d = parseMapNote(text)!;
    expect(d.paths[0].branches).toEqual([{ anchors: ["3_4", "9_4"] }]);
    expect(d.problems!.map((p) => [p.where, p.text])).toEqual(bad.map((b) => ["Path routes", b]));
    expect(d.problems!.map((p) => p.reason)).toEqual([
      "Anchors: can't read \"nine, 4\" (write them like 3, 4 → 9, 4)",
      "Anchors: an odd number of coordinates (3): every anchor needs an x and a y (write them like 3, 4 → 9, 4)",
      "Anchors: no anchors (write them like 3, 4 → 9, 4)",
      "no path name in the Path column",
    ]);
    const out = updateMapNote(text, "m", d);
    const table = out.slice(out.indexOf("| Path | Branch"));
    expect(table).toContain(["| King's Road | main | 3, 4 → 9, 4 |", ...bad, "", "> [!warning] Hexmaker couldn't read 4 rows in this table"].join("\n"));
    expect(updateMapNote(out, "m", parseMapNote(out)!)).toBe(out);
    // refreshing only the callouts of the hand-edited note puts the same box in
    expect(refreshProblemCallouts(text)).toContain("> [!warning] Hexmaker couldn't read 4 rows in this table");
  });
});

describe("map note format 5: the hand-edit table (section 2)", () => {
  const routes = (...rows: string[]) => ["| Path | Branch | Anchors |", "| --- | --- | --- |", ...rows];
  const ctx = { pathTypes: ["Road", "River"] };

  it("a routes row for a path not in Paths: created with no type, flagged, and given a Paths row on write", () => {
    const text = note5(["| Path | Type | Route | Notes |", "| --- | --- | --- | --- |"], routes("| Old Track | main | 2, 2 → 6, 1 |"));
    const d = parseMapNote(text)!;
    expect(d.paths).toEqual([P("Old Track", "", ["2_2", "6_1"])]);
    const out = updateMapNote(text, "m", d, ctx);
    expect(out).toContain("| Old Track |  | 2, 2 → 6, 1 · ⚠ no type: fill in Type |  |");
    expect(out).toContain("- **⚠ Paths with no type:** Old Track.");
  });

  it("a Paths row with no routes rows is kept, with no route yet", () => {
    const text = note5(["| Path | Type | Route | Notes |", "| --- | --- | --- | --- |", "| Plan | Road |  | someday |"], routes());
    const d = parseMapNote(text)!;
    expect(d.paths).toEqual([{ name: "Plan", typeName: "Road", notes: "someday", branches: [] }]);
    expect(updateMapNote(text, "m", d, ctx)).toContain("| Plan | Road | no route yet | someday |");
  });

  it("an unknown type is kept as typed and flagged in Route", () => {
    const text = note5(["| Path | Type | Route | Notes |", "| --- | --- | --- | --- |", "| Old Track | Trail |  |  |"], routes("| Old Track | main | 2, 2 → 6, 1 |"));
    const d = parseMapNote(text)!;
    expect(d.paths[0].typeName).toBe("Trail");
    expect(updateMapNote(text, "m", d, ctx)).toContain("| Old Track | Trail | 2, 2 → 6, 1 · ⚠ type not in palette |  |");
  });

  it("a duplicate path name in Paths: the first wins, the duplicate is kept as written and flagged", () => {
    const text = note5(["| Path | Type | Route | Notes |", "| --- | --- | --- | --- |", "| Road | Road |  |  |", "| road | River |  |  |"], routes("| Road | main | 1, 1 → 2, 1 |"));
    const d = parseMapNote(text)!;
    expect(d.paths).toEqual([P("Road", "Road", ["1_1", "2_1"])]);
    expect(d.problems!.map((p) => [p.where, p.text])).toEqual([["Paths", "| road | River |  |  |"]]);
    const out = updateMapNote(text, "m", d);
    expect(out).toContain("| Road | Road | 1, 1 → 2, 1 |  |\n| road | River |  |  |\n\n> [!warning]");
  });

  it("a pasted old Type | Hexes table is read (every hex an anchor) and written back in the new form", () => {
    const text = note5(
      ["| Path | Type | Route | Notes |", "| --- | --- | --- | --- |", "| Road | Road |  |  |", "", "| Type | Hexes |", "| --- | --- |", "| River | 4_0 4_1 4_2 |", "| Road | 1_1 x_y |"],
      routes("| Road | main | 1, 1 → 2, 1 |"),
    );
    const d = parseMapNote(text)!;
    expect(d.paths).toEqual([P("Road", "Road", ["1_1", "2_1"]), P("River", "River", ["4_0", "4_1", "4_2"])]);
    expect(d.legacyPaths).toEqual(["River"]);
    expect(d.problems!.map((p) => p.text)).toEqual(["| Road | 1_1 x_y |"]);
    const out = updateMapNote(text, "m", d);
    expect(out).toContain("| River | main | 4, 0 → 4, 1 → 4, 2 |");
    // The old table keeps only the row it couldn't read, with its warning.
    expect(out).toContain("| Type | Hexes |\n| --- | --- |\n| Road | 1_1 x_y |\n\n> [!warning] Hexmaker couldn't read a row in this table");
    expect(out).not.toContain("4_0 4_1");
    const back = parseMapNote(out)!;
    expect(back.paths).toEqual(d.paths);
    expect(updateMapNote(out, "m", back)).toBe(out);
  });

  it("a fork row whose first anchor isn't on the path is read as written (its own stretch)", () => {
    const text = note5(["| Path | Type | Route | Notes |", "| --- | --- | --- | --- |", "| Road | Road |  |  |"], routes("| Road | main | 1, 1 → 3, 1 |", "| Road | fork | 8, 8 → 9, 9 |"));
    expect(parseMapNote(text)!.paths[0].branches).toEqual([{ anchors: ["1_1", "3_1"] }, { anchors: ["8_8", "9_9"] }]);
  });
});

describe("map note format 5: old and newer builds", () => {
  it("(d) a format-4 build reads a format-5 note as broken, never with wrong paths", () => {
    const text = buildMapNote("m", data([KINGS]));
    const r = format4.readMapNote(text);
    expect(r && r.ok).toBe(false);
    expect(r && !r.ok && r.reason).toContain("Paths table");
  });

  it("this build reads a note from a newer build as broken, naming the format and saying to update", () => {
    const text = buildMapNote("m", data([KINGS])).replace(`hexmaker-map: ${MAP_NOTE_FORMAT}`, `hexmaker-map: ${MAP_NOTE_FORMAT + 1}`);
    const r = readMapNote(text)!;
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.newer).toBe(MAP_NOTE_FORMAT + 1);
    expect(r.reason).toContain(`map-note format ${MAP_NOTE_FORMAT + 1}`);
    expect(r.reason).toContain("Update the plugin");
  });

  it("format 4 still reads, and converts to Paths + Path routes with the help line replaced", () => {
    const text = read("map-note-formats", "format-4.md");
    const d = parseMapNote(text)!;
    expect(d.format).toBe(4);
    const out = updateMapNote(text, "compat-example", d, { pathTypes: ["Road", "River"] });
    expect(out).toMatch(new RegExp(`^hexmaker-map: ${MAP_NOTE_FORMAT}$`, "m"));
    expect(out).not.toContain("| Warning |");
    expect(out).toContain("| Road | Road | 0, 8 → 13, 8 | Paved as far as Saltmere. |");
    expect(out).toContain("To rename a path, edit *Path* in both tables.");
    expect(out).not.toContain("*Hexes* lists its hexes");
    expect(mapNoteKey(parseMapNote(out)!)).toBe(mapNoteKey(d));
  });
});

// ── MapStore ────────────────────────────────────────────────────────────────

const NOTE = "world/hexes/m/_m.md";

function plugin(vault: MemVault, maps: MapData[], palette = DEFAULT_TERRAIN_PALETTE) {
  return {
    app: vault.app(),
    manifest: { dir: ".obsidian/plugins/hexmaker" },
    settings: { hexFolder: "world/hexes", maps, hexOrientation: "flat" as const, staggerOffset: "odd" as const },
    getMap: (n: string) => maps.find((m) => m.name === n),
    getMapPalette: () => palette,
    getMapPathTypes: () => DEFAULT_PATH_TYPES,
    saveData: async () => {},
    refreshHexMap: () => {},
  };
}

async function boot(vault: MemVault, maps: MapData[]) {
  const p = plugin(vault, maps);
  const store = new MapStore(p as never);
  await store.init();
  return { p, store };
}

const fixtureMap = (extra: Partial<MapData> = {}): MapData => ({ name: "m", paletteName: "Default", gridSize: { cols: 14, rows: 10 }, gridOffset: { x: 0, y: 0 }, staggerOffset: "odd", baseTerrain: "grass", pathChains: [], ...extra } as MapData);

/** The fixture's terrain (from the 1.5.6 map note) as a routing context, the way MapStore builds it. */
function fixtureContext() {
  const d = parseMapNote(read("1.5.6", "map-note.md"))!;
  return {
    hexes: d.hexes,
    ctx: mapRouteContext({ orientation: "flat", stagger: "odd", gridSize: { cols: 14, rows: 10 }, gridOffset: { x: 0, y: 0 }, baseTerrain: "grass", terrainOf: d.hexes, impassable: impassableNames(DEFAULT_TERRAIN_PALETTE) }),
  };
}

const sameSteps = (a: Iterable<readonly string[]>, b: Iterable<readonly string[]>) => {
  const x = stepsOf(a), y = stepsOf(b);
  return x.size === y.size && [...x].every((s) => y.has(s));
};

describe("migration from every-hex chains (section 6 tests a–c)", () => {
  beforeEach(() => { Notice.shown = []; });

  it("(a) format 3 rows read into dense anchors equal to the old hexes", () => {
    const d = parseMapNote(read("map-note-formats", "format-3.md"))!;
    expect(d.paths.map((p) => p.branches[0].anchors)).toEqual([
      Array.from({ length: 14 }, (_, x) => `${x}_8`),
      ["4_0", "4_1", "4_2", "4_3", "4_4", "4_5"],
    ]);
  });

  it("(b) a format-4 note converts once (backup + report), merges touching chains, drops bare one-hex leftovers, and draws the same steps", async () => {
    const text = read("map-note-formats", "format-4.md");
    const before = parseMapNote(text)!;
    const v = new MemVault({ [NOTE]: text });
    const m = [fixtureMap()];
    const { store } = await boot(v, m);
    const now = v.files.get(NOTE)!;
    expect(now).toMatch(new RegExp(`^hexmaker-map: ${MAP_NOTE_FORMAT}$`, "m"));
    // the main road and its branch south from 9, 8 are one path now; the one-hex Road at 12, 2 is gone
    const d = parseMapNote(now)!;
    expect(d.paths.map((p) => [p.name, p.typeName, p.branches.length])).toEqual([["Road", "Road", 2], ["River", "River", 1], ["Old Track", "Old Track", 1]]);
    expect(d.paths[0].notes).toBe("Paved as far as Saltmere.");
    expect(d.paths[0].branches[1].anchors[0]).toBe("9_8");
    // every type's drawn steps are exactly the old chains' steps
    const resolved = store.resolved("m")!;
    for (const type of ["Road", "River", "Old Track"]) {
      const old = before.paths.filter((p) => p.typeName === type && p.branches[0].anchors.length > 1).map((p) => p.branches[0].anchors);
      expect(sameSteps(resolved.filter((r) => r.typeName === type).map((r) => r.hexes), old)).toBe(true);
    }
    // the compatibility view is those chains
    expect(sameSteps(m[0].pathChains.map((c) => c.hexes), resolved.map((r) => r.hexes))).toBe(true);
    // fewer anchors than hexes
    expect(d.paths[0].branches[0].anchors.length).toBeLessThan(14);
    const files = [...v.files.keys()].filter((k) => k.includes("/backups/map-notes-")).map((k) => k.split("/").pop());
    expect(files.sort()).toEqual(["m-map-note.md", "m-paths-report.md"]);
    const report = v.files.get([...v.files.keys()].find((k) => k.endsWith("m-paths-report.md"))!)!;
    expect(report).toContain("- Old paths (every hex listed): 5");
    expect(report).toContain("- One-hex leftovers dropped (no notes): 1");
    expect(report).toContain("- Road 3 (Road) at 12, 2");
    expect(report).toContain("- Road: Road, Road 2");
    expect(Notice.shown.some((n) => n.msg.includes("moved to the new format") && n.msg.includes("one-hex leftover"))).toBe(true);
    // a restart rewrites nothing
    v.writes = [];
    await boot(v, [fixtureMap()]);
    expect(v.writes).toEqual([]);
  });

  it("(c) the 1.5.6 map.json (data.json chains, no note yet) becomes format 5 drawing the same hexes", async () => {
    const json = JSON.parse(read("1.5.6", "map.json")) as MapData;
    const { hexes, ctx } = fixtureContext();
    // the store migrates hex notes; give it the fixture's terrain as hex notes
    const files: Record<string, string> = {};
    for (const [k, h] of hexes) if (h.terrain) files[`world/hexes/m/${k}.md`] = `---\nterrain: ${h.terrain}\n---\n`;
    const v = new MemVault(files);
    const m = [fixtureMap({ pathChains: json.pathChains })];
    const old = json.pathChains.map((c) => c.hexes);
    const { store } = await boot(v, m);
    const d = parseMapNote(v.files.get(NOTE)!)!;
    expect(d.format).toBe(MAP_NOTE_FORMAT);
    expect(d.paths.map((p) => p.name)).toEqual(["Road", "River"]);
    // resolved chains equal the old chains, hex for hex
    expect(store.resolved("m")!.map((r) => r.hexes)).toEqual(old);
    // and the same holds for a resolver that only has the note and the palette
    const styleFor = pathTypeStyleFor(DEFAULT_PATH_TYPES);
    expect(resolvedToChains(resolvePaths(d.paths, ctx, styleFor)).map((c) => c.hexes)).toEqual(old);
    expect(m[0].pathChains.map((c) => c.hexes)).toEqual(old);
    // the old chains are in the backup
    const backup = JSON.parse(v.files.get([...v.files.keys()].find((k) => k.endsWith("/m.json"))!)!);
    expect(backup.pathChains.map((c: PathChain) => c.hexes)).toEqual(old);
  });

  it("drops only bare one-hex leftovers: one with notes or an extra column stays", () => {
    const { ctx } = fixtureContext();
    const paths = legacyChainsToPaths([
      { typeName: "Road", hexes: ["1_1"] },
      { typeName: "Road", hexes: ["2_2"], extra: { Notes: "the old well" } },
      { typeName: "Road", hexes: ["3_3"], extra: { Owner: "Ada" } },
    ]);
    const { paths: out, report } = compactLegacy(paths, ctx, { dropSingles: true, styleFor: pathTypeStyleFor(DEFAULT_PATH_TYPES) });
    expect(out.map((p) => [p.branches[0].anchors, p.notes ?? "", p.extra ?? {}])).toEqual([[["2_2"], "the old well", {}], [["3_3"], "", { Owner: "Ada" }]]);
    expect(report.singlesDropped.map((s) => s.hex)).toEqual(["1_1"]);
  });
});

describe("map store: path edits, hand edits and the three-way merge", () => {
  beforeEach(() => { Notice.shown = []; });

  const fresh = async () => {
    const v = new MemVault();
    const m = [fixtureMap({ pathChains: [{ typeName: "Road", hexes: ["0_0", "1_0", "2_0", "3_0"] }] })];
    const r = await boot(v, m);
    return { v, m, ...r };
  };
  const modify = async (store: MapStore, p: ReturnType<typeof plugin>, v: MemVault, text: string) => {
    v.files.set(NOTE, text);
    store.onModify(p.app.vault.getAbstractFileByPath(NOTE) as never);
    await store.flush();
  };

  it("a hand edit to Path routes is imported (anchor added, formatting normalised, a garbage row reported)", async () => {
    const { v, m, p, store } = await fresh();
    const text = v.files.get(NOTE)!;
    const row = text.split("\n").find((l) => l.startsWith("| Road | main |"))!;
    const edited = text.replace(row, "|road|MAIN| 0,0 -> 3,0 ; 3_3 |\n| Road | fork | banana |");
    await modify(store, p, v, edited);
    expect(m[0].paths![0].branches[0].anchors).toEqual(["0_0", "3_0", "3_3"]);
    // the compatibility view follows
    expect(m[0].pathChains[0].hexes.slice(-1)).toEqual(["3_3"]);
    expect(Notice.shown.some((n) => n.msg.includes("couldn't be read") && n.msg.includes("banana"))).toBe(true);
    // the next write normalises and keeps the bad row with its warning
    store.set("m", "5_5", { terrain: "forest" });
    await store.flush();
    const out = v.files.get(NOTE)!;
    expect(out).toContain("| Road | main | 0, 0 → 3, 0 → 3, 3 |\n| Road | fork | banana |\n\n> [!warning] Hexmaker couldn't read a row in this table");
  });

  it("three-way merge by name: our pending edit and their hand edit to another path both survive", async () => {
    const v = new MemVault();
    const m = [fixtureMap({ pathChains: [{ typeName: "Road", hexes: ["0_0", "1_0"] }, { typeName: "River", hexes: ["5_0", "5_1"] }] })];
    const { store } = await boot(v, m);
    // ours: extend the road through the old view (as the path tool does)
    m[0].pathChains[0].hexes.push("2_0");
    // theirs, on disk, not seen by the store yet: rename the river's notes
    const text = v.files.get(NOTE)!;
    const river = text.split("\n").find((l) => l.startsWith("| River | River |"))!;
    v.files.set(NOTE, text.replace(river, river.replace(/\|  \|$/, "| muddy |")));
    store.set("m", "9_9", { terrain: "forest" }); // any write
    await store.flush();
    const d = parseMapNote(v.files.get(NOTE)!)!;
    expect(d.paths.find((p) => p.name === "River")!.notes).toBe("muddy");
    expect(store.resolved("m")!.find((r) => r.path === "Road")!.hexes).toEqual(["0_0", "1_0", "2_0"]);
  });

  it("mergePaths: theirs wins where they changed it, ours elsewhere; deletions on either side stick", () => {
    const base = [P("A", "Road", ["1_1", "2_1"]), P("B", "Road", ["5_5", "6_5"]), P("C", "River", ["0_0", "0_1"])];
    const theirs = [P("A", "Road", ["1_1", "3_1"]), P("C", "River", ["0_0", "0_1"]), P("D", "Road", ["9_9", "9_8"])];
    const ours = [P("A", "Road", ["1_1", "2_1"]), P("B", "Road", ["5_5", "7_5"]), P("C", "River", ["0_0", "0_2"]), P("E", "Trail", ["4_4", "4_5"])];
    expect(mergePaths(base, theirs, ours).map((p) => [p.name, p.branches[0].anchors.join(" ")])).toEqual([
      ["A", "1_1 3_1"], // they changed it
      ["C", "0_0 0_2"], // we changed it
      ["D", "9_9 9_8"], // they added it
      ["E", "4_4 4_5"], // we added it
    ]); // B: they deleted it
  });

  it("isReady(map): not before load, not for a broken note, yes once terrain and palette are in", async () => {
    const v = new MemVault({ [NOTE]: "---\nhexmaker-map: 5\n---\n## Hexes\n| Terrain |\n| --- |\n| x |\n" });
    const m = [fixtureMap(), fixtureMap({ name: "n" })];
    const p = plugin(v, m);
    const store = new MapStore(p as never);
    expect(store.isReady("n")).toBe(false);
    expect(store.resolved("n")).toBeNull();
    await store.init();
    expect(store.isReady()).toBe(true);
    expect(store.isReady("m")).toBe(false); // its note can't be read
    expect(store.isReady("n")).toBe(true);
    expect(store.resolved("n")).toEqual([]);
  });

  it("painting impassable terrain under a road keeps its route (anchors added); a context listener can take over", async () => {
    const v = new MemVault();
    const m = [fixtureMap({ pathChains: [{ typeName: "Road", hexes: ["0_5", "1_5", "2_5", "3_5", "4_5", "5_5", "6_5"] }] })];
    const { store } = await boot(v, m);
    const before = store.resolved("m")![0].hexes;
    expect(m[0].paths![0].branches[0].anchors.length).toBeLessThan(before.length);
    const anchors = m[0].paths![0].branches[0].anchors.length;
    store.set("m", "3_5", { terrain: "shallows" }); // water: impassable by its type
    expect(store.resolved("m")![0].hexes).toEqual(before);
    expect(m[0].paths![0].branches[0].anchors.length).toBeGreaterThan(anchors);
    // forest changes nothing
    const pinned = JSON.stringify(m[0].paths);
    store.set("m", "4_5", { terrain: "forest" });
    store.resolved("m");
    expect(JSON.stringify(m[0].paths)).toBe(pinned);
    // a listener that handles it: the store doesn't pin
    const seen: string[] = [];
    store.onRouteContextChange((e) => { seen.push(e.map); return true; });
    store.set("m", "5_5", { terrain: "shallows" });
    expect(seen).toEqual(["m"]);
    expect(JSON.stringify(m[0].paths)).toBe(pinned);
  });

  it("a path drawn after painting water on a map with no paths routes around it (never pinned to the old terrain)", async () => {
    const v = new MemVault();
    const m = [fixtureMap()];
    const { store } = await boot(v, m);
    expect(store.resolved("m")).toEqual([]); // the store has a routing context now
    store.set("m", "3_5", { terrain: "shallows" }); // no paths yet
    const seen: string[] = [];
    store.onRouteContextChange((e) => { seen.push(e.map); });
    store.setPaths("m", [P("Road", "Road", ["0_5", "6_5"])]);
    expect(m[0].paths![0].branches[0].anchors).toEqual(["0_5", "6_5"]);
    expect(store.resolved("m")![0].hexes).not.toContain("3_5");
    expect(seen).toEqual([]); // the context was already current: nothing to pin
  });

  it("setPaths settles a stale routing context against the OLD paths, never the new ones", async () => {
    const v = new MemVault();
    const m = [fixtureMap()];
    const { store } = await boot(v, m);
    // Where a road from 0,5 to 6,5 goes on open ground.
    store.setPaths("m", [P("Road", "Road", ["0_5", "6_5"])]);
    const open = store.resolved("m")![0].hexes;
    const mid = open[Math.floor(open.length / 2)];
    store.setPaths("m", []);
    store.set("m", mid, { terrain: "forest" });
    // A context change the store hasn't seen yet (palette edit: forest becomes impassable).
    const palette = DEFAULT_TERRAIN_PALETTE.map((t) => (t.name === "forest" ? { ...t, impassable: true } : t));
    (store as unknown as { plugin: { getMapPalette: () => unknown } }).plugin.getMapPalette = () => palette;
    store.setPaths("m", [P("Road", "Road", ["0_5", "6_5"])]);
    expect(m[0].paths![0].branches[0].anchors).toEqual(["0_5", "6_5"]);
    expect(store.resolved("m")![0].hexes).not.toContain(mid);
  });

  it("a format-6 note is broken with a notice that names the format and says to update", async () => {
    const v = new MemVault({ [NOTE]: buildMapNote("m", data([KINGS])).replace(`hexmaker-map: ${MAP_NOTE_FORMAT}`, "hexmaker-map: 6") });
    const before = v.files.get(NOTE);
    const { store } = await boot(v, [fixtureMap()]);
    expect(store.holdsPaths("m")).toBe(false);
    expect(Notice.shown.some((n) => n.msg.includes("map-note format 6") && n.msg.includes("Update Hexmap World Creator"))).toBe(true);
    expect(v.files.get(NOTE)).toBe(before);
  });
});

describe("the compatibility view (pathChains ↔ paths)", () => {
  const route = (hexes: string[]) => hexes; // dense anchors (exact by construction)
  const anchorsOf = (_t: string, h: string[]) => route(h);
  const view = (paths: MapPath[]) => buildView(paths.flatMap((p) => p.branches.map((b, i) => ({ path: p.name, typeName: p.typeName, branch: i, hexes: b.anchors, anchorIdx: [], fallbackSegments: [] }))));

  it("an in-place push edits that branch; names, notes and the other branches stay", () => {
    const paths = [{ ...P("King's Road", "Road", ["0_0", "1_0"], ["1_0", "1_1"]), notes: "paved" }];
    const { chains, view: v } = view(paths);
    chains[0].hexes.push("2_0");
    const r = reconcile(paths, chains, v, anchorsOf);
    expect(r.changed).toBe(true);
    expect(r.paths).toEqual([{ ...P("King's Road", "Road", ["0_0", "1_0", "2_0"], ["1_0", "1_1"]), notes: "paved" }]);
  });

  it("a new chain is a new path named after its type; a removed one goes, and undo brings its name back", () => {
    const paths = [P("King's Road", "Road", ["0_0", "1_0"])];
    const { chains, view: v } = view(paths);
    const r1 = reconcile(paths, [...chains, { typeName: "Road", hexes: ["5_5", "6_5"] }], v, anchorsOf);
    expect(r1.paths.map((p) => p.name)).toEqual(["King's Road", "Road"]);
    const r2 = reconcile(r1.paths, [], r1.view, anchorsOf);
    expect(r2.paths).toEqual([]);
    // undo: snapshot clones come back
    const r3 = reconcile(r2.paths, [{ typeName: "Road", hexes: ["0_0", "1_0"] }], r2.view, anchorsOf);
    expect(r3.paths.map((p) => p.name)).toEqual(["King's Road"]);
  });

  it("splitting a chain keeps both pieces as branches of the same path", () => {
    const paths = [P("King's Road", "Road", ["0_0", "1_0", "2_0", "3_0", "4_0"])];
    const { chains, view: v } = view(paths);
    const r = reconcile(paths, [{ typeName: "Road", hexes: ["0_0", "1_0"] }, { typeName: "Road", hexes: ["3_0", "4_0"] }], v, anchorsOf);
    void chains;
    expect(r.paths).toEqual([P("King's Road", "Road", ["0_0", "1_0"], ["3_0", "4_0"])]);
  });

  it("renaming a type on every chain of a path renames the path's type", () => {
    const paths = [P("King's Road", "Road", ["0_0", "1_0"], ["1_0", "1_1"])];
    const { chains, view: v } = view(paths);
    for (const c of chains) c.typeName = "Highway";
    expect(reconcile(paths, chains, v, anchorsOf).paths[0].typeName).toBe("Highway");
  });

  it("nothing touched: unchanged", () => {
    const paths = [P("King's Road", "Road", ["0_0", "1_0"])];
    const { chains, view: v } = view(paths);
    expect(reconcile(paths, chains, v, anchorsOf).changed).toBe(false);
  });
});
