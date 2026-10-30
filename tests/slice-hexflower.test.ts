import { describe, it } from "node:test";
import expect from "expect";
import { moduleFog, moduleGenerators, moduleNewMapModes, modulePartyClick } from "../src/modules/runtime";
import { FogService } from "../src/hexflower/FogService";
import { setFog } from "../src/hexflower/context";
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

/** A map under fog (HF11) and the party's own hex clicked on it. */
function fogged() {
  const map = { name: "m", gridSize: { cols: 5, rows: 5 }, gridOffset: { x: 0, y: 0 }, exploreFog: "on", exploreSeen: ["2: 2"] };
  const p = { settings: { hexOrientation: "flat" }, getMap: (n: string) => (n === "m" ? map : undefined), saveSettings: async () => {} };
  setFog(p as never, new FogService(p as never, () => {}));
  const click = { map: "m", token: "p.md", from: "2_2", to: "2_2", orientation: "flat" as const, stagger: "odd" as const };
  return { map, p, click };
}

describeWith("hexflower", "hexflower on: fog of war (HF11)", () => {
  it("a fogged map has fog; the party's own hex is a look around", () => {
    const { map, p, click } = fogged();
    const fog = moduleFog(p as never, map as never);
    expect(fog?.hidden("2_2")).toBe(false);
    expect(fog?.hidden("0_0")).toBe(true);
    expect(modulePartyClick(p as never, click)).toBe("look");
  });
});

describeWithout("hexflower", "hexflower off: no fog", () => {
  it("no fog over any map, and the party's own hex does nothing", () => {
    const { map, p, click } = fogged();
    expect(moduleFog(p as never, map as never)).toBeUndefined();
    expect(modulePartyClick(p as never, click)).toBe("none");
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
