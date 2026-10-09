import { describe, it } from "node:test";
import expect from "expect";
import { suggestImpassable } from "../src/worldgen/impassableHint";
import type { HexWfcModel, PathFeature } from "../packages/hex-wfc/src";

/** Suggesting impassable terrain from a generator (src/worldgen/impassableHint.ts). */

const terrains = (shares: Record<string, number>) => Object.entries(shares).map(([name, weight]) => ({ name, weight }));
const route = (type: string, to: string, through: Record<string, number>, count = 1): PathFeature =>
  ({ type, from: "edge", to, count, turn: 0.2, length: 0.5, through });
const model = (shares: Record<string, number>, paths: PathFeature[] = []): HexWfcModel =>
  ({ name: "m", terrains: terrains(shares), adjacency: [], meta: {}, exampleHexes: 900, paths });

describe("impassable suggestions", () => {
  const coast = { sea: 300, grass: 300, forest: 200, marsh: 30, hills: 70 };
  const paths = [
    route("Road", "edge", { grass: 0.6, forest: 0.3, hills: 0.1 }, 3),
    route("Road", "town", { grass: 0.5, forest: 0.5 }, 2),
    route("River", "sea", { grass: 0.7, hills: 0.2, sea: 0.1 }, 2),
  ];

  it("suggests big terrain that every path type goes around", () => {
    expect(suggestImpassable(model(coast, paths)).map((h) => h.terrain)).toEqual(["sea"]);
  });

  it("doesn't count a path that ends in it (a river into the sea) as crossing", () => {
    // The river's 10% "through" sea is its mouth, so sea is still suggested.
    const hint = suggestImpassable(model(coast, paths))[0];
    expect(hint.reason).toContain("never cross it");
  });

  it("doesn't suggest small terrain the paths just weren't drawn near", () => {
    expect(suggestImpassable(model(coast, paths)).map((h) => h.terrain)).not.toContain("marsh");
  });

  it("doesn't suggest terrain one path type uses, even if another avoids it", () => {
    const withMountains = { ...coast, mountain: 150 };
    const roadsOverMountains = [...paths, route("Road", "peak", { mountain: 0.8, grass: 0.2 }, 3)];
    expect(suggestImpassable(model(withMountains, roadsOverMountains)).map((h) => h.terrain)).not.toContain("mountain");
  });

  it("needs enough path to be sure", () => {
    const one = [route("Road", "town", { grass: 1 }, 1)];
    // A single short road missing a third of the map proves little.
    expect(suggestImpassable({ ...model(coast, one), exampleHexes: 40 })).toEqual([]);
  });

  it("skips terrain already marked impassable", () => {
    expect(suggestImpassable(model(coast, paths), new Map(), ["sea"])).toEqual([]);
  });

  it("without paths, only suggests big terrain that looks like water", () => {
    const colors = new Map([["deepblue", "#2a4d9b"], ["grass", "#5a9a3a"], ["Lake", "#999999"]]);
    const m = model({ deepblue: 300, grass: 400, Lake: 100, forest: 200 });
    const hints = suggestImpassable(m, colors);
    expect(hints.map((h) => h.terrain)).toEqual(["deepblue", "Lake"]);
    expect(hints[0].reason).toContain("colour");
    expect(hints[1].reason).toContain("name");
  });
});
