/**
 * Owner bug 2026-10-12 (overworld demo): after a wheel zoom, hovering drawn
 * regions in the Regions view said "No region yet", and a click on the
 * top-right empty brick made the region of hex 7, 0, drawn far off to the
 * right of the overworld with nothing to blend with.
 *
 * Root cause: the layer's hit test (OverworldLayer.cellAt) inverted the
 * child→grid-px transform measured at render time, but a zoom bake changes
 * the grid's font size (everything is in em), so every grid px since then is
 * emNow / emThen times bigger than the transform expects. The drawing is
 * placed in em and stayed right; only the hit test was off.
 *
 * Guards: the hit test finds every drawn region at any baked zoom, and no
 * region can be made for a hex outside the overworld's grid.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { childPoint, regionCells, type RegionLayout } from "../src/overworld/layout";
import { applyAffine, cellAtGridPoint, childToParentPlane, composeAffine, type Affine } from "../src/overworld/overworldRender";
import { createRegion, OUTSIDE_OVERWORLD_HINT, setBiomeAt } from "../src/overworld/regionsVault";
import { representativeTerrain } from "../src/overworld/biomes";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import type { MapData } from "../src/types";
import type { NewMapOptions } from "../src/services/MapsService";

const layout: RegionLayout = { footprint: "rect", size: 8, orientation: "flat", parentStagger: "odd", childStagger: "odd" };
// Parent plane → grid px, as fitted from laid-out hexes (the demo's numbers, rounded).
const p2g: Affine = [67.6, 0, 0, 68, 66, 173];
const c2g = composeAffine(childToParentPlane(layout), p2g);
const EM = 28;

/** Where the layer draws child cell (x, y) after the grid's font size went from EM to EM × F: em-placed, so scaled by F. */
const drawnAt = (x: number, y: number, F: number): [number, number] => {
  const [gx, gy] = applyAffine(c2g, ...childPoint(layout, x, y));
  return [gx * F, gy * F];
};

describe("Regions view hit test (owner bug 2026-10-12)", () => {
  // The demo overworld: 5 × 6 from row −1.
  const hexes: [number, number][] = [];
  for (let py = -1; py <= 4; py++) for (let px = 0; px <= 4; px++) hexes.push([px, py]);

  for (const F of [1, 0.6, 1.6, 2.5]) {
    it(`finds the region of every drawn cell after a zoom bake ×${F}`, () => {
      for (const [px, py] of hexes) {
        for (const [x, y] of regionCells(layout, px, py)) {
          const [gx, gy] = drawnAt(x, y, F);
          expect(cellAtGridPoint(layout, c2g, EM, EM * F, gx, gy)).toEqual({ x, y, parentHex: `${px}_${py}` });
        }
      }
    });
  }

  it("the old hit test (ignoring the bake) put a click on the top-right brick past the overworld", () => {
    // Centre of brick 4, 0 after zooming in ×1.6.
    const [x, y] = regionCells(layout, 4, 0)[27];
    const [gx, gy] = drawnAt(x, y, 1.6);
    const stale = cellAtGridPoint(layout, c2g, EM, EM, gx, gy).parentHex;
    expect(Number(stale.split("_")[0])).toBeGreaterThan(4);
    expect(cellAtGridPoint(layout, c2g, EM, EM * 1.6, gx, gy).parentHex).toBe("4_0");
  });
});

describe("no region past the overworld's edge", () => {
  function world() {
    const overworld = {
      name: "ow", paletteName: "Default", workMode: "build",
      gridSize: { cols: 5, rows: 6 }, gridOffset: { x: 0, y: -1 }, staggerOffset: "odd",
      regions: { footprint: "rect", size: 8, blend: "normal", worldId: "w1", stagger: "odd" },
      pathChains: [],
    } as unknown as MapData;
    const maps: MapData[] = [overworld];
    const writes: string[] = [];
    const made: string[] = [];
    const plugin = {
      settings: { maps, hexOrientation: "flat", staggerOffset: "odd" },
      getMap: (n: string) => maps.find((m) => m.name === n),
      getMapPalette: () => DEFAULT_TERRAIN_PALETTE,
      getPaletteOrPresetTerrains: () => DEFAULT_TERRAIN_PALETTE,
      mapLabel: (n: string) => n,
      mapStore: {
        get: () => undefined,
        all: () => new Map(),
        set: (m: string, k: string) => writes.push(`${m}|${k}`),
        flush: async () => {},
      },
      saveSettings: async () => {},
      createNewMap: async ({ name }: NewMapOptions) => {
        made.push(name);
        return { name };
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { plugin: plugin as any, writes, made };
  }

  it("createRegion refuses a hex outside the grid (the demo's 7, 0) and writes nothing", async () => {
    const w = world();
    expect(await createRegion(w.plugin, "ow", 7, 0, { fill: "blank" })).toEqual({ error: OUTSIDE_OVERWORLD_HINT });
    expect(await createRegion(w.plugin, "ow", 0, -2, { fill: "blank" })).toEqual({ error: OUTSIDE_OVERWORLD_HINT });
    expect(w.made).toEqual([]);
    expect(w.writes).toEqual([]);
  });

  it("setBiomeAt (the biome picker on an empty brick) refuses it before painting the overworld", async () => {
    const w = world();
    expect(representativeTerrain("grassland", DEFAULT_TERRAIN_PALETTE)).toBeTruthy();
    expect(await setBiomeAt(w.plugin, "ow", 7, 0, "grassland")).toEqual({ error: OUTSIDE_OVERWORLD_HINT });
    expect(w.writes).toEqual([]);
    expect(w.made).toEqual([]);
  });
});
