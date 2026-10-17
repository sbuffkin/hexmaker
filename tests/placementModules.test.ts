import { describe, it } from "node:test";
import expect from "expect";
import { CORE_PLACEMENT, PLACEMENT, layerOf, withModulePlacement } from "../src/ui/placement";
import { MODULES } from "../src/modules";
import { everyModule, moduleOn } from "./helpers/slices";

/**
 * A module places its own controls (HexmakerModule.placement): its rows are
 * merged into PLACEMENT after the core's, so a build without the module
 * carries none of its ids (npm run check:release looks for them).
 */
describe("placement rows from modules", () => {
  it("the merge: core rows first and the core wins; then each module's, in module order", () => {
    const core = { "A.x": "advanced", "A.y": "debug" } as const;
    const merged = withModulePlacement(core, [{ placement: { "M.a": "debug", "A.x": "hidden" } }, {}, { placement: { "M.b": "advanced/Sub", "M.a": "main" } }]);
    expect(Object.keys(merged)).toEqual(["A.x", "A.y", "M.a", "M.b"]);
    expect(merged["A.x"]).toBe("advanced");
    expect(merged["M.a"]).toBe("debug");
    expect(withModulePlacement(core, [])).toEqual(core);
  });

  it("no module re-places a core id or another module's", () => {
    const seen = new Map<string, string>(Object.keys(CORE_PLACEMENT).map((id) => [id, "core"]));
    for (const m of everyModule()) {
      for (const id of Object.keys(m.placement ?? {})) {
        expect({ id, module: m.id, already: seen.get(id) }).toEqual({ id, module: m.id, already: undefined });
        seen.set(id, m.id);
      }
    }
  });

  it("this build's map is the core's rows and those of the modules built, no others", () => {
    expect(PLACEMENT).toEqual(withModulePlacement(CORE_PLACEMENT, MODULES));
    for (const m of everyModule()) {
      for (const [id, at] of Object.entries(m.placement ?? {})) {
        expect({ id, built: Object.prototype.hasOwnProperty.call(PLACEMENT, id) }).toEqual({ id, built: moduleOn(m.id) });
        // Built off, the control isn't there to place: an unlisted id reads as main.
        if (!moduleOn(m.id)) expect(layerOf(id)).toBe("main");
        else expect(PLACEMENT[id]).toBe(at);
      }
    }
  });

  it("the slices' own surfaces sit in their modules: hex flowers, world types, the biome page", () => {
    const owner = (id: string) => everyModule().find((m) => m.placement && id in m.placement)?.id ?? (id in CORE_PLACEMENT ? "core" : undefined);
    expect(owner("FlowerPage.dice")).toBe("hex-flower");
    expect(owner("Settings.hexFlowersFolder")).toBe("hex-flower");
    expect(owner("Wizard.flowerParty")).toBe("hex-flower");
    expect(owner("WorldTypes.previewMap")).toBe("space");
    expect(owner("Settings.worldTypesFolder")).toBe("space");
    expect(owner("BiomePage.tune.reach")).toBe("world-maps");
    expect(owner("EditRegion.blendIntoBiome")).toBe("world-maps");
    // Ids the core's own code names stay in the core (the overworld menu's Reroll and Lock are drawn by the core).
    expect(owner("OverworldMenu.reroll")).toBe("core");
    expect(owner("MapModal.mapRowContextBlendIntoBiome")).toBe("core");
  });
});
