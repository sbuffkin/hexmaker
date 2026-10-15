import { describe, it } from "node:test";
import expect from "expect";
import { hexCenter } from "../packages/hex-wfc/src/grid";
import { childPoint, regionCells, regionCentrePoint, type RegionLayout } from "../src/overworld/layout";
import {
  affineScale,
  applyAffine,
  childToParentPlane,
  composeAffine,
  drawMiniOverworld,
  drawRegionCells,
  fitAffine,
  invertAffine,
  miniHexAt,
  miniLayout,
  nearestChildCell,
  RegionBitmapCache,
  type Affine,
  type Ctx2D,
} from "../src/overworld/overworldRender";

/** A 2D context that records what was drawn. */
function recorder() {
  const calls: string[] = [];
  const fills: string[] = [];
  const strokes: string[] = [];
  const texts: string[] = [];
  const ctx: Ctx2D = {
    beginPath: () => calls.push("begin"),
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    fill: () => fills.push(String(ctx.fillStyle)),
    stroke: () => strokes.push(String(ctx.strokeStyle)),
    fillText: (t: string) => texts.push(t),
    clearRect: () => {},
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "left",
  };
  return { ctx, calls, fills, strokes, texts };
}

const layouts: RegionLayout[] = [
  { footprint: "rect", size: 8, orientation: "flat", parentStagger: "odd", childStagger: "odd" },
  { footprint: "rect", size: 6, orientation: "pointy", parentStagger: "even", childStagger: "even" },
  { footprint: "hex", size: 3, orientation: "flat", parentStagger: "odd", childStagger: "odd" },
];

describe("overworld geometry", () => {
  it("fits, inverts and composes affine maps", () => {
    const m: Affine = [2, 0.5, -1, 3, 10, -4];
    const pairs: [[number, number], [number, number]][] = [[0, 0], [1, 0], [0, 1], [3, 7]].map(([x, y]) => [[x, y], applyAffine(m, x, y)]);
    const fit = fitAffine(pairs);
    for (let i = 0; i < 6; i++) expect(fit[i]).toBeCloseTo(m[i], 9);
    const [x, y] = applyAffine(invertAffine(m), ...applyAffine(m, 5, -2));
    expect(x).toBeCloseTo(5, 9);
    expect(y).toBeCloseTo(-2, 9);
    const c = composeAffine(m, [1, 0, 0, 1, 3, 3]);
    expect(applyAffine(c, 1, 1)).toEqual(applyAffine(m, 1, 1).map((v) => v + 3));
    expect(affineScale([2, 0, 0, 2, 0, 0])).toBe(2);
  });

  it("maps each region's centre onto its parent hex's centre (even bricks and flowers exactly)", () => {
    for (const l of layouts) {
      const m = childToParentPlane(l);
      for (const [px, py] of [[0, 0], [3, 2], [5, 5], [-1, 2]] as [number, number][]) {
        const [x, y] = applyAffine(m, ...regionCentrePoint(l, px, py));
        const [ex, ey] = hexCenter(px, py, l.orientation, l.parentStagger);
        expect(Math.abs(x - ex)).toBeLessThan(1e-6);
        expect(Math.abs(y - ey)).toBeLessThan(1e-6);
      }
    }
  });

  it("finds the child cell under any point (round trip through the plane, with jitter)", () => {
    for (const l of layouts) {
      for (const [x, y] of regionCells(l, 1, 1)) {
        const [px, py] = childPoint(l, x, y);
        expect(nearestChildCell(l, px + 0.3, py - 0.25)).toEqual([x, y]);
      }
    }
  });
});

describe("region bitmap cache", () => {
  it("builds once per region, rebuilds only the region that changed, and on a new key", () => {
    const cache = new RegionBitmapCache<number>();
    let n = 0;
    const get = (name: string, key = "k") => cache.get(name, key, () => ++n);
    for (let i = 0; i < 100; i++) get(`r${i}`);
    expect(cache.builds).toBe(100);
    for (let i = 0; i < 100; i++) get(`r${i}`);
    expect(cache.builds).toBe(100); // all cached
    cache.invalidate("r7");
    expect(cache.has("r7")).toBe(false);
    for (let i = 0; i < 100; i++) get(`r${i}`);
    expect(cache.builds).toBe(101); // only r7
    get("r1", "zoomed");
    expect(cache.builds).toBe(102);
    cache.retain(new Set(["r1", "r2"]));
    expect(cache.size).toBe(2);
    cache.invalidate("gone"); // unknown names are ignored
    expect(cache.size).toBe(2);
  });
});

describe("drawing like the preview", () => {
  it("fills every cell in its colour and outlines only the seams with other regions", () => {
    const l = layouts[0];
    const cells = regionCells(l, 1, 1).map(([x, y]) => ({ x, y, color: "#123456" }));
    const r = recorder();
    drawRegionCells(r.ctx, l, cells, [10, 0, 0, 10, 0, 0]);
    expect(r.fills.length).toBe(64);
    expect(r.fills.every((f) => f === "#123456")).toBe(true);
    // An 8×8 brick has 4·8 edge cells; seams are the edges facing other regions.
    expect(r.strokes.length).toBeGreaterThan(28);
    expect(r.strokes.length).toBeLessThan(64);
    const quiet = recorder();
    drawRegionCells(quiet.ctx, l, cells, [10, 0, 0, 10, 0, 0], { seams: false });
    expect(quiet.strokes.length).toBe(0);
  });

  it("draws the minimap: biome labels, white outlines on transitions, river, highlight; hit-tests hexes", () => {
    const hexes = [
      { x: 0, y: 0, color: "#fff", label: "Temperate forest" },
      { x: 1, y: 0, color: "#0f0", label: "Taiga", ecotone: true },
      { x: 0, y: 1, color: "#00f" },
    ];
    const l = miniLayout(hexes, "flat", "odd", 220, 180);
    const r = recorder();
    drawMiniOverworld(r.ctx, l, hexes, ["0_0", "1_0"], "0_1");
    expect(r.texts).toEqual(["Temperate ", "Taiga"]);
    expect(r.strokes).toContain("#fff");
    expect(r.strokes).toContain("#3b82f6");
    expect(r.strokes).toContain("#f59e0b");
    const l2 = miniLayout(hexes, "flat", "odd", 220, 180);
    const [cx, cy] = [(hexCenter(1, 0, "flat", "odd")[0] - l2.minX) * l2.size + l2.margin, (hexCenter(1, 0, "flat", "odd")[1] - l2.minY) * l2.size + l2.margin];
    expect(miniHexAt(l2, hexes, cx + 1, cy - 1)).toEqual(hexes[1]);
    expect(miniHexAt(l2, hexes, -100, -100)).toBeNull();
  });
});
