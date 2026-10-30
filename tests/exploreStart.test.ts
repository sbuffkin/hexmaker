import { describe, it } from "node:test";
import expect from "expect";
import { MemVault } from "./helpers/memVault";
import { fakeRoot, type FakeEl } from "./helpers/fakeDom";
import { readSurface } from "./helpers/source";
import { ExploreService } from "../src/hexflower/ExploreService";
import { FlowerStore } from "../src/hexflower/FlowerStore";
import { setExplore, setFlowerStore } from "../src/hexflower/context";
import { hexFlowerGenerator } from "../src/hexflower/flowerGenerator";
import { countTerrains, describeLand, START_GRID_MAX, onSeam, renderExploreSetup } from "../src/hexflower/exploreSetupForm";
import { parseAreas } from "../src/hexflower/exploreSetup";
import type { TerrainGeneratorKind } from "../src/worldgen/registry";
import type { NewMapModeContext } from "../src/modules/types";

/** HF8 step 4 = HF5 part A: an explore map starts as big as the party can see, from a start hex the user picks. */

const TERRAINS = ["forest", "hills", "lake"];

function kind(id: string, terrain: string): TerrainGeneratorKind {
  return {
    id, label: id.split(":")[1], description: `${id} text`, source: "built-in", options: [], fits: () => true, toPaths: () => ({ paths: [], missing: [] }),
    generate: (req) => {
      const cells = new Map<string, string>();
      for (let x = 0; x < req.grid.cols; x++) for (let y = 0; y < req.grid.rows; y++) cells.set(`${x}_${y}`, terrain);
      return { ok: true, cells, paths: [], warnings: [] };
    },
  };
}
const KINDS = [kind("x:woods", "forest"), kind("x:lakes", "lake")];

function setup() {
  const plugin = {
    app: new MemVault({}).app(),
    manifest: { dir: ".obsidian/plugins/hexmaker" },
    settings: { worldFolder: "world", hexOrientation: "flat", staggerOffset: "odd", maps: [] },
    getPaletteOrPresetTerrains: () => TERRAINS.map((name) => ({ name, color: "#000" })),
    saveSettings: async () => {},
  };
  setFlowerStore(plugin as never, new FlowerStore(plugin as never, () => {}));
  setExplore(plugin as never, new ExploreService(plugin as never, () => {}));
  return plugin;
}

const helpers = { toPaths: () => ({ paths: [], missing: [] }), procGrid: (g: object) => ({ ...g, orientation: "flat" as const }) };

describe("the start size: as big as the party can see", () => {
  it("is (2·sight + 1) square for a blank start; Fill the whole map now keeps the form's size", () => {
    const gen = hexFlowerGenerator(setup() as never, helpers as never);
    expect(gen.sizeFor?.({ start: "blank", reveal: "1" })).toMatchObject({ cols: 3, rows: 3 });
    expect(gen.sizeFor?.({ start: "blank", reveal: "3" })).toMatchObject({ cols: 7, rows: 7 });
    expect(gen.sizeFor?.({ start: "blank", reveal: "entered" })).toMatchObject({ cols: 1, rows: 1 });
    expect(gen.sizeFor?.({ start: "fill", reveal: "2" })).toBeUndefined();
    expect(gen.sizeFor?.({ start: "blank", reveal: "2" })?.why).toBe("Starts 5 × 5, as big as the party can see, and grows as they explore.");
  });

  it("New map hides its size controls behind that line while a generator sets the size, and gives them back after", () => {
    const src = readSurface("new-map-setup");
    expect(src).toContain("kind.sizeFor?.(this.resolvedOptions(kind))");
    expect(src).toContain("size.setBy(set?.why)");
    expect(src).toContain("if (syncSize()) renderGenerators();");
  });
});

describe("Party starts on", () => {
  const grid = { cols: 3, rows: 3, offset: { x: 0, y: 0 }, stagger: "odd" as const };

  function draw(options: Record<string, string> = {}, over: Partial<NewMapModeContext> = {}) {
    const plugin = setup();
    const { root, el } = fakeRoot();
    let changes = 0;
    const ctx: NewMapModeContext = {
      plugin: plugin as never, paletteName: "P", terrains: TERRAINS.map((name) => ({ name, color: "#000" })), generators: KINDS,
      options, changed: () => { changes++; }, target: (_id, f) => f, grid: () => grid, seed: () => 3, ...over,
    };
    renderExploreSetup(el, ctx);
    return { root, options, changes: () => changes };
  }
  const hexes = (root: FakeEl) => root.all((e) => e.classes.has("duckmage-explore-start-hex"));

  it("shows every hex of the start grid, the middle ticked; a click moves the start", () => {
    const { root, options, changes } = draw();
    const cells = hexes(root);
    expect(cells.map((c) => c.attrs["aria-label"])).toEqual(["0, 0", "0, 1", "0, 2", "1, 0", "1, 1", "1, 2", "2, 0", "2, 1", "2, 2"]);
    expect(cells.filter((c) => c.classes.has("is-active")).map((c) => c.attrs["aria-label"])).toEqual(["1, 1"]);
    // Odd columns sit half a hex lower (flat-top, odd stagger).
    expect(root.all((e) => e.classes.has("duckmage-explore-start-line")).map((l) => l.classes.has("is-shifted"))).toEqual([false, true, false]);
    cells[2].fire("click");
    expect(options.startHex).toBe("0_2");
    expect(changes()).toBe(1);
    // Starts on the first engine listed, which the preview resolves at once.
    expect(options.home).toBe("x:woods");
  });

  it("next to a map, its seam edge is marked; a very big grid gets two fields instead", () => {
    const { root } = draw({}, { joins: "east" });
    expect(hexes(root).filter((c) => c.classes.has("is-seam")).map((c) => c.attrs["aria-label"])).toEqual(["0, 0", "0, 1", "0, 2"]);
    expect(onSeam(9, 4, { cols: 10, rows: 8, offset: { x: 0, y: 0 } }, "west")).toBe(true);
    expect(onSeam(3, 7, { cols: 10, rows: 8, offset: { x: 0, y: 0 } }, "north")).toBe(true);
    expect(onSeam(3, 0, { cols: 10, rows: 8, offset: { x: 0, y: 0 } }, "south")).toBe(true);
    expect(onSeam(3, 3, { cols: 10, rows: 8, offset: { x: 0, y: 0 } }, undefined)).toBe(false);
    const side = Math.ceil(Math.sqrt(START_GRID_MAX)) + 1;
    const big = draw({}, { grid: () => ({ cols: side, rows: side, offset: { x: 0, y: 0 }, stagger: "odd" }) });
    expect(hexes(big.root)).toEqual([]);
    expect(big.root.inputs("number").map((i) => i.attrs["aria-label"])).toEqual(["Start column", "Start row"]);
  });

  it("the preview starts on the chosen hex", () => {
    const plugin = setup();
    const gen = hexFlowerGenerator(plugin as never, helpers as never);
    (plugin as unknown as { settings: { hexOrientation: string } }).settings.hexOrientation = "flat";
    const ex = new ExploreService(plugin as never, () => {});
    ex.useKinds(KINDS);
    setExplore(plugin as never, ex);
    const out = gen.generate({ terrains: TERRAINS.map((name) => ({ name, color: "#000" })), grid, seed: 1, options: { home: "x:woods", startHex: "2_2", reveal: "entered", start: "blank" } });
    expect(out.ok && [...out.cells]).toEqual([["2_2", "forest"]]);
  });
});

describe("Powered by: the areas", () => {
  const grid = { cols: 3, rows: 3, offset: { x: 0, y: 0 }, stagger: "odd" as const };
  function draw(options: Record<string, string>) {
    const plugin = setup();
    const { root, el } = fakeRoot();
    const ctx: NewMapModeContext = {
      plugin: plugin as never, paletteName: "P", terrains: TERRAINS.map((name) => ({ name, color: "#000" })), generators: KINDS,
      options, changed: () => { root.empty(); renderExploreSetup(el, ctx); }, target: (_id, f) => f, grid: () => grid, seed: () => 3,
    };
    renderExploreSetup(el, ctx);
    return { root, options };
  }
  const chips = (root: FakeEl) => root.all((e) => e.classes.has("duckmage-explore-area")).map((e) => e.text);

  it("home, then Add another area: far, in an open direction, picked with the list; what its land holds is said", () => {
    const { root, options } = draw({});
    expect(chips(root)).toEqual(["Home: woods"]);
    expect(root.find("duckmage-explore-mix")?.text).toBe("Land: all forest.");
    root.find("duckmage-explore-area-add")!.fire("click");
    expect(parseAreas(options.areas)).toEqual([{ id: "x:woods", dir: "north", reach: "far" }]);
    expect(chips(root)).toEqual(["Home: woods", "North, far: woods"]);
    // The list now picks that area's generator.
    root.all((e) => e.classes.has("duckmage-gen-pick-row"))[1].fire("click");
    expect(parseAreas(options.areas)[0].id).toBe("x:lakes");
    expect(options.home).toBe("x:woods");
    // A second area can't go where the first one is.
    root.find("duckmage-explore-area-add")!.fire("click");
    const dirs = root.all((e) => e.classes.has("duckmage-explore-dir"));
    const north = dirs.find((d) => d.attrs["aria-label"] === "north")!;
    expect(north.disabled).toBe(true);
    expect(north.attrs.title).toBe("lakes lies that way");
    expect(parseAreas(options.areas)[1].dir).not.toBe("north");
  });

  it("an area's ✕ removes it", () => {
    const { root, options } = draw({ home: "x:woods", areas: "south near x:lakes" });
    expect(chips(root)).toEqual(["Home: woods", "South, near: lakes✕"].map((t) => t.replace("✕", "")));
    root.find("duckmage-explore-area-remove")!.fire("click", { stopPropagation: () => {} });
    expect(options.areas).toBe("");
  });
});

describe("Powered by: what the land holds (HF10 hidden tile, not the flower's top six)", () => {
  const T = ["grass", "hills", "mixed forest", "marsh", "desert rocky", "ocean", "snow", "swamp", "tundra", "cliffs"];
  it("the biggest terrains up to about 60% are 'mostly' (three at most), the rest 'also', rare ones too", () => {
    expect(describeLand(new Map([["grass", 50], ["hills", 30], ["mixed forest", 15], ["desert rocky", 4], ["marsh", 1]]), T))
      .toBe("Land: mostly grass and hills; also mixed forest, desert rocky and marsh.");
    expect(describeLand(new Map([["grass", 25], ["hills", 25], ["ocean", 21], ["marsh", 19], ["snow", 10]]), T))
      .toBe("Land: mostly grass, hills and ocean; also marsh and snow.");
    // Under half a percent: left out; past six: "…"; not in the palette: left out.
    const many = new Map<string, number>([["grass", 900], ["hills", 30], ["mixed forest", 20], ["marsh", 15], ["desert rocky", 10], ["ocean", 9], ["snow", 8], ["swamp", 7], ["tundra", 1], ["lava", 50]]);
    expect(describeLand(many, T)).toBe("Land: mostly grass; also hills, mixed forest, marsh, desert rocky, ocean, snow….");
    expect(describeLand(new Map([["forest", 3]]), ["forest"])).toBe("Land: all forest.");
    expect(describeLand(new Map([["lava", 3]]), T)).toBe("Land: nothing of this palette.");
    expect(countTerrains(["a", "b", "a"])).toEqual(new Map([["a", 2], ["b", 1]]));
  });
});
