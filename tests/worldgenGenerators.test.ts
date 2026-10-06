import { describe, it } from "node:test";
import expect from "expect";
import { TFile, TFolder } from "obsidian";
import {
  generatorsFolder,
  generatorFitsPalette,
  listGenerators,
  readMapTerrain,
  saveGeneratorFromMap,
  generateMapTerrain,
} from "../src/worldgen/generators";
import { findViolation, type HexWfcModel } from "../packages/hex-wfc/src";
import type HexmakerPlugin from "../src/HexmakerPlugin";

/**
 * In-memory vault + plugin stub. Hex notes are represented only by their
 * terrain frontmatter; written files are kept as text.
 */
function makePlugin(painted: Record<string, string>) {
  const files = new Map<string, string>();
  const folders = new Set<string>();
  const fileObj = (path: string) => {
    const f = Object.create(TFile.prototype) as TFile;
    f.path = path;
    f.basename = path.split("/").pop()!.replace(/\.md$/, "");
    return f;
  };
  const hexPath = (x: number, y: number, map: string) => `world/hexes/${map}/${x}_${y}.md`;
  const terrainByPath = new Map(
    Object.entries(painted).map(([k, t]) => {
      const [x, y] = k.split("_").map(Number);
      return [hexPath(x, y, "sample"), t];
    }),
  );
  const app = {
    vault: {
      getAbstractFileByPath: (p: string) => {
        if (files.has(p) || terrainByPath.has(p)) return fileObj(p);
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
        const terrain = terrainByPath.get(f.path);
        return terrain ? { frontmatter: { terrain } } : null;
      },
    },
  };
  const plugin = {
    app,
    settings: {
      worldFolder: "world",
      hexOrientation: "flat",
      staggerOffset: "odd",
      maps: [{ name: "sample", paletteName: "Default", gridSize: { cols: 12, rows: 10 }, gridOffset: { x: 0, y: 0 } }],
    },
    getMap: (name: string) => plugin.settings.maps.find((m) => m.name === name),
    hexPath,
  } as unknown as HexmakerPlugin;
  return { plugin, files };
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

describe("worldgen generators", () => {
  it("stores generators under the world folder", () => {
    const { plugin } = makePlugin({});
    expect(generatorsFolder(plugin)).toBe("world/generators");
  });

  it("reads painted terrain from the map's hex notes", () => {
    const { plugin } = makePlugin({ "0_0": "Grass", "3_4": "Water" });
    expect([...readMapTerrain(plugin, "sample")]).toEqual([["0_0", "Grass"], ["3_4", "Water"]]);
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
    const r = generateMapTerrain(plugin, saved.model, ["Grass", "Sand", "Water"], 30, 20, { x: 5, y: 5 }, "odd", 42);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cells.size).toBe(600);
    expect(r.cells.has("5_5")).toBe(true);
    expect(findViolation(saved.model, r.cells, "flat", "odd")).toBeNull();
  });
});
