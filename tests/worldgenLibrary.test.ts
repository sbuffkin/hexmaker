import { describe, it } from "node:test";
import expect from "expect";
import { combinedName, generatorGroupOf, generatorRows, generatorTree, groupLabel, regionRows } from "../src/modules/gen-page/libraryRows";
import { fakeRoot, type FakeEl } from "./helpers/fakeDom";
import { GeneratorLibrary } from "../src/modules/gen-page/GeneratorLibrary";
import type { GeneratorFile } from "../src/worldgen/generators";
import type HexmakerPlugin from "../src/HexmakerPlugin";
import type { App } from "obsidian";

/** The generator page's file list (src/modules/gen-page/libraryRows.ts). */

const generators = [
  { path: "g/the-coast.md", name: "the-coast", sources: ["the-coast"], palette: "Default", terrains: 31, created: "2026-10-01" },
  { path: "g/mixed.md", name: "mixed", sources: ["the-coast", "the-north"], palette: "Default", terrains: 40 },
  { path: "g/island.md", name: "island", sources: ["island"], palette: "test", terrains: 12 },
];
const regions = [
  { name: "the-north", cols: 30, rows: 20, palette: "Default" },
  { name: "the-coast", cols: 38, rows: 25, palette: "Default" },
  { name: "empty", cols: 10, rows: 10, palette: "test" },
];

describe("generator file list", () => {
  it("lists generators by name, with their regions joined", () => {
    const rows = generatorRows(generators);
    expect(rows.map((r) => r.name)).toEqual(["island", "mixed", "the-coast"]);
    expect(rows[1]).toEqual({ path: "g/mixed.md", name: "mixed", from: "the-coast + the-north", palette: "Default", terrains: 40, created: "", group: "" });
  });

  it("filters generators on every typed word, across columns", () => {
    expect(generatorRows(generators, "north").map((r) => r.name)).toEqual(["mixed"]);
    expect(generatorRows(generators, "coast default").map((r) => r.name)).toEqual(["mixed", "the-coast"]);
    expect(generatorRows(generators, "TEST").map((r) => r.name)).toEqual(["island"]);
    expect(generatorRows(generators, "2026-10")).toHaveLength(1);
  });

  it("counts each region's generators, combined ones included", () => {
    const rows = regionRows(regions, generators);
    expect(rows.map((r) => [r.name, r.size, r.generators])).toEqual([
      ["empty", "10×10", 0],
      ["the-coast", "38×25", 2],
      ["the-north", "30×20", 1],
    ]);
    expect(regionRows(regions, generators, "30×20").map((r) => r.name)).toEqual(["the-north"]);
  });

  it("names a combined generator after its regions", () => {
    expect(combinedName(["the-coast", "the-north"])).toBe("the-coast-and-the-north");
  });
});

/** The owner's generators folder (2026-10-16), names only: yours mixed in with the presets. */
const OWNER = [
  "bay-area", "the-coast", "default", "biome-alpine", "biome-badlands", "biome-tundra",
  "biome-tundra-to-preset-archipelago-to-the-coast-normal", "blend-badlands-to-alpine", "blend-taiga-to-tundra",
  "planet-ocean", "planet-ice", "preset-valley", "preset-deep-forest", "preset-deep-forest-to-preset-valley",
].map((name) => ({ path: `world/generators/${name}.md`, name, sources: [], palette: "Default", terrains: 10 }));

describe("T4: the Generators tab as a tree", () => {
  it("groups the preset families; your own (and your blends of presets) stay at the top", () => {
    expect(generatorGroupOf({ name: "biome-alpine" })).toBe("preset:biome");
    expect(generatorGroupOf({ name: "planet-ocean" })).toBe("preset:planet");
    expect(generatorGroupOf({ name: "blend-taiga-to-tundra" })).toBe("preset:blend");
    expect(generatorGroupOf({ name: "biome-tundra-to-preset-archipelago" })).toBe("");
    expect(generatorGroupOf({ name: "the-coast" })).toBe("");
    expect(generatorGroupOf({ name: "biomes" })).toBe("");
    expect(generatorGroupOf({ name: "the-coast", folder: "mine/coasts" })).toBe("folder:mine/coasts");
    expect(groupLabel("folder:mine/coasts")).toBe("coasts");
    expect(groupLabel("preset:planet")).toBe("Planets");
  });

  it("starts with every group closed: yours first, then the families in order", () => {
    const tree = generatorTree(generatorRows(OWNER));
    expect(tree.top.map((r) => r.name)).toEqual(["bay-area", "biome-tundra-to-preset-archipelago-to-the-coast-normal", "default", "preset-deep-forest-to-preset-valley", "the-coast"]);
    expect(tree.groups.map((g) => [g.label, g.rows.length, g.open])).toEqual([
      ["Biomes", 3, false], ["Blends", 2, false], ["Planets", 2, false], ["Presets", 2, false],
    ]);
    expect(tree.visible.map((r) => r.name)).toEqual(tree.top.map((r) => r.name));
  });

  it("keeps opened groups open, and opens the one holding the shown generator", () => {
    const rows = generatorRows(OWNER);
    const opened = generatorTree(rows, { expanded: new Map([["preset:planet", true]]) });
    expect(opened.groups.filter((g) => g.open).map((g) => g.label)).toEqual(["Planets"]);
    expect(opened.visible.map((r) => r.name)).toContain("planet-ice");
    const current = generatorTree(rows, { current: "world/generators/biome-alpine.md" });
    expect(current.groups.find((g) => g.label === "Biomes")!.open).toBe(true);
    // Closed by hand stays closed, even with the shown generator in it.
    const closed = generatorTree(rows, { current: "world/generators/biome-alpine.md", expanded: new Map([["preset:biome", false]]) });
    expect(closed.groups.find((g) => g.label === "Biomes")!.open).toBe(false);
  });

  it("a filter shows only groups with a match, opened; the group's name matches too", () => {
    const tundra = generatorTree(generatorRows(OWNER, "tundra"), { query: "tundra" });
    expect(tundra.groups.map((g) => [g.label, g.rows.map((r) => r.name), g.open])).toEqual([
      ["Biomes", ["biome-tundra"], true],
      ["Blends", ["blend-taiga-to-tundra"], true],
    ]);
    expect(tundra.top.map((r) => r.name)).toEqual(["biome-tundra-to-preset-archipelago-to-the-coast-normal"]);
    const planets = generatorRows(OWNER, "planets");
    expect(planets.map((r) => r.name)).toEqual(["planet-ice", "planet-ocean"]);
  });
});

/** A plugin just big enough for the library's lists. */
function libraryPlugin(): HexmakerPlugin {
  return {
    settings: { worldFolder: "world", maps: [] },
    app: { vault: { getMarkdownFiles: () => [] }, metadataCache: { getFileCache: () => null }, workspace: {} },
    getMap: () => undefined,
  } as unknown as HexmakerPlugin;
}

function libraryFiles(): GeneratorFile[] {
  return OWNER.map((o) => {
    const parentPath = "world/generators";
    return {
      file: { path: o.path, basename: o.name, parent: { path: parentPath } },
      model: { name: o.name, terrains: [], adjacency: [], meta: { palette: "Default" } },
      warnings: [],
    } as unknown as GeneratorFile;
  });
}

const click = (el: FakeEl) => el.fire("click", { target: { closest: () => null }, stopPropagation: () => {} });

describe("T4: the Generators tab on screen", () => {
  const draw = () => {
    const { root, el } = fakeRoot();
    const loaded: string[] = [];
    new GeneratorLibrary({} as App, libraryPlugin(), libraryFiles(), {
      selectedPath: () => "world/generators/the-coast.md",
      load: (g) => loaded.push(g.file.path),
      loadDraft: () => {},
      changed: () => {},
      page: { rerender: () => {}, show: () => {}, paletteName: () => "Default", mapName: () => "" },
    }).render(el);
    const table = () => root.find("is-generators")!;
    const rows = () => table().children.filter((c) => c.classes.has("duckmage-wfc-library-row") && !c.classes.has("is-head"));
    const groups = () => rows().filter((r) => r.classes.has("is-group"));
    const names = () => rows().map((r) => r.all((e) => e.tag === "span" && !!e.text)[0]?.text ?? "");
    return { root, rows, groups, names, loaded };
  };

  it("shows yours, then the closed groups as rows of the same kind", () => {
    GeneratorLibrary.tab = "generators";
    GeneratorLibrary.query = "";
    GeneratorLibrary.expandedGroups.clear();
    GeneratorLibrary.checkedGenerators.clear();
    const v = draw();
    expect(v.names()).toEqual(["bay-area", "biome-tundra-to-preset-archipelago-to-the-coast-normal", "default", "preset-deep-forest-to-preset-valley", "the-coast", "▸", "▸", "▸", "▸"]);
    expect(v.groups().map((g) => g.find("duckmage-wfc-library-group-name")!.children[1].text)).toEqual(["Biomes (3)", "Blends (2)", "Planets (2)", "Presets (2)"]);
    // Same grid: a tick and five cells.
    for (const g of v.groups()) expect(g.children.length).toBe(v.rows()[0].children.length);
  });

  it("clicking a group opens it (kept for the session); its tick ticks all its rows", () => {
    GeneratorLibrary.expandedGroups.clear();
    GeneratorLibrary.checkedGenerators.clear();
    const v = draw();
    click(v.groups()[2]);
    expect(GeneratorLibrary.expandedGroups.get("preset:planet")).toBe(true);
    expect(v.names()).toContain("planet-ice");
    expect(v.rows().find((r) => r.classes.has("is-in-group"))).toBeDefined();
    const planets = v.groups()[2].inputs("checkbox")[0] as FakeEl & { checked?: boolean };
    planets.checked = true;
    planets.fire("change");
    expect([...GeneratorLibrary.checkedGenerators].sort()).toEqual(["world/generators/planet-ice.md", "world/generators/planet-ocean.md"]);
    // A closed group's tick works too, and shows as partly ticked when some are.
    GeneratorLibrary.checkedGenerators.add("world/generators/biome-alpine.md");
    const again = draw();
    const biomes = again.groups()[0].inputs("checkbox")[0] as FakeEl & { indeterminate?: boolean };
    expect(biomes.indeterminate).toBe(true);
    // Still a fresh render opens what was opened this session.
    expect(again.names()).toContain("planet-ocean");
    GeneratorLibrary.expandedGroups.clear();
    GeneratorLibrary.checkedGenerators.clear();
  });

  it("filtering opens the groups with matches; a row still loads on click", () => {
    GeneratorLibrary.expandedGroups.clear();
    GeneratorLibrary.query = "alpine";
    const v = draw();
    expect(v.names()).toEqual(["▾", "biome-alpine", "▾", "blend-badlands-to-alpine"]);
    click(v.rows()[1]);
    expect(v.loaded).toEqual(["world/generators/biome-alpine.md"]);
    GeneratorLibrary.query = "";
  });
});

describe("Saves tab: rename", () => {
  it("Enter pressed again while a rename is running doesn't start a second one", () => {
    let processed = 0;
    const file = { path: "world/generators/saves/a.md", basename: "a", parent: { path: "world/generators/saves" }, stat: { mtime: 1 } };
    const plugin = {
      settings: { worldFolder: "world", maps: [] },
      app: {
        vault: {
          getMarkdownFiles: () => [file],
          getAbstractFileByPath: () => null,
          // Never finishes: the rename is still running when Enter comes again.
          process: () => { processed++; return new Promise(() => {}); },
        },
        metadataCache: { getFileCache: () => ({ frontmatter: { "hexmaker-save": 2, name: "a" } }) },
        fileManager: { renameFile: async () => {} },
        workspace: {},
      },
      getMap: () => undefined,
    } as unknown as HexmakerPlugin;
    GeneratorLibrary.tab = "saves";
    GeneratorLibrary.query = "";
    GeneratorLibrary.checkedSaves.clear();
    GeneratorLibrary.checkedSaves.add(file.path);
    const { root, el } = fakeRoot();
    new GeneratorLibrary({} as App, plugin, [], {
      selectedPath: () => "",
      load: () => {},
      loadDraft: () => {},
      changed: () => {},
      page: { rerender: () => {}, show: () => {}, paletteName: () => "Default", mapName: () => "" },
    }).render(el);
    const input = root.find("duckmage-wfc-save-rename")!;
    expect(input.value).toBe("a");
    input.value = "b";
    input.fire("keydown", { key: "Enter" });
    input.fire("keydown", { key: "Enter" });
    expect(processed).toBe(1);
    GeneratorLibrary.tab = "generators";
  });
});
