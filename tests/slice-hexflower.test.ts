import { describe, it } from "node:test";
import expect from "expect";
import { moduleGenerators, moduleNewMapModes } from "../src/modules/runtime";
import { mapModeChoices, modeOfKind } from "../src/worldgen/newMapSetup/modes";
import { visibleKinds, type TerrainGeneratorKind } from "../src/worldgen/registry";
import { describeWith, describeWithout } from "./helpers/slices";

/**
 * Hex flowers as a slice ("hexflower"): exploring as you go is a kind of
 * map New map offers (HF8, owner B1), never a generator in a list. Built
 * off, New map's Terrain choice is just Generate it now / Blank.
 */

const helpers = { toPaths: () => ({ paths: [], missing: [] }), procGrid: (g: never) => ({ ...(g as object), orientation: "flat" as const }) } as never;
const plugin = { settings: { hexOrientation: "flat" } } as never;
const ids = (list: readonly { id: string }[]) => list.map((x) => x.id);

describeWith("hexflower", "hexflower on: New map's Explore as you go", () => {
  it("is a mode made by the Hex flower generator, between Generate it now and Blank", () => {
    const modes = moduleNewMapModes();
    expect(modes.map((m) => [m.id, m.label, m.generatorId])).toEqual([["explore", "Explore as you go", "procedural:hex-flower"]]);
    expect(ids(mapModeChoices(modes))).toEqual(["generate", "explore", "blank"]);
    expect(modeOfKind("procedural:hex-flower", mapModeChoices(modes))).toBe("explore");
  });

  it("the Hex flower generator is never in a generator list, but is still found by id", () => {
    const gens = moduleGenerators(plugin, helpers) as TerrainGeneratorKind[];
    const flower = gens.find((g) => g.id === "procedural:hex-flower");
    expect(flower?.unlisted).toBe(true);
    expect(ids(visibleKinds(gens, { mapKinds: [] }, new Set(), "procedural:hex-flower"))).not.toContain("procedural:hex-flower");
  });
});

describeWithout("hexflower", "hexflower off: no explore mode", () => {
  it("New map's Terrain choice is Generate it now / Blank, and there is no Hex flower generator", () => {
    expect(moduleNewMapModes()).toEqual([]);
    expect(ids(mapModeChoices(moduleNewMapModes()))).toEqual(["generate", "blank"]);
    expect(ids(moduleGenerators(plugin, helpers))).not.toContain("procedural:hex-flower");
  });
});

describe("New map's Terrain choice (both ways)", () => {
  it("the mode follows the generator the form is on", () => {
    const choices = mapModeChoices([{ id: "explore", label: "Explore", desc: "", generatorId: "x:flower" }]);
    expect(modeOfKind("blank", choices)).toBe("blank");
    expect(modeOfKind("x:flower", choices)).toBe("explore");
    expect(modeOfKind("procedural:overland", choices)).toBe("generate");
  });
});
