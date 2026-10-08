import { describe, it } from "node:test";
import expect from "expect";
import { TFile, TFolder } from "obsidian";
import {
  generatorsFolder,
  generatorFitsPalette,
  listGenerators,
  readMapTerrain,
  readLockedHexes,
  saveGeneratorFromMap,
  saveGeneratorSettings,
  generateTerrain,
  fillMap,
  defaultImpassable,
  generatorSettings,
} from "../src/worldgen/generators";
import { findViolation, parseModelMarkdown, type HexWfcModel } from "../packages/hex-wfc/src";
import type HexmakerPlugin from "../src/HexmakerPlugin";

/**
 * In-memory vault + plugin stub. Hex notes are represented only by their
 * frontmatter (terrain, locked); other written files are kept as text.
 */
function makePlugin(painted: Record<string, string>, locked: string[] = []) {
  const files = new Map<string, string>();
  const folders = new Set<string>();
  const fileObj = (path: string) => {
    const f = Object.create(TFile.prototype) as TFile;
    f.path = path;
    f.basename = path.split("/").pop()!.replace(/\.md$/, "");
    return f;
  };
  const hexPath = (x: number, y: number, map: string) => `world/hexes/${map}/${x}_${y}.md`;
  const hexFm = new Map<string, Record<string, unknown>>();
  for (const [k, t] of Object.entries(painted)) {
    const [x, y] = k.split("_").map(Number);
    hexFm.set(hexPath(x, y, "sample"), { terrain: t });
  }
  for (const k of locked) {
    const [x, y] = k.split("_").map(Number);
    const fm = hexFm.get(hexPath(x, y, "sample")) ?? {};
    fm.locked = true;
    hexFm.set(hexPath(x, y, "sample"), fm);
  }
  const otherFm = new Map<string, Record<string, unknown>>();
  const created: string[] = [];
  const app = {
    vault: {
      getAbstractFileByPath: (p: string) => {
        if (files.has(p) || hexFm.has(p)) return fileObj(p);
        if (folders.has(p)) return Object.create(TFolder.prototype) as TFolder;
        return null;
      },
      createFolder: async (p: string) => void folders.add(p),
      create: async (p: string, text: string) => {
        files.set(p, text);
        return fileObj(p);
      },
      getMarkdownFiles: () => [...files.keys()].map(fileObj),
      cachedRead: async (f: TFile) => files.get(f.path) ?? "",
    },
    metadataCache: {
      getFileCache: (f: TFile) => {
        const fm = hexFm.get(f.path);
        return fm ? { frontmatter: fm } : null;
      },
    },
    fileManager: {
      processFrontMatter: async (f: TFile, fn: (fm: Record<string, unknown>) => void) => {
        const store = hexFm.has(f.path) ? hexFm : otherFm;
        const fm = store.get(f.path) ?? {};
        fn(fm);
        store.set(f.path, fm);
      },
    },
  };
  const palette = ["Grass", "Sand", "Water"].map((name) => ({ name, color: "#000" }));
  const plugin = {
    app,
    settings: {
      worldFolder: "world",
      hexOrientation: "flat",
      staggerOffset: "odd",
      terrainPalettes: [{ name: "Default", terrains: palette }],
      maps: [{ name: "sample", paletteName: "Default", gridSize: { cols: 12, rows: 10 }, gridOffset: { x: 0, y: 0 } }],
    },
    getMap: (name: string) => plugin.settings.maps.find((m) => m.name === name),
    getMapPalette: () => palette,
    getPaletteByName: () => ({ name: "Default", terrains: palette }),
    hexPath,
    createHexNote: async (x: number, y: number, map: string, _tpl?: string, terrain?: string) => {
      const p = hexPath(x, y, map);
      hexFm.set(p, terrain ? { terrain } : {});
      created.push(p);
      return fileObj(p);
    },
    hasTerrainEncounterTable: () => false,
    syncHexEncounterTableLink: async () => {},
  } as unknown as HexmakerPlugin;
  const terrainAt = (k: string) => {
    const [x, y] = k.split("_").map(Number);
    return hexFm.get(hexPath(x, y, "sample"))?.terrain as string | undefined;
  };
  return { plugin, files, otherFm, created, terrainAt };
}

/** A 12×10 painted sample: a lake ringed by sand in grassland. */
function lakeSample(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let x = 0; x < 12; x++)
    for (let y = 0; y < 10; y++) {
      const d = (x - 5) ** 2 + (y - 5) ** 2;
      out[`${x}_${y}`] = d < 6 ? "Water" : d < 14 ? "Sand" : "Grass";
    }
  return out;
}

const PALETTE = ["Grass", "Sand", "Water"];

describe("worldgen generators", () => {
  it("stores generators under the world folder", () => {
    const { plugin } = makePlugin({});
    expect(generatorsFolder(plugin)).toBe("world/generators");
  });

  it("reads painted terrain and locked hexes from the map's notes", () => {
    const { plugin } = makePlugin({ "0_0": "Grass", "3_4": "Water" }, ["3_4"]);
    expect([...readMapTerrain(plugin, "sample")]).toEqual([["0_0", "Grass"], ["3_4", "Water"]]);
    expect([...readLockedHexes(plugin, "sample")]).toEqual(["3_4"]);
  });

  it("learns from a map, saves a readable file, and lists it back", async () => {
    const { plugin, files } = makePlugin(lakeSample());
    const saved = await saveGeneratorFromMap(plugin, "sample", "My Lakes");
    expect("error" in saved).toBe(false);
    if ("error" in saved) return;
    expect(saved.file.path).toBe("world/generators/my-lakes.md");
    const text = files.get("world/generators/my-lakes.md")!;
    expect(text).toContain("hex-wfc: 1");
    expect(text).toContain("palette: Default");
    expect(text).toContain("source-map: sample");
    expect(text).toContain("example-hexes: 120");
    expect(text).toMatch(/\| (Water \| Sand|Sand \| Water) \|/);
    expect(text).not.toMatch(/\| (Water \| Grass|Grass \| Water) \|/); // never touched

    // A second save with the same name doesn't overwrite.
    const again = await saveGeneratorFromMap(plugin, "sample", "my-lakes");
    expect("error" in again ? "" : again.file.path).toBe("world/generators/my-lakes-2.md");

    const listed = await listGenerators(plugin);
    expect(listed.map((g) => g.model.name)).toEqual(["my-lakes", "my-lakes-2"]);
    expect(listed[0].model.adjacency).toEqual(saved.model.adjacency);
  });

  it("refuses to learn from an unpainted map", async () => {
    const { plugin } = makePlugin({});
    const r = await saveGeneratorFromMap(plugin, "sample", "x");
    expect("error" in r).toBe(true);
  });

  it("only offers generators whose terrains are all in the palette", () => {
    const model: HexWfcModel = {
      name: "m", meta: {},
      terrains: [{ name: "Grass", weight: 3 }, { name: "Water", weight: 1 }, { name: "Lava", weight: 0 }],
      adjacency: [],
    };
    expect(generatorFitsPalette(model, ["Grass", "Water", "Hills"])).toBe(true); // weight-0 Lava ignored
    expect(generatorFitsPalette(model, ["Grass"])).toBe(false);
  });

  it("generates a full new map that obeys the learned rules", async () => {
    const { plugin } = makePlugin(lakeSample());
    const saved = await saveGeneratorFromMap(plugin, "sample", "lakes");
    if ("error" in saved) throw new Error(saved.error);
    const r = generateTerrain(plugin, saved.model, PALETTE, { cols: 30, rows: 20, offset: { x: 5, y: 5 }, stagger: "odd" }, 42);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cells.size).toBe(600);
    expect(r.cells.has("5_5")).toBe(true);
    expect(findViolation(saved.model, r.cells, "flat", "odd")).toBeNull();
  });

  it("keeps fixed hexes the generator doesn't know", async () => {
    const { plugin } = makePlugin(lakeSample());
    const saved = await saveGeneratorFromMap(plugin, "sample", "lakes");
    if ("error" in saved) throw new Error(saved.error);
    const r = generateTerrain(plugin, saved.model, PALETTE, { cols: 10, rows: 10, offset: { x: 0, y: 0 }, stagger: "odd" }, 1, new Map([["4_4", "Lava"]]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cells.get("4_4")).toBe("Lava");
  });

  it("saves settings to frontmatter in their text form, and removes cleared ones", async () => {
    const { plugin, otherFm } = makePlugin({});
    const file = Object.create(TFile.prototype) as TFile;
    file.path = "world/generators/g.md";
    await saveGeneratorSettings(plugin, file, { featureSize: 1.5, counts: { Town: { min: 3, max: 3 } }, impassable: ["Water"] });
    // Every write also stamps the plugin version ("unknown" in this stub).
    expect(otherFm.get(file.path)).toEqual({ "feature-size": 1.5, counts: "Town 3", impassable: "Water", "hexmaker-version": "unknown" });
    await saveGeneratorSettings(plugin, file, { featureSize: undefined });
    expect(otherFm.get(file.path)).toEqual({ counts: "Town 3", impassable: "Water", "hexmaker-version": "unknown" });
  });
});

describe("fill this map", () => {
  /** A partly painted map: the lake sample's left half only. */
  const leftHalf = () => Object.fromEntries(Object.entries(lakeSample()).filter(([k]) => Number(k.split("_")[0]) < 6));

  async function lakesModel(): Promise<HexWfcModel> {
    const { plugin } = makePlugin(lakeSample());
    const saved = await saveGeneratorFromMap(plugin, "sample", "lakes");
    if ("error" in saved) throw new Error(saved.error);
    // Round-trip through the file format, as the UI does.
    return parseModelMarkdown(await plugin.app.vault.cachedRead(saved.file)).model;
  }

  it("fills unpainted hexes and keeps every painted one", async () => {
    const model = await lakesModel();
    const painted = leftHalf();
    const { plugin, terrainAt, created } = makePlugin(painted);
    const r = await fillMap(plugin, "sample", model, "unpainted", 7);
    expect("error" in r).toBe(false);
    for (const [k, t] of Object.entries(painted)) expect(terrainAt(k)).toBe(t);
    for (let x = 6; x < 12; x++) for (let y = 0; y < 10; y++) expect(terrainAt(`${x}_${y}`)).toBeDefined();
    expect(created.length).toBe(60); // the right half had no notes yet
    if (!("error" in r)) expect(r.changed).toBe(60);
  });

  it("regenerate repaints everything except locked hexes", async () => {
    const model = await lakesModel();
    const painted = lakeSample();
    const locked = ["5_5", "0_0"];
    const { plugin, terrainAt } = makePlugin(painted, locked);
    const r = await fillMap(plugin, "sample", model, "regenerate", 11);
    expect("error" in r).toBe(false);
    for (const k of locked) expect(terrainAt(k)).toBe(painted[k]);
    const cells = new Map<string, string>();
    for (let x = 0; x < 12; x++) for (let y = 0; y < 10; y++) cells.set(`${x}_${y}`, terrainAt(`${x}_${y}`)!);
    expect(findViolation(model, cells, "flat")).toBeNull();
  });
});

describe("default impassable terrain", () => {
  const base: HexWfcModel = {
    name: "d",
    meta: {},
    terrains: ["Grass", "Shallows", "ocean", "TRENCH", "Hills"].map((name) => ({ name, weight: 1 })),
    adjacency: [],
  };

  it("uses the generator's shallows, ocean and trench, in any case", () => {
    expect(defaultImpassable(base)).toEqual(["Shallows", "ocean", "TRENCH"]);
    expect(generatorSettings(base).impassable).toEqual(["Shallows", "ocean", "TRENCH"]);
  });

  it("only covers terrains the generator has", () => {
    expect(defaultImpassable({ ...base, terrains: [{ name: "Grass", weight: 1 }] })).toEqual([]);
  });

  it("steps aside once the generator saves its own list, even an empty one", () => {
    expect(defaultImpassable({ ...base, settings: { impassable: ["Hills"] } })).toBeUndefined();
    expect(generatorSettings({ ...base, settings: { impassable: [] } }).impassable).toEqual([]);
  });
});
