import { describe, it } from "node:test";
import expect from "expect";
import { pickerGroup, pickerRows, RECENT_MAX, toggleStar, withRecent, type PickerKind } from "../src/worldgen/newMapSetup/pickerRows";
import { newPickerState, renderGeneratorPicker } from "../src/worldgen/newMapSetup/generatorPicker";
import type { TerrainGeneratorKind } from "../src/worldgen/registry";
import { readSurface } from "./helpers/source";
import { fakeRoot, type FakeEl } from "./helpers/fakeDom";
import { readFileSync } from "node:fs";

/** HF8 step 2 (owner A1–A4, C1): New map's generator list is a short searchable tree. */

const FOLDER = "world/generators";
const KINDS: PickerKind[] = [
  { id: "blank", label: "Blank", source: "blank" },
  { id: "procedural:overland", label: "Overland", source: "built-in", continuesNeighbours: true },
  { id: "procedural:region-detail", label: "Region detail", source: "built-in" },
  { id: "builtin:biome-taiga", label: "Taiga", source: "built-in", continuesNeighbours: true },
  { id: "builtin:biome-tundra", label: "Tundra", source: "built-in" },
  { id: "builtin:preset-valley", label: "Valley", source: "built-in" },
  { id: "wfc:world/generators/blend-taiga-to-tundra.md", label: "blend-taiga-to-tundra", source: "learned", generatorPath: "world/generators/blend-taiga-to-tundra.md" },
  { id: "wfc:world/generators/the-coast.md", label: "the-coast", source: "learned", generatorPath: "world/generators/the-coast.md" },
  { id: "wfc:world/generators/mine/coasts/bay.md", label: "bay", source: "learned", generatorPath: "world/generators/mine/coasts/bay.md" },
];
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("the generator list's rows", () => {
  it("groups the shipped families and your folders; the engines and your own stay at the top", () => {
    expect(KINDS.map((k) => pickerGroup(k, FOLDER))).toEqual([
      "", "", "", "preset:biome", "preset:biome", "preset:preset", "preset:blend", "", "folder:mine/coasts",
    ]);
    const { starred, recent, tree } = pickerRows(KINDS, { generatorsFolder: FOLDER });
    expect([starred, recent]).toEqual([[], []]);
    // Blank is a Terrain choice of its own, never in the list.
    expect(ids(tree.top)).toEqual(["procedural:overland", "procedural:region-detail", "wfc:world/generators/the-coast.md"]);
    expect(tree.groups.map((g) => [g.label, g.rows.length, g.open])).toEqual([["coasts", 1, false], ["Biomes", 2, false], ["Blends", 1, false], ["Presets", 1, false]]);
    expect(tree.visible.length).toBe(3);
  });

  it("starred first, then recent (not repeated), each shown once; the picked one opens its group", () => {
    const { starred, recent, tree } = pickerRows(KINDS, {
      generatorsFolder: FOLDER,
      starred: ["builtin:biome-taiga", "gone:id"],
      recent: ["builtin:biome-taiga", "procedural:overland", "builtin:preset-valley"],
      current: "builtin:biome-tundra",
    });
    expect(ids(starred)).toEqual(["builtin:biome-taiga"]);
    expect(ids(recent)).toEqual(["procedural:overland", "builtin:preset-valley"]);
    expect(ids(tree.top)).toEqual(["procedural:region-detail", "wfc:world/generators/the-coast.md"]);
    expect(tree.groups.map((g) => [g.label, ids(g.rows), g.open])).toEqual([
      ["coasts", ["wfc:world/generators/mine/coasts/bay.md"], false],
      ["Biomes", ["builtin:biome-tundra"], true],
      ["Blends", ["wfc:world/generators/blend-taiga-to-tundra.md"], false],
    ]);
  });

  it("a search matches every word in the name, tags, group and description, and opens the groups it finds", () => {
    const tundra = pickerRows(KINDS, { generatorsFolder: FOLDER, query: "tundra" });
    expect(tundra.tree.top).toEqual([]);
    expect(tundra.tree.groups.map((g) => [g.label, g.open])).toEqual([["Biomes", true], ["Blends", true]]);
    expect(ids(pickerRows(KINDS, { generatorsFolder: FOLDER, query: "biomes" }).tree.visible)).toEqual(["builtin:biome-taiga", "builtin:biome-tundra"]);
    expect(ids(pickerRows(KINDS, { generatorsFolder: FOLDER, query: "learned coast" }).tree.visible)).toEqual(["wfc:world/generators/the-coast.md", "wfc:world/generators/mine/coasts/bay.md"]);
    const text = (k: PickerKind) => (k.id === "procedural:overland" ? "Continents with coasts and rivers" : "");
    expect(ids(pickerRows(KINDS, { generatorsFolder: FOLDER, query: "rivers", text }).tree.visible)).toEqual(["procedural:overland"]);
  });

  it("tags: learned, blend, and next to a map the ones that continue its edge", () => {
    const rows = pickerRows(KINDS, { generatorsFolder: FOLDER, neighbour: true, expanded: new Map([["preset:biome", true], ["preset:blend", true]]) }).tree.visible;
    const tags = Object.fromEntries(rows.map((r) => [r.label, r.tags]));
    expect(tags).toMatchObject({ Overland: ["continues"], Taiga: ["continues"], Tundra: [], "the-coast": ["learned"], "blend-taiga-to-tundra": ["learned", "blend"] });
  });

  it("Recent keeps the last five, newest first; stars toggle", () => {
    let r: string[] | undefined;
    for (const id of ["a", "b", "c", "a", "d", "e", "f"]) r = withRecent(r, id);
    expect(r).toEqual(["f", "e", "d", "a", "c"]);
    expect(r).toHaveLength(RECENT_MAX);
    expect(toggleStar(undefined, "x")).toEqual(["x"]);
    expect(toggleStar(["x", "y"], "x")).toEqual(["y"]);
  });
});

describe("the generator list on the form", () => {
  const kinds = KINDS.map((k) => ({ ...k, description: `${k.label} text`, options: [], fits: () => true })) as unknown as TerrainGeneratorKind[];
  const draw = (over: Partial<Parameters<typeof renderGeneratorPicker>[1]> = {}) => {
    const { root, el } = fakeRoot();
    const picked: string[] = [];
    const starred: string[] = [];
    const state = newPickerState();
    renderGeneratorPicker(el, {
      kinds, terrains: [], selected: "procedural:overland", state, generatorsFolder: FOLDER, starred, recent: [],
      star: (id) => { starred.push(id); }, pick: (k) => picked.push(k.id), ...over,
    });
    const names = () => root.all((e) => e.classes.has("duckmage-gen-pick-name")).map((e) => e.text);
    return { root, picked, starred, state, names };
  };
  const rowsOf = (root: FakeEl) => root.all((e) => e.classes.has("duckmage-gen-pick-row"));

  it("one line each, the picked one with its description; groups collapsed; a click picks", () => {
    const { root, picked, names } = draw();
    expect(names()).toEqual(["Overland", "Region detail", "the-coast"]);
    expect(root.all((e) => e.classes.has("duckmage-gen-pick-desc")).map((e) => e.text)).toEqual(["Overland text"]);
    expect(root.all((e) => e.classes.has("duckmage-gen-pick-group")).length).toBe(4);
    rowsOf(root)[2].fire("click");
    expect(picked).toEqual(["wfc:world/generators/the-coast.md"]);
  });

  it("typing filters (the groups with a match open); a group header opens and closes it", () => {
    const { root, names, state } = draw();
    const search = root.inputs("search")[0];
    search.value = "tundra";
    search.fire("input");
    expect(state.query).toBe("tundra");
    expect(names()).toEqual(["Tundra", "blend-taiga-to-tundra"]);
    search.value = "";
    search.fire("input");
    root.all((e) => e.classes.has("duckmage-gen-pick-group"))[1].fire("click");
    expect(names()).toContain("Taiga");
    expect(state.expanded.get("preset:biome")).toBe(true);
  });

  it("the star stars without picking; the note above says once what \"continues\" means", () => {
    const { root, picked, starred } = draw({ neighbour: "Ashfall" });
    const star = root.all((e) => e.classes.has("duckmage-gen-pick-star"))[0];
    star.fire("click", { stopPropagation: () => {}, preventDefault: () => {} });
    expect(starred).toEqual(["procedural:overland"]);
    expect(picked).toEqual([]);
    expect(root.all((e) => e.classes.has("duckmage-gen-pick-seam")).map((e) => e.text)).toEqual(['Next to Ashfall: the ones tagged "continues" carry its edge on; the others ignore it.']);
    expect(root.all((e) => e.classes.has("duckmage-setup-gen-seam"))).toEqual([]);
  });

  it("scrolls inside a fixed height (owner C1), and New map remembers what it made maps with", () => {
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    const rule = css.slice(css.indexOf(".duckmage-gen-pick-list {"), css.indexOf("}", css.indexOf(".duckmage-gen-pick-list {")));
    expect(rule).toMatch(/max-height: 16em/);
    expect(rule).toMatch(/overflow-y: auto/);
    const modal = readSurface("new-map-setup");
    expect(modal).toContain("renderGeneratorPicker(genList,");
    expect(modal).toContain("withRecent(this.plugin.settings.recentGenerators, kind.id)");
  });
});
