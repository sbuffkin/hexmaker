import { describe, it } from "node:test";
import expect from "expect";
import { hexDistance, hexCenter } from "../packages/hex-wfc/src/grid";
import {
  REACH_BAND,
  blockedDirections,
  describeCentre,
  directionOf,
  directions,
  formatRealm,
  influence,
  parseBorders,
  parseRealm,
  parseRealms,
  placeCentre,
  realmAt,
  uniqueRealmName,
  type Geometry,
  type Realm,
} from "../src/hexflower/realms";
import { generatorShares, kindForSource, RealmFlowers, sourceOf, topShares } from "../src/hexflower/realmFlowers";
import { formatAreas, middleOf, parseAreas, setupRealms, startHexOf } from "../src/hexflower/exploreSetup";
import { defaultHome } from "../src/hexflower/exploreSetupForm";
import { hexPair } from "../src/hexKey";
import type { TerrainGeneratorKind } from "../src/worldgen/registry";

/** HF8 step 3 = plan-hf6-generator-realms: generators power an explored map, each with a realm of influence. */

const G: Geometry = { orientation: "flat", stagger: "odd" };
const realm = (name: string, centre: string, reach: Realm["reach"], ref = name.toLowerCase()): Realm => ({ name, from: [{ ref, link: false, weight: 1 }], centre, reach });

describe("realms: reading and writing", () => {
  it("round-trips ids, links, blends and a flower of its own", () => {
    for (const line of [
      "Overland: procedural:overland at 10_10, home",
      "Coastal fjord: builtin:biome-coastal-fjord at 21_-2, far",
      "Fen: [[world/generators/swamp]] 2 + [[world/generators/taiga]] at 4_18, near",
      "Peaks: builtin:biome-alpine at -3_7, really far, flower [[Peaks flower]]",
    ]) expect(formatRealm(parseRealm(line)!)).toBe(line);
    expect(parseRealm("Fen: [[swamp|The swamp]] 2 + taiga 0.5 at 4_18, near")).toEqual({
      name: "Fen", from: [{ ref: "swamp", link: true, weight: 2 }, { ref: "taiga", link: false, weight: 0.5 }], centre: "4_18", reach: "near",
    });
  });

  it("survives junk: unreadable lines are kept and reported, a missing reach reads as near", () => {
    const { realms, unread } = parseRealms(["Woods: procedural:overland at 1_1", "nonsense", "", "Bad: x 0 at 1_1, far", "No centre: procedural:overland, far"]);
    expect(realms.map((r) => [r.name, r.reach])).toEqual([["Woods", "near"]]);
    expect(unread).toEqual(["nonsense", "Bad: x 0 at 1_1, far", "No centre: procedural:overland, far"]);
    expect(parseBorders("Wide")).toBe("wide");
    expect(parseBorders("gibberish")).toBe("normal");
    expect(uniqueRealmName("Overland", ["overland", "Overland 2"])).toBe("Overland 3");
  });
});

describe("realms: influence", () => {
  const home = realm("Forest", "0_0", "home");
  const coast = realm("Coast", "16_0", "far");

  it("the same hex gives the same realm whatever the walk order, and coming back gives it again", () => {
    const realms = [home, coast];
    const path = Array.from({ length: 17 }, (_, x) => `${x}_0`);
    const there = path.map((h) => realmAt(h, realms, G, { seed: 7 })!.name);
    const back = [...path].reverse().map((h) => realmAt(h, realms, G, { seed: 7 })!.name).reverse();
    expect(back).toEqual(there);
    // Deep in each realm it's that realm alone; between them both appear.
    expect(there.slice(0, 3)).toEqual(["Forest", "Forest", "Forest"]);
    expect(there.slice(-3)).toEqual(["Coast", "Coast", "Coast"]);
  });

  it("a realm's share rises as the party nears its centre", () => {
    const shares = [0, 4, 8, 12, 16].map((x) => influence(`${x}_0`, [home, coast], G, { seed: 1 })[1]);
    for (let i = 1; i < shares.length; i++) expect(shares[i]).toBeGreaterThan(shares[i - 1]);
    // Sharp borders: the strongest always wins.
    expect(realmAt("12_0", [home, coast], G, { seed: 1, borders: "sharp" })!.name).toBe("Coast");
  });

  it("wider borders mix over a longer stretch than narrow ones", () => {
    const mixed = (borders: "narrow" | "wide") => Array.from({ length: 30 }, (_, x) => influence(`${x}_0`, [home, coast], G, { seed: 3, borders })[1])
      .filter((w) => w > 0.1 && w < 0.9).length;
    expect(mixed("wide")).toBeGreaterThan(mixed("narrow"));
  });
});

describe("realms: placing a centre", () => {
  it("lands in its band and within ±30° of the direction it was given, over 1000 seeds", () => {
    for (const orientation of ["flat", "pointy"] as const) {
      const g: Geometry = { orientation, stagger: "odd" };
      const party = "5_5";
      const [px, py] = hexCenter(5, 5, orientation, "odd");
      for (const dir of directions(orientation)) {
        for (const reach of ["near", "far", "really far"] as const) {
          for (let seed = 0; seed < 1000; seed += 37) {
            const c = placeCentre(party, dir, reach, seed, g);
            const d = hexDistance(hexPair(party), hexPair(c), orientation, "odd");
            const [lo, hi] = REACH_BAND[reach];
            expect(d).toBeGreaterThanOrEqual(lo - 1);
            expect(d).toBeLessThanOrEqual(hi + 1);
            const [cx, cy] = hexCenter(...hexPair(c), orientation, "odd");
            let off = Math.atan2(cy - py, cx - px) - dir.angle;
            off = Math.atan2(Math.sin(off), Math.cos(off));
            // ±30°, plus the snap to a hex.
            expect(Math.abs(off)).toBeLessThanOrEqual(Math.PI / 6 + Math.asin(1.5 / Math.max(1, lo)) + 1e-9);
          }
        }
      }
    }
  });

  it("is the same for the same seed; another roll moves it; home and here stay on the party", () => {
    const ne = directionOf("north-east", "flat")!;
    expect(placeCentre("0_0", ne, "far", 4, G)).toBe(placeCentre("0_0", ne, "far", 4, G));
    expect(new Set(Array.from({ length: 6 }, (_, i) => placeCentre("0_0", ne, "far", 4, G, i))).size).toBeGreaterThan(1);
    expect(placeCentre("3_3", ne, "here", 4, G)).toBe("3_3");
    expect(directionOf("east", "flat")).toBeUndefined();
    expect(directionOf("east", "pointy")?.word).toBe("east");
    expect(directions("flat").map((d) => d.word)).toEqual(["north", "north-east", "south-east", "south", "south-west", "north-west"]);
    expect(describeCentre("0_-12", "0_0", G)).toBe("12 hexes north");
  });

  it("a direction another realm holds is blocked (named for the tooltip); home never blocks", () => {
    const north = directionOf("north", "flat")!;
    const coast = realm("Coast", placeCentre("0_0", north, "far", 2, G), "far");
    const blocked = blockedDirections("0_0", "far", [realm("Home", "0_0", "home"), coast], G, 2);
    expect(blocked.get("north")).toBe("Coast");
    expect(blocked.has("south")).toBe(false);
    expect(blockedDirections("0_0", "far", [realm("Home", "0_0", "home")], G, 2).size).toBe(0);
    expect(blockedDirections("0_0", "here", [coast], G, 2).size).toBe(0);
  });
});

describe("realms: flowers from generators", () => {
  const T = [{ name: "forest", color: "#0a0" }, { name: "hills", color: "#aa0" }, { name: "lake", color: "#00a" }];
  const kind = (id: string, fill: (k: string) => string, extra: Partial<TerrainGeneratorKind> = {}): TerrainGeneratorKind => ({
    id, label: id.split(":")[1], description: "", source: "built-in", options: [], fits: () => true, toPaths: () => ({ paths: [], missing: [] }),
    generate: (req) => {
      const cells = new Map<string, string>();
      for (let x = 0; x < req.grid.cols; x++) for (let y = 0; y < req.grid.rows; y++) cells.set(`${x}_${y}`, fill(`${x}_${y}`));
      return { ok: true, cells, paths: [], warnings: [] };
    },
    ...extra,
  });
  const woods = kind("x:woods", (k) => (hexPair(k)[0] % 4 === 0 ? "hills" : "forest"));
  const lakes = kind("x:lakes", () => "lake");

  it("a generator's mix is read off a seeded sample run; a blend is the weighted sum; only the palette's terrains", () => {
    const s = generatorShares(woods, T, 1, "flat");
    expect("shares" in s && Math.round(s.shares.get("forest")! * 100)).toBe(75);
    expect(generatorShares(kind("x:none", () => "lava", { fits: () => false }), T, 1, "flat")).toEqual({ error: "none doesn't fit this palette." });
    const top = topShares(new Map([["Forest", 3], ["lava", 9], ["hills", 1]]), ["forest", "hills"]);
    expect(top).toEqual([{ terrain: "forest", weight: 3 }, { terrain: "hills", weight: 1 }]);
    const f = new RealmFlowers();
    const blend = f.flowerOf({ name: "Fen", from: [{ ref: "x:woods", link: false, weight: 1 }, { ref: "x:lakes", link: false, weight: 3 }], centre: "0_0", reach: "near" }, { kinds: [woods, lakes], palette: "P", terrains: T, mapSeed: 5, orientation: "flat" })!;
    const counts = new Map<string, number>();
    for (const c of blend.flower.cells) counts.set(c.result, (counts.get(c.result) ?? 0) + 1);
    expect(counts.get("lake")).toBeGreaterThan(counts.get("forest")!);
    expect(blend.flower.name).toBe("Fen");
    // Made once: the same object comes back.
    expect(f.flowerOf({ name: "Fen", from: blend.flower.name ? [{ ref: "x:woods", link: false, weight: 1 }, { ref: "x:lakes", link: false, weight: 3 }] : [], centre: "0_0", reach: "near" }, { kinds: [woods, lakes], palette: "P", terrains: T, mapSeed: 5, orientation: "flat" })).toBe(blend);
  });

  it("sources name a generator by id, by its note's link, or by name; learned ones are written as links", () => {
    const learned = kind("wfc:world/generators/coasts/bay.md", () => "lake", { source: "learned", generatorPath: "world/generators/coasts/bay.md", label: "bay" });
    const kinds = [woods, learned];
    expect(kindForSource({ ref: "x:woods", link: false }, kinds)).toBe(woods);
    expect(kindForSource({ ref: "coasts/bay", link: true }, kinds)).toBe(learned);
    expect(kindForSource({ ref: "Bay", link: false }, kinds)).toBe(learned);
    expect(kindForSource({ ref: "nothing", link: true }, kinds)).toBeUndefined();
    expect(sourceOf(learned)).toEqual({ ref: "world/generators/coasts/bay", link: true, weight: 1 });
    expect(sourceOf(woods)).toEqual({ ref: "x:woods", link: false, weight: 1 });
  });
});

describe("the explore setup's options", () => {
  const grid = { cols: 3, rows: 3, offset: { x: 0, y: 0 } };

  it("areas round-trip and junk is skipped; the start hex defaults to the middle and must be on the grid", () => {
    const text = "north-east far builtin:biome-coastal-fjord; south really far wfc:world/generators/fen.md";
    expect(formatAreas(parseAreas(text))).toBe(text);
    expect(parseAreas("north nowhere x; ; east near")).toEqual([]);
    expect(middleOf(grid)).toBe("1_1");
    expect(startHexOf(grid, "0_2")).toBe("0_2");
    expect(startHexOf(grid, "5_5")).toBe("1_1");
    expect(startHexOf(grid, "junk")).toBe("1_1");
    expect(startHexOf({ cols: 9, rows: 7, offset: { x: 10, y: -3 } }, undefined)).toBe("14_0");
  });

  it("home is centred on the start; each area goes its way at its distance, named after its generator", () => {
    const labels: Record<string, string> = { "procedural:overland": "Overland", "builtin:biome-taiga": "Taiga" };
    const realms = setupRealms(
      { home: "procedural:overland", areas: "north far builtin:biome-taiga; south near procedural:overland; up far x" },
      "1_1", 9, G, (id) => labels[id],
    );
    expect(realms.map((r) => [r.name, r.reach, r.from[0].ref])).toEqual([
      ["Overland", "home", "procedural:overland"], ["Taiga", "far", "builtin:biome-taiga"], ["Overland 2", "near", "procedural:overland"],
    ]);
    expect(realms[0].centre).toBe("1_1");
    expect(hexPair(realms[1].centre)[1]).toBeLessThan(-5);
    expect(hexPair(realms[2].centre)[1]).toBeGreaterThan(5);
    expect(setupRealms({}, "1_1", 9, G, () => undefined)).toEqual([]);
  });

  it("starts on the first built-in engine listed", () => {
    expect(defaultHome([{ id: "wfc:a", source: "learned" }, { id: "procedural:region-detail", source: "built-in", needsContext: true }, { id: "procedural:overland", source: "built-in" }])).toBe("procedural:overland");
    expect(defaultHome([{ id: "wfc:a", source: "learned" }])).toBe("wfc:a");
    expect(defaultHome([])).toBeUndefined();
  });
});
