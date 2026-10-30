import { describe, it } from "node:test";
import expect from "expect";
import { MemVault } from "./helpers/memVault";
import type { HexData } from "../src/maps/mapNote";
import type { TerrainColor } from "../src/types";
import { ExploreService } from "../src/hexflower/ExploreService";
import { FlowerStore } from "../src/hexflower/FlowerStore";
import { setExplore, setFlowerStore } from "../src/hexflower/context";
import { exploreHiddenTerrain, explorePartyControls, exploreStep, PEEK_CONTROL_ID } from "./helpers/exploring";
import { REALMS_RULE } from "../src/hexflower/realms";
import { anchorOnLand, blendPick, mirror, nudge, shapeOf, standable, tileAt, tileOrigin, type Tile } from "../src/hexflower/world";
import { emptyFlower } from "../src/hexflower/flower";
import { fillFromShares } from "../src/hexflower/fromPalette";
import type { TerrainGeneratorKind } from "../src/worldgen/registry";
import { neighbourKeys } from "../src/hexKey";

/**
 * Owner 2026-10-25: an explored map should be "ONE hex of the wider world…
 * more like revealing a normal generated map". The realms' generators make
 * a hidden world; exploring uncovers it, with a little local variety.
 */

const PALETTE: TerrainColor[] = [
  { name: "sea", color: "#246", type: "water" },
  // Untyped: water by its name.
  { name: "lake", color: "#48a" },
  { name: "grassland", color: "#8c6", type: "grassland" },
  { name: "forest", color: "#363", type: "forest" },
  { name: "peaks", color: "#999", type: "mountains", impassable: true },
];
const NAMES = PALETTE.map((t) => t.name);

function kind(id: string, fill: (x: number, y: number) => string): TerrainGeneratorKind {
  return {
    id, label: id.split(":")[1], description: "", source: "built-in", options: [], fits: () => true, toPaths: () => ({ paths: [], missing: [] }),
    generate: (req) => {
      const cells = new Map<string, string>();
      for (let x = 0; x < req.grid.cols; x++) for (let y = 0; y < req.grid.rows; y++) cells.set(`${x}_${y}`, fill(x, y));
      return { ok: true, cells, paths: [], warnings: [] };
    },
  };
}
// A coast: sea on the tile's west third, land (grass and forest in bands) east of it.
const COAST = kind("x:coast", (x, y) => (x < 32 ? "sea" : (Math.floor(y / 6) % 2 ? "forest" : "grassland")));
const ISLES = kind("x:isles", () => "sea");

class FakeStore {
  hexes = new Map<string, Map<string, HexData>>();
  get(m: string, k: string) { return this.hexes.get(m)?.get(k); }
  all(m: string) { return this.hexes.get(m) ?? new Map<string, HexData>(); }
  set(m: string, k: string, patch: Record<string, unknown>) {
    const t = this.hexes.get(m) ?? new Map<string, HexData>();
    this.hexes.set(m, t);
    t.set(k, { ...(t.get(k) ?? {}), ...patch } as HexData);
    return true;
  }
  async record<T>(fn: () => T) { return { result: await fn(), cells: [] }; }
}

function setup(map: Record<string, unknown> = {}) {
  const store = new FakeStore();
  const mapData: Record<string, unknown> = {
    name: "m", paletteName: "P", gridSize: { cols: 40, rows: 12 }, gridOffset: { x: 0, y: 0 }, pathChains: [], seed: 7,
    exploreWith: [REALMS_RULE], exploreGrow: "off", exploreReveal: "1",
    exploreRealms: ["Coast: x:coast at 20_6, home"], ...map,
  };
  let redraws = 0;
  const plugin = {
    app: new MemVault({}).app(),
    manifest: { dir: ".obsidian/plugins/hexmaker" },
    settings: { worldFolder: "world", hexOrientation: "flat", staggerOffset: "odd", maps: [mapData] },
    mapStore: store,
    tableNotes: { lookup: () => ({ table: () => undefined }) },
    getMap: (n: string) => (n === "m" ? mapData : undefined),
    getPaletteOrPresetTerrains: () => PALETTE,
    hexPath: (x: number, y: number) => `world/hexes/m/${x}_${y}.md`,
    mapLabel: (n: string) => n,
    saveSettings: async () => {},
    pushUndo: () => {},
    refreshHexMap: () => { redraws++; },
  };
  setFlowerStore(plugin as never, new FlowerStore(plugin as never, () => {}));
  const ex = new ExploreService(plugin as never, () => {});
  ex.useKinds([COAST, ISLES]);
  setExplore(plugin as never, ex);
  return { plugin, store, mapData, ex, redraws: () => redraws };
}

const group = (t: string | undefined) => (t ? shapeOf(t, PALETTE) : "");

describe("the hidden world's geometry", () => {
  it("mirror folds any position into the tile, continuous across each edge", () => {
    expect([0, 5, 9].map((v) => mirror(v, 10))).toEqual([0, 5, 9]);
    expect([10, 11, 19, 20, -1, -2].map((v) => mirror(v, 10))).toEqual([9, 8, 0, 0, 0, 1]);
  });

  it("a tile's corner is even, so odd and even columns stay odd and even", () => {
    for (const c of ["20_6", "21_7", "-3_-9", "0_0"]) {
      const [x0, y0] = tileOrigin(c, 96);
      expect([Math.abs(x0 % 2), Math.abs(y0 % 2)]).toEqual([0, 0]);
    }
  });

  it("a blend gives each generator broad patches, in proportion to its weight", () => {
    let a = 0, same = 0, pairs = 0;
    for (let x = 0; x < 200; x++) for (let y = 0; y < 200; y++) {
      const p = blendPick([3, 1], `${x}_${y}`, 11);
      if (p === 0) a++;
      if (x > 0) { pairs++; if (blendPick([3, 1], `${x - 1}_${y}`, 11) === p) same++; }
    }
    expect(a / 40000).toBeGreaterThan(0.6);
    expect(a / 40000).toBeLessThan(0.9);
    // Neighbours almost always agree: patches, not salt and pepper.
    expect(same / pairs).toBeGreaterThan(0.9);
  });
});

describe("a nudge never breaks the big shape", () => {
  const flower = emptyFlower("Coast", "P");
  flower.cells = fillFromShares([
    { terrain: "grassland", weight: 3 }, { terrain: "sea", weight: 3 }, { terrain: "forest", weight: 2 }, { terrain: "peaks", weight: 2 },
  ], 3);

  it("water stays water, land stays land, impassable stays impassable; some hexes do change", () => {
    let changed = 0;
    for (let s = 0; s < 400; s++) {
      for (const base of ["sea", "grassland", "forest", "peaks"]) {
        const out = nudge(base, flower, PALETTE, s, 1);
        expect(group(out)).toBe(group(base));
        if (out !== base) changed++;
      }
    }
    expect(changed).toBeGreaterThan(0);
  });

  it("with no flower, or chance 0, the hex is the hidden land as it is", () => {
    expect(nudge("forest", undefined, PALETTE, 1, 1)).toBe("forest");
    for (let s = 0; s < 50; s++) expect(nudge("forest", flower, PALETTE, s, 0)).toBe("forest");
  });

  it("standable: not water, not impassable", () => {
    expect(["sea", "lake", "grassland", "forest", "peaks"].map((t) => standable(t, PALETTE))).toEqual([false, false, true, true, false]);
  });
});

describe("home is anchored on land", () => {
  it("a tile whose centre is sea is shifted (by even steps) so the centre lands on the nearest land", () => {
    const cells = new Map<string, string>();
    for (let x = 0; x < 20; x++) for (let y = 0; y < 20; y++) cells.set(`${x}_${y}`, x < 14 ? "sea" : "forest");
    const tile: Tile = { x0: 0, y0: 0, side: 20, cells };
    expect(tileAt(tile, "10_10")).toBe("sea");
    const moved = anchorOnLand(tile, "10_10", PALETTE);
    expect(tileAt(moved, "10_10")).toBe("forest");
    expect(Math.abs((moved.x0 - tile.x0) % 2)).toBe(0);
    expect(moved.y0).toBe(tile.y0);
    // Already on land: unchanged.
    expect(anchorOnLand(moved, "10_10", PALETTE)).toBe(moved);
  });
});

describe("exploring reveals the hidden world", () => {
  /** Walk the party east along row 6 from x = 1 to `to` (it sees 1 ring each step). */
  async function walkEast(s: ReturnType<typeof setup>, from: number, to: number): Promise<void> {
    for (let x = from + 1; x <= to; x++) await exploreStep(s.plugin as never, { map: "m", from: `${x - 1}_6`, to: `${x}_6` });
  }

  it("every revealed hex has its hidden land's shape: one coastline, no scattered ponds", async () => {
    const s = setup();
    s.store.set("m", "1_6", { terrain: "grassland" });
    await walkEast(s, 1, 38);
    const realms = (await s.ex.realmsOf(s.mapData as never))!;
    const ctx = s.ex.worldContext(s.mapData as never, realms);
    let revealed = 0;
    for (const [k, h] of s.store.all("m")) {
      if (k === "1_6" || !h.terrain) continue;
      revealed++;
      const base = s.ex.worlds.baseAt(k, realms.realms, ctx)!.terrain;
      expect(group(h.terrain)).toBe(group(base));
    }
    expect(revealed).toBeGreaterThan(60);
    // The coast is one line: along the row, sea then land, never back.
    const row = Array.from({ length: 36 }, (_, i) => s.store.get("m", `${i + 2}_6`)?.terrain);
    const kinds = row.map((t) => (t === "sea" ? "w" : "l")).join("").replace(/(.)\1+/g, "$1");
    expect(kinds.length).toBeLessThanOrEqual(2);
  });

  it("the home realm's start is on land even where its generator made sea", async () => {
    const s = setup({ exploreRealms: ["Isle: x:coast at 2_6, home"] });
    const realms = (await s.ex.realmsOf(s.mapData as never))!;
    const ctx = s.ex.worldContext(s.mapData as never, realms);
    expect(standable(s.ex.worlds.baseAt("2_6", realms.realms, ctx)?.terrain, PALETTE)).toBe(true);
  });

  it("the same seed reveals the same land; a reroll can differ only in detail", async () => {
    const a = setup(), b = setup();
    for (const s of [a, b]) { s.store.set("m", "1_6", { terrain: "grassland" }); await walkEast(s, 1, 20); }
    expect([...a.store.all("m")].map(([k, h]) => [k, h.terrain])).toEqual([...b.store.all("m")].map(([k, h]) => [k, h.terrain]));
  });
});

describe("the GM's peek", () => {
  it("off by default; Show turns it on: the blank hexes' hidden land, drawn once the realms are read", async () => {
    const s = setup();
    s.store.set("m", "20_6", { terrain: "grassland" });
    const peek = () => explorePartyControls(s.plugin as never, { map: "m", hex: "20_6", token: "party.md" }).find((c) => c.id === PEEK_CONTROL_ID)!;
    expect(peek().buttons[0].label).toBe("Show");
    expect(exploreHiddenTerrain(s.plugin as never, s.mapData as never)).toBeUndefined();
    await peek().buttons[0].run!();
    expect(s.mapData.explorePeek).toBe("on");
    expect(peek().buttons[0].label).toBe("Hide");
    // First ask: reads the realms, then asks for a redraw.
    const before = s.redraws();
    expect(exploreHiddenTerrain(s.plugin as never, s.mapData as never)).toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(s.redraws()).toBeGreaterThan(before);
    const hidden = exploreHiddenTerrain(s.plugin as never, s.mapData as never)!;
    expect(NAMES).toContain(hidden("30_6"));
    // West of the coast: sea, as the generator made it.
    expect(hidden("2_6")).toBe("sea");
    await peek().buttons[0].run!();
    expect(s.mapData.explorePeek).toBeUndefined();
  });

  it("no Peek on a map not powered by generators", () => {
    const s = setup({ exploreRealms: undefined, exploreWith: ["[[Wilds]] -> terrain"] });
    const ids = explorePartyControls(s.plugin as never, { map: "m", hex: "1_1", token: "party.md" }).map((c) => c.id);
    expect(ids).not.toContain(PEEK_CONTROL_ID);
  });

  it("hiddenTerrain lists only blank hexes", async () => {
    const s = setup();
    s.store.set("m", "5_5", { terrain: "forest" });
    const all = await s.ex.hiddenTerrain("m");
    expect(all.has("5_5")).toBe(false);
    expect(all.size).toBe(40 * 12 - 1);
    expect(neighbourKeys("5_5", "flat", "odd").every((k) => all.has(k))).toBe(true);
  });
});
