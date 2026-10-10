import { describe, it } from "node:test";
import expect from "expect";
import { hexNeighbors } from "../packages/hex-wfc/src/grid";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { regionBox, regionCells, type RegionLayout } from "../src/overworld/layout";
import {
  bearingWord,
  defaultRegionName,
  dominantTerrain,
  ecotoneHexes,
  meshes,
  overworldBiomes,
  paletteTypeOf,
  planRegion,
  regionLayoutOf,
  regionNeighbourMaps,
  regionOrder,
  regionSlot,
  slotProblem,
  withMeshFields,
  worldSeed,
} from "../src/overworld/regionWorld";
import { seamStats, interiorAgreement } from "../src/overworld/regionGen";
import { resolveHex, shadowHexes, link, type RegionLike } from "../src/worldgen/world";
import type { MapData } from "../src/types";
import { profilesFor } from "./overworldFixtures";

const EXP = DEFAULT_TERRAIN_PALETTE;
const typeOf = paletteTypeOf(EXP);
const profiles = profilesFor(EXP);
const RULES = { orientation: "flat" as const, stagger: "odd" as const };

const overworld = (regions: MapData["regions"]): MapData => ({
  name: "ow", paletteName: "Expanded", gridSize: { cols: 5, rows: 5 }, gridOffset: { x: 0, y: 0 }, pathChains: [], regions,
});

/** Region records for every hex of a 5×5 overworld, placed as createRegion would. */
function regionMaps(l: RegionLayout, worldId: string, hexes: [number, number][]): (MapData & RegionLike)[] {
  return hexes.map(([px, py]) => {
    const s = regionSlot(l, worldId, px, py);
    return {
      name: `r${px}_${py}`, paletteName: "Expanded", gridSize: { cols: s.cols, rows: s.rows }, gridOffset: s.offset,
      staggerOffset: s.stagger, world: s.world, pathChains: [], submapKind: "region" as const, parent: { map: "ow", hex: `${px}_${py}` },
    };
  });
}

describe("region placement in the shared grid", () => {
  it("lays regions out from the overworld's settings (stagger inherited, rect meshes, flowers wait for 2b)", () => {
    const l = regionLayoutOf(overworld({ footprint: "rect", size: 8 }), RULES)!;
    expect(l).toEqual({ footprint: "rect", size: 8, orientation: "flat", parentStagger: "odd", childStagger: "odd" });
    expect(regionLayoutOf(overworld(undefined), RULES)).toBeUndefined();
    const even = regionLayoutOf({ ...overworld({ footprint: "rect", size: 6, stagger: "even" }), staggerOffset: "odd" }, RULES)!;
    expect(even.childStagger).toBe("even");
    expect(meshes({ footprint: "rect" })).toBe(true);
    expect(meshes({ footprint: "hex" })).toBe(false);
  });

  it("fills the world id and stagger once, and keeps them", () => {
    const s = withMeshFields({ footprint: "rect", size: 8 }, "even", () => "w1");
    expect(s).toMatchObject({ worldId: "w1", stagger: "even" });
    expect(withMeshFields(s, "odd", () => "w2")).toBe(s);
  });

  it("puts each brick at its slot; slots tile the plane without gaps or overlaps", () => {
    for (const n of [6, 7, 8]) {
      for (const parentStagger of ["odd", "even"] as const) {
        const l: RegionLayout = { footprint: "rect", size: n, orientation: "flat", parentStagger, childStagger: parentStagger };
        const owner = new Map<string, string>();
        for (let px = -1; px < 4; px++) for (let py = -1; py < 4; py++) {
          const s = regionSlot(l, "w", px, py);
          expect(s.world).toEqual({ id: "w", cx: px, cy: py });
          for (let y = s.offset.y; y < s.offset.y + s.rows; y++) for (let x = s.offset.x; x < s.offset.x + s.cols; x++) {
            const k = `${x}_${y}`;
            expect(owner.has(k)).toBe(false);
            owner.set(k, `${px}_${py}`);
          }
        }
        // Interior of the patch is fully covered.
        for (let x = 0; x < 2 * n; x++) for (let y = n; y < 2 * n; y++) expect(owner.has(`${x}_${y}`)).toBe(true);
      }
    }
  });

  it("flags a region that isn't where its parent hex says, and accepts one that is", () => {
    const l = regionLayoutOf(overworld({ footprint: "rect", size: 8 }), RULES)!;
    const [m] = regionMaps(l, "w", [[1, 1]]);
    expect(slotProblem(m, l, "w", 1, 1)).toBeNull();
    expect(slotProblem({ ...m, gridOffset: { x: 0, y: 0 } }, l, "w", 1, 1)).toMatch(/corner/);
    expect(slotProblem({ ...m, world: undefined }, l, "w", 1, 1)).toMatch(/grid/);
    expect(slotProblem({ ...m, gridSize: { cols: 6, rows: 6 } }, l, "w", 1, 1)).toMatch(/6 × 6/);
  });
});

describe("walking and shadows across region seams", () => {
  const l = regionLayoutOf(overworld({ footprint: "rect", size: 8 }), RULES)!;
  const maps = regionMaps(l, "w", [[1, 1], [1, 2], [2, 1], [2, 2]]);

  it("a cell past a region's edge resolves to the sibling region holding it", () => {
    const a = maps.find((m) => m.name === "r1_1")!;
    for (const m of maps) {
      for (const [x, y] of regionCells(l, Number(m.name[1]), Number(m.name[3]))) {
        const r = resolveHex(maps, a, x, y);
        expect(r?.map.name).toBe(m.name);
        expect([r?.x, r?.y]).toEqual([x, y]); // shared coordinates: same numbers
      }
    }
    expect(resolveHex(maps, a, -50, -50)).toBeNull();
  });

  it("every edge cell's neighbours across the seam are in the parent hex's neighbouring regions", () => {
    const a = maps.find((m) => m.name === "r1_1")!;
    const parentNbrs = new Set(hexNeighbors(1, 1, "flat", "odd").map(([x, y]) => `r${x}_${y}`));
    for (const [, r] of shadowHexes(maps, a, 1)) expect(parentNbrs.has(r.map.name)).toBe(true);
    expect(shadowHexes(maps, a, 1).size).toBeGreaterThan(8);
  });

  it("names neighbours by true bearing, clockwise from north", () => {
    const n = regionNeighbourMaps(maps, "ow", l, 1, 1);
    expect(n.map((x) => x.map.name).sort()).toEqual(["r1_2", "r2_1", "r2_2"]);
    const south = n.find((x) => x.map.name === "r1_2")!;
    expect(south.bearing).toBe("south");
    expect(bearingWord(1, -1)).toBe("north-east");
    expect(bearingWord(-1, 0)).toBe("west");
  });

  it("refuses to link a region as a N/E/S/W neighbour (it meshes by itself)", () => {
    const loose: RegionLike = { name: "loose", paletteName: "Expanded", gridSize: { cols: 8, rows: 8 }, gridOffset: { x: 0, y: 0 } };
    const r = link([...maps, loose], "loose", "east", "r1_1", RULES);
    expect(r.ok).toBe(false);
  });
});

describe("generating a region from the overworld", () => {
  const l: RegionLayout = { footprint: "rect", size: 8, orientation: "flat", parentStagger: "odd", childStagger: "odd" };
  const terrain = new Map<string, string>();
  for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) terrain.set(`${x}_${y}`, x < 2 ? "snow" : x < 4 ? "mixed forest" : "ocean");
  terrain.set("2_2", "urban");
  const biomes = overworldBiomes(terrain, EXP, "flat", "odd");

  it("reads each hex's biome from its terrain; a town takes its neighbours' biome", () => {
    expect(biomes.get("0_0")).toBe("tundra");
    expect(biomes.get("3_0")).toBe("temperate-forest");
    expect(biomes.get("4_4")).toBe("open-sea");
    expect(biomes.get("2_2")).toBe("temperate-forest");
  });

  it("pins already-painted neighbours: never changes them, and seams match about as well as interiors", () => {
    const seed = worldSeed("w-test");
    const all = new Map<string, string>();
    const order = regionOrder([[1, 1], [2, 1], [1, 2], [2, 2], [3, 2]], "flat", "odd");
    for (const p of order) {
      const before = new Map(all);
      const plan = planRegion({ layout: l, parent: p, biomes, profiles, pinned: all, typeOf, worldSeed: seed });
      expect(plan.cells.size).toBe(64);
      for (const k of plan.cells.keys()) expect(before.has(k)).toBe(false);
      for (const [k, v] of plan.cells) all.set(k, v);
      for (const [k, v] of before) expect(all.get(k)).toBe(v);
    }
    const seams = seamStats(l, all, typeOf);
    const seam = seams.reduce((s, x) => s + x.typeAgreement * x.pairs, 0) / seams.reduce((s, x) => s + x.pairs, 0);
    expect(seam).toBeGreaterThan(interiorAgreement(l, all, typeOf) - 0.2);
  });

  it("records the region's biome and the biomes it blends toward", () => {
    const plan = planRegion({ layout: l, parent: [2, 1], biomes, profiles, typeOf, worldSeed: 3 });
    expect(plan.biome?.generator).toBe("builtin:biome-temperate-forest");
    expect(plan.biome?.from).toEqual(["tundra"]);
    const inner = planRegion({ layout: l, parent: [0, 1], biomes, profiles, typeOf, worldSeed: 3 });
    expect(inner.biome?.from ?? []).not.toContain("open-sea");
  });

  it("is the same whatever order regions are made in, for the first draw (seeded per cell)", () => {
    const a = planRegion({ layout: l, parent: [2, 1], biomes, profiles, typeOf, worldSeed: 9 });
    const b = planRegion({ layout: l, parent: [2, 1], biomes, profiles, typeOf, worldSeed: 9 });
    expect([...a.cells]).toEqual([...b.cells]);
    expect(regionBox(l, 2, 1).cols).toBe(8);
  });

  it("an empty overworld gives an empty region (nothing to blend)", () => {
    const plan = planRegion({ layout: l, parent: [1, 1], biomes: new Map(), profiles, typeOf, worldSeed: 1 });
    expect(plan.cells.size).toBe(0);
    expect(plan.biome).toBeUndefined();
  });
});

describe("helpers", () => {
  it("dominant terrain: type first, then name; settlements never win (K6)", () => {
    expect(dominantTerrain(["grass", "grass", "mixed forest", "forest", "forest", "urban", "urban", "urban", "urban"], typeOf)).toBe("forest");
    expect(dominantTerrain(["urban"], typeOf)).toBeUndefined();
    expect(dominantTerrain([], typeOf)).toBeUndefined();
  });

  it("ecotones are derived: a taiga hex between tundra and forest is one", () => {
    const b = new Map([["0_0", "tundra"], ["1_0", "taiga"], ["2_0", "temperate-forest"], ["1_1", "taiga"]]);
    const e = ecotoneHexes(b, "flat", "odd");
    expect(e.has("1_0")).toBe(true);
    expect(e.has("0_0")).toBe(false);
  });

  it("orders regions centre-out and names them uniquely", () => {
    const order = regionOrder([[0, 0], [2, 2], [4, 4], [2, 1]], "flat", "odd");
    expect(order[0]).toEqual([2, 2]);
    const taken = new Set(["ow 1, 1"]);
    expect(defaultRegionName("ow", 1, 1, undefined, (n) => taken.has(n))).toBe("ow 1, 1 2");
    expect(defaultRegionName("ow", 1, 1, "Fenmarch", () => false)).toBe("Fenmarch");
    expect(worldSeed("a")).toBe(worldSeed("a"));
    expect(worldSeed("a")).not.toBe(worldSeed("b"));
  });
});

describe("overworld data in notes and generation details", () => {
  it("rivers are biome data written as readable hex lists", async () => {
    const { parseBiomeRiver, formatBiomeRiver } = await import("../src/overworld/regionWorld");
    expect(formatBiomeRiver(["2_0", "2_1", "-1_3"])).toBe("2,0 > 2,1 > -1,3");
    expect(parseBiomeRiver("2,0 > 2, 1 >  -1,3 > junk")).toEqual(["2_0", "2_1", "-1_3"]);
    expect(parseBiomeRiver(undefined)).toEqual([]);
  });

  it("map notes keep the overworld's and region's fields as plain keys", async () => {
    const { buildMapNote, parseMapNote } = await import("../src/maps/mapNote");
    const settings = {
      paletteName: "Expanded", gridSize: { cols: 5, rows: 5 }, gridOffset: { x: 0, y: 0 },
      regions: { footprint: "rect" as const, size: 8, blend: "normal" as const, worldId: "w1", stagger: "odd" as const },
      overworldView: "biomes" as const, showMinimap: false, biomeRiver: "2,0 > 2,1", regionSeed: 1234,
    };
    const note = buildMapNote("ow", { settings, hexes: new Map(), paths: [] });
    expect(note).toMatch(/^overworld-view: biomes$/m);
    expect(note).toMatch(/^biome-river: /m);
    expect(note).toMatch(/^region-seed: 1234$/m);
    expect(note).not.toMatch(/\{"/); // no JSON
    const back = parseMapNote(note)!;
    expect(back.settings).toMatchObject({ overworldView: "biomes", showMinimap: false, biomeRiver: "2,0 > 2,1", regionSeed: 1234, regions: settings.regions });
  });

  it("locked (hand-painted) cells inside a region survive regeneration and shape what's around them", () => {
    const l: RegionLayout = { footprint: "rect", size: 8, orientation: "flat", parentStagger: "odd", childStagger: "odd" };
    const biomes = new Map<string, string>();
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) biomes.set(`${x}_${y}`, "grassland");
    const box = regionBox(l, 2, 2);
    const locked = new Map<string, string>();
    for (let i = 0; i < 8; i++) locked.set(`${box.x + i}_${box.y + 3}`, "ocean"); // a painted river across the region
    const plan = planRegion({ layout: l, parent: [2, 2], biomes, profiles, pinned: locked, typeOf, worldSeed: 5 });
    for (const k of locked.keys()) expect(plan.cells.has(k)).toBe(false); // left as painted
    expect(plan.cells.size).toBe(64 - 8);
  });
});
