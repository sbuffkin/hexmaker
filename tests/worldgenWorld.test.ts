import { describe, it } from "node:test";
import expect from "expect";
import { hexNeighbors, mulberry32 } from "../packages/hex-wfc/src";
import {
  canPlace,
  isShifted,
  link,
  neighbour,
  newNeighbourSpec,
  resolveHex,
  shadowDepth,
  shadowHexes,
  staggerToMatch,
  toWorld,
  SIDES,
  type GridRules,
  type RegionLike,
  type Side,
} from "../src/worldgen/world";

/** Neighbour regions on one shared grid (src/worldgen/world.ts). */

type Map_ = RegionLike & { gridOffset: { x: number; y: number } };
const region = (name: string, cols: number, rows: number, over: Partial<Map_> = {}): Map_ => ({
  name, paletteName: "Default", gridSize: { cols, rows }, gridOffset: { x: 0, y: 0 }, ...over,
});

/**
 * Build a w×h world of cols×rows regions the way the UI does: each new region
 * is made next to an existing one with newNeighbourSpec. Some get odd
 * offsets (as if made elsewhere first), with the stagger worked out to match.
 */
function buildWorld(w: number, h: number, cols: number, rows: number, rules: GridRules, seed = 1): Map_[] {
  const rng = mulberry32(seed);
  const maps: Map_[] = [region("r0_0", cols, rows, { gridOffset: { x: -7, y: -9 } })];
  let id = "";
  for (let cy = 0; cy < h; cy++)
    for (let cx = 0; cx < w; cx++) {
      if (cx === 0 && cy === 0) continue;
      const from = cx > 0 ? maps.find((m) => m.name === `r${cx - 1}_${cy}`)! : maps.find((m) => m.name === `r${cx}_${cy - 1}`)!;
      const side: Side = cx > 0 ? "east" : "south";
      const spec = newNeighbourSpec(maps, from, side, rules, () => (id ||= "world"));
      if (!spec.ok) throw new Error(spec.reason);
      if (!from.world) from.world = spec.aSlot;
      // Every third region: made with its own offset; stagger recomputed for it.
      const offset = rng() < 0.33 ? { x: Math.floor(rng() * 21) - 10, y: Math.floor(rng() * 21) - 10 } : spec.offset;
      const m = region(`r${cx}_${cy}`, cols, rows, { gridOffset: offset });
      const anchor = maps[0];
      const stagger = offset === spec.offset ? spec.stagger : undefined;
      m.world = spec.slot;
      if (stagger) m.staggerOffset = stagger;
      else m.staggerOffset = staggerToMatch(from, from.staggerOffset ?? rules.stagger, spec.slot.cx, spec.slot.cy, offset, rules);
      const placed = canPlace(maps.filter((o) => o.world?.id === spec.slot.id), m, spec.slot.cx, spec.slot.cy, rules);
      expect(placed.ok ? "ok" : placed.reason).toBe("ok");
      maps.push(m);
      void anchor;
    }
  return maps;
}

const stg = (m: RegionLike, rules: GridRules) => m.staggerOffset ?? rules.stagger;

/** World-frame neighbours, using the stagger of the region at slot (0,0). */
function worldNeighbours(maps: Map_[], wx: number, wy: number, rules: GridRules): string[] {
  const ref = maps.find((m) => m.world && m.world.cx === 0 && m.world.cy === 0)!;
  // A world coordinate is shifted iff the same coordinate in ref's frame is.
  const toRef = (wx_: number, wy_: number) => [ref.gridOffset.x + wx_, ref.gridOffset.y + wy_] as const;
  const [rx, ry] = toRef(wx, wy);
  return hexNeighbors(rx, ry, rules.orientation, stg(ref, rules)).map(([x, y]) => `${x - ref.gridOffset.x}_${y - ref.gridOffset.y}`);
}

for (const rules of [
  { orientation: "flat", stagger: "odd" },
  { orientation: "flat", stagger: "even" },
  { orientation: "pointy", stagger: "odd" },
] as GridRules[]) {
  describe(`neighbour regions (${rules.orientation}, ${rules.stagger})`, () => {
    for (const [cols, rows] of [[4, 4], [5, 3]]) {
      it(`a 10×10 world of ${cols}×${rows} regions keeps one unbroken grid across every seam`, () => {
        const maps = buildWorld(10, 10, cols, rows, rules, cols * 31 + rows);
        expect(maps).toHaveLength(100);
        for (const m of maps) {
          for (let y = m.gridOffset.y; y < m.gridOffset.y + rows; y++)
            for (let x = m.gridOffset.x; x < m.gridOffset.x + cols; x++) {
              const here = toWorld(m, x, y)!;
              const expected = new Set(worldNeighbours(maps, here.wx, here.wy, rules));
              // What the hex flower shows: neighbours in this map's frame, resolved across edges.
              for (const [nx, ny] of hexNeighbors(x, y, rules.orientation, stg(m, rules))) {
                const r = resolveHex(maps, m, nx, ny);
                if (!r) continue; // off the world's edge
                const w = toWorld(r.map, r.x, r.y)!;
                expect(expected.has(`${w.wx}_${w.wy}`)).toBe(true);
              }
            }
        }
      });
    }

    it("a random walk through the hex flower, retraced, ends where it started", () => {
      const maps = buildWorld(10, 10, 4, 4, rules, 7);
      const rng = mulberry32(42);
      const start = { map: maps[0], x: maps[0].gridOffset.x + 1, y: maps[0].gridOffset.y + 2 };
      let at = start;
      const steps: { from: typeof start; to: typeof start }[] = [];
      const visited = new Set<string>();
      for (let i = 0; i < 3000; i++) {
        const options = hexNeighbors(at.x, at.y, rules.orientation, stg(at.map, rules))
          .map(([nx, ny]) => resolveHex(maps, at.map, nx, ny))
          .filter((r): r is NonNullable<typeof r> => !!r);
        const next = options[Math.floor(rng() * options.length)];
        steps.push({ from: at, to: next });
        visited.add(next.map.name);
        at = next;
      }
      expect(visited.size).toBeGreaterThan(20);
      // Retrace: from each hex, the way back is one of its own flower tiles.
      for (const { from, to } of steps.reverse()) {
        expect(at).toEqual(to);
        const back = hexNeighbors(at.x, at.y, rules.orientation, stg(at.map, rules))
          .map(([nx, ny]) => resolveHex(maps, at.map, nx, ny))
          .find((r) => r && r.map.name === from.map.name && r.x === from.x && r.y === from.y);
        expect(back).toBeTruthy();
        at = back!;
      }
      expect(at).toEqual(start);
    });
  });
}

describe("linking regions", () => {
  const rules: GridRules = { orientation: "flat", stagger: "odd" };

  it("puts a region on a side, and neighbours are found both ways", () => {
    const maps = [region("a", 10, 8), region("b", 10, 8)];
    const r = link(maps, "a", "east", "b", rules, () => "w");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const [name, slot] of r.changes) maps.find((m) => m.name === name)!.world = slot;
    expect(neighbour(maps, maps[0], "east")?.name).toBe("b");
    expect(neighbour(maps, maps[1], "west")?.name).toBe("a");
    expect(SIDES.filter((s) => neighbour(maps, maps[0], s))).toEqual(["east"]);
  });

  it("refuses a different size, palette, or a taken slot", () => {
    const maps = [region("a", 10, 8, { world: { id: "w", cx: 0, cy: 0 } }), region("b", 10, 8, { world: { id: "w", cx: 1, cy: 0 } })];
    const check = (m: Map_, side: Side = "west") => link([...maps, m], "a", side, m.name, rules);
    expect(check(region("c", 12, 8))).toMatchObject({ ok: false, reason: expect.stringContaining("10×8") });
    expect(check(region("d", 10, 8, { paletteName: "test" }))).toMatchObject({ ok: false, reason: expect.stringContaining("palette") });
    expect(check(region("e", 10, 8), "east")).toMatchObject({ ok: false, reason: expect.stringContaining('"b" is already there') });
    expect(check(region("f", 10, 8)).ok).toBe(true);
  });

  it("refuses an existing map whose stagger wouldn't line up, rather than changing it", () => {
    // 5 wide: the region east of a starts on an odd world column, so it must stagger the other way.
    const maps = [region("a", 5, 4), region("b", 5, 4, { staggerOffset: "odd" })];
    expect(link(maps, "a", "east", "b", rules)).toMatchObject({ ok: false, reason: expect.stringContaining("staggered") });
    const fits = region("c", 5, 4, { staggerOffset: "even" });
    expect(link([...maps, fits], "a", "east", "c", rules).ok).toBe(true);
  });

  it("moves a whole group along when joining two groups, if nothing overlaps", () => {
    const maps = [
      region("a", 6, 6, { world: { id: "w1", cx: 0, cy: 0 } }),
      region("b", 6, 6, { world: { id: "w2", cx: 5, cy: 5 } }),
      region("c", 6, 6, { world: { id: "w2", cx: 5, cy: 6 } }), // south of b
    ];
    const r = link(maps, "a", "east", "b", rules);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changes.get("b")).toEqual({ id: "w1", cx: 1, cy: 0 });
    expect(r.changes.get("c")).toEqual({ id: "w1", cx: 1, cy: 1 });
  });

  it("new neighbours copy the size and offset, with the stagger that lines up", () => {
    const a = region("a", 5, 4, { gridOffset: { x: -7, y: -9 } });
    const spec = newNeighbourSpec([a], a, "east", rules, () => "w");
    expect(spec).toMatchObject({ ok: true, cols: 5, rows: 4, offset: { x: -7, y: -9 }, slot: { id: "w", cx: 1, cy: 0 } });
    // a's world column 5 is its local column -2 (unshifted under "odd"); the
    // new map's local column -7 must be unshifted too, so it staggers "even".
    if (spec.ok) {
      expect(isShifted(spec.stagger, -7)).toBe(isShifted("odd", -2));
      expect(spec.stagger).toBe("even");
    }
  });
});

describe("shadows", () => {
  it("are 1, 2 or 3 hexes deep for small, medium and large maps", () => {
    expect([shadowDepth(20, 14), shadowDepth(30, 20), shadowDepth(40, 28), shadowDepth(4, 4)]).toEqual([1, 2, 3, 1]);
  });

  it("cover only the sides (and corners) where a neighbour is", () => {
    const rules: GridRules = { orientation: "flat", stagger: "odd" };
    const maps = buildWorld(2, 2, 4, 4, rules);
    const s = shadowHexes(maps, maps[0], 1); // r0_0: neighbours east, south, and south-east
    const owners = new Set([...s.values()].map((v) => v.map.name));
    expect(owners).toEqual(new Set(["r1_0", "r0_1", "r1_1"]));
    expect(s.size).toBe(4 + 4 + 1);
  });
});
