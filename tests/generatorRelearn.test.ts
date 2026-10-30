/**
 * Re-learn and re-blend change a generator note's frontmatter values and
 * its own tables, nothing else: the user's prose, properties and other
 * tables stay (open-work, audit-generated-notes-2026-10-10; data loss).
 */
import { describe, it } from "node:test";
import expect from "expect";
import { TFile, TFolder } from "obsidian";
import { blendGenerators, generatorText, listGenerators, reblendGenerator, relearnGenerator, saveGeneratorFromMap, saveGeneratorModel } from "../src/worldgen/generators";
import { updateGeneratorNote } from "../src/worldgen/generatorNoteUpdate";
import { parseModelMarkdown, type HexWfcModel } from "../packages/hex-wfc/src";
import type HexmakerPlugin from "../src/HexmakerPlugin";

function makePlugin(painted: Record<string, string>) {
  const files = new Map<string, string>();
  const folders = new Set<string>();
  const fileObj = (path: string) => {
    const f = Object.create(TFile.prototype) as TFile;
    f.path = path;
    f.basename = path.split("/").pop()!.replace(/\.md$/, "");
    return f;
  };
  const terrain = new Map(Object.entries(painted));
  const hexPath = (x: number, y: number, map: string) => `world/hexes/${map}/${x}_${y}.md`;
  const app = {
    vault: {
      getAbstractFileByPath: (p: string) => {
        if (files.has(p) || /\/\d+_\d+\.md$/.test(p)) return fileObj(p);
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
      read: async (f: TFile) => files.get(f.path) ?? "",
      process: async (f: TFile, fn: (text: string) => string) => {
        const next = fn(files.get(f.path) ?? "");
        files.set(f.path, next);
        return next;
      },
    },
    metadataCache: {
      getFileCache: (f: TFile) => {
        const m = /(\d+)_(\d+)\.md$/.exec(f.path);
        const t = m ? terrain.get(`${m[1]}_${m[2]}`) : undefined;
        return t ? { frontmatter: { terrain: t } } : null;
      },
      getFirstLinkpathDest: () => null,
      fileToLinktext: (f: TFile) => f.basename,
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
    manifest: { version: "2.0.0" },
    getMap: (name: string) => plugin.settings.maps.find((m) => m.name === name),
    getMapPalette: () => palette,
    getPaletteByName: () => ({ name: "Default", terrains: palette }),
    hexPath,
    paths: { resolvedPathChains: () => [] },
  } as unknown as HexmakerPlugin;
  return { plugin, files, terrain };
}

function lake(water: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (let x = 0; x < 12; x++) for (let y = 0; y < 10; y++) {
    const d = (x - 5) ** 2 + (y - 5) ** 2;
    out[`${x}_${y}`] = d < water ? "Water" : d < water + 8 ? "Sand" : "Grass";
  }
  return out;
}

const PROSE = "My own notes: the lake is haunted. Keep this.";

async function saved(p: ReturnType<typeof makePlugin>, edit: (text: string) => string) {
  const made = await saveGeneratorFromMap(p.plugin, "sample", "lakes");
  if ("error" in made) throw new Error(made.error);
  p.files.set(made.file.path, edit(p.files.get(made.file.path)!));
  const g = (await listGenerators(p.plugin)).find((x) => x.file.path === made.file.path)!;
  return { g, path: made.file.path };
}

const terrainsOf = (text: string) => parseModelMarkdown(text).model.terrains;

describe("re-learn keeps the user's text", () => {
  it("prose above, between and after the tables, its own table and headings", async () => {
    const p = makePlugin(lake(6));
    const { g, path } = await saved(p, (t) => t
      .replace("## Terrains", `${PROSE} (above)\n\n## Terrains\n\nPROSE under the heading.`)
      .replace("## Adjacency", `Between the tables.\n\n## Adjacency`)
      + "\n## Session notes\n\nWe went here twice.\n\n| When | Who |\n| --- | --- |\n| Tuesday | Ana |\n");
    const before = terrainsOf(p.files.get(path)!).find((t) => t.name === "Water")!.weight;
    for (const [k, v] of Object.entries(lake(20))) p.terrain.set(k, v);
    const r = await relearnGenerator(p.plugin, g);
    expect("model" in r).toBe(true);
    const after = p.files.get(path)!;
    for (const kept of [`${PROSE} (above)`, "PROSE under the heading.", "Between the tables.", "## Session notes", "We went here twice.", "| Tuesday | Ana |"]) expect(after).toContain(kept);
    // The tables did change.
    expect(terrainsOf(after).find((t) => t.name === "Water")!.weight).not.toBe(before);
    expect(after.indexOf("PROSE under the heading.")).toBeLessThan(after.indexOf("| Terrain | Weight"));
  });

  it("a property added after the note was listed, nested YAML and block lists stay as written", async () => {
    const p = makePlugin(lake(6));
    const { g, path } = await saved(p, (t) => t.replace(/^name: .*$/m, (l) => `${l}\ntags:\n  - haunted\n  - wet\nstats:\n  danger: high`));
    // Added between the listing and the write.
    p.files.set(path, p.files.get(path)!.replace(/^name: .*$/m, (l) => `${l}\nmy-rating: 5`));
    await relearnGenerator(p.plugin, g);
    const after = p.files.get(path)!;
    expect(after).toContain("my-rating: 5");
    expect(after).toContain("tags:\n  - haunted\n  - wet");
    expect(after).toContain("stats:\n  danger: high");
    expect(after).not.toContain('stats: ""');
  });

  it("a note whose frontmatter broke since it was listed keeps all its text", async () => {
    const p = makePlugin(lake(6));
    const { g, path } = await saved(p, (t) => t.replace("## Terrains", `${PROSE}\n\n## Terrains`));
    p.files.set(path, p.files.get(path)!.replace(/^---\n/, ""));
    await relearnGenerator(p.plugin, g);
    expect(p.files.get(path)!).toContain(PROSE);
    expect(terrainsOf(p.files.get(path)!).length).toBeGreaterThan(0);
  });

  it("settings it no longer has go; a source key the re-made model dropped goes", () => {
    const m: HexWfcModel = { name: "x", terrains: [{ name: "Grass", weight: 1 }], adjacency: [{ a: "Grass", b: "Grass", weight: 1 }], meta: { "source-influence": "60 + 40", mine: "keep" } };
    const plugin = { settings: { worldFolder: "world" }, app: { vault: { getAbstractFileByPath: () => null } } } as never;
    const old = generatorText(plugin, { ...m, settings: { featureSize: 2 } });
    const next = updateGeneratorNote(old, generatorText(plugin, { ...m, meta: { mine: "keep" } }));
    expect(next).not.toContain("source-influence");
    expect(next).not.toMatch(/^feature-size:/m);
    expect(next).toContain("mine: keep");
  });

  it("a heading of the user's with a section's name doesn't hide the real table", () => {
    const m: HexWfcModel = { name: "x", terrains: [{ name: "Grass", weight: 1 }], adjacency: [{ a: "Grass", b: "Grass", weight: 1 }], meta: {} };
    const plugin = { settings: { worldFolder: "world" }, app: { vault: { getAbstractFileByPath: () => null } } } as never;
    const old = generatorText(plugin, m).replace("## Terrains", "### Terrains\n\nWhy I picked these.\n\n## Terrains");
    const next = updateGeneratorNote(old, generatorText(plugin, { ...m, terrains: [{ name: "Grass", weight: 7 }] }));
    expect(next).toContain("Why I picked these.");
    expect(parseModelMarkdown(next).model.terrains[0].weight).toBe(7);
  });
});

describe("re-blend keeps the user's text", () => {
  it("prose and its own table stay; the tables follow the sources", async () => {
    const p = makePlugin(lake(6));
    const a = await saveGeneratorFromMap(p.plugin, "sample", "one");
    for (const [k, v] of Object.entries(lake(20))) p.terrain.set(k, v);
    const b = await saveGeneratorFromMap(p.plugin, "sample", "two");
    if ("error" in a || "error" in b) throw new Error("not saved");
    const sources = (await listGenerators(p.plugin));
    const blend = blendGenerators(p.plugin, sources, "both");
    if ("error" in blend) throw new Error(blend.error);
    const made = await saveGeneratorModel(p.plugin, blend.model);
    p.files.set(made.file.path, p.files.get(made.file.path)!.replace("## Terrains", `${PROSE}\n\n## Terrains`) + "\n## Mine\n\n| A |\n| --- |\n| 1 |\n");
    const g = (await listGenerators(p.plugin)).find((x) => x.file.path === made.file.path)!;
    const r = await reblendGenerator(p.plugin, g, [90, 10]);
    expect("model" in r).toBe(true);
    const after = p.files.get(made.file.path)!;
    expect(after).toContain(PROSE);
    expect(after).toContain("## Mine");
    expect(after).toMatch(/^source-influence: .*90.*10/m);
  });
});
