import { describe, it } from "node:test";
import expect from "expect";
import { ADDED_PRESET_TERRAINS, DEFAULT_TERRAIN_PALETTE, EXPANDED_PALETTE_NAME, LIMITED_TERRAIN_PALETTE } from "../src/constants";
import { PALETTE_PRESETS } from "../src/palettes/presets";
import { addedKey, applyPresetTerrains, planPresetTerrains } from "../src/palettes/presetUpdates";
import type { TerrainPalette } from "../src/types";

const presetTerrains = (n: string) => PALETTE_PRESETS.find((p) => p.name === n)?.terrains;
const NEW = new Set(ADDED_PRESET_TERRAINS.map((a) => a.terrain));
/** An Expanded palette as installed before OW8. */
const oldExpanded = (): TerrainPalette => ({
  name: EXPANDED_PALETTE_NAME,
  terrains: DEFAULT_TERRAIN_PALETTE.filter((t) => !NEW.has(t.name)).map((t) => ({ ...t })),
});

describe("terrains added to a bundled palette (OW8)", () => {
  it("ships savanna and river delta in Expanded, typed and coloured", () => {
    const sav = DEFAULT_TERRAIN_PALETTE.find((t) => t.name === "savanna")!;
    const delta = DEFAULT_TERRAIN_PALETTE.find((t) => t.name === "river delta")!;
    expect(sav).toMatchObject({ type: "grassland" });
    expect(delta).toMatchObject({ type: "wetland" });
    expect(sav.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(delta.icon).toBeTruthy();
  });

  it("adds them once to an installed Expanded copy, and records each as done", () => {
    const pal = oldExpanded();
    const plan = planPresetTerrains([pal], ADDED_PRESET_TERRAINS, new Set(), presetTerrains);
    expect(plan.add).toHaveLength(1);
    expect(plan.add[0].terrains.map((t) => t.name)).toEqual(["savanna", "river delta"]);
    applyPresetTerrains(plan);
    expect(pal.terrains.slice(-2).map((t) => t.name)).toEqual(["savanna", "river delta"]);
    expect(plan.done).toEqual(ADDED_PRESET_TERRAINS.map(addedKey));
    // Next start: already done, nothing more.
    const again = planPresetTerrains([pal], ADDED_PRESET_TERRAINS, new Set(plan.done), presetTerrains);
    expect(again.add).toHaveLength(0);
    expect(again.done).toHaveLength(0);
  });

  it("never overwrites a terrain the user already has, and never re-adds one they deleted", () => {
    const pal = oldExpanded();
    pal.terrains.push({ name: "Savanna", color: "#000000", type: "desert" });
    const plan = planPresetTerrains([pal], ADDED_PRESET_TERRAINS, new Set(), presetTerrains);
    applyPresetTerrains(plan);
    expect(pal.terrains.filter((t) => t.name.toLowerCase() === "savanna")).toEqual([{ name: "Savanna", color: "#000000", type: "desert" }]);
    expect(pal.terrains.some((t) => t.name === "river delta")).toBe(true);
    // The user deletes river delta: once done, it stays deleted.
    pal.terrains = pal.terrains.filter((t) => t.name !== "river delta");
    const later = planPresetTerrains([pal], ADDED_PRESET_TERRAINS, new Set(plan.done), presetTerrains);
    expect(later.add).toHaveLength(0);
  });

  it("leaves palettes that aren't a copy of the preset alone (other names, or the name on a different palette)", () => {
    const limited: TerrainPalette = { name: "Limited", terrains: LIMITED_TERRAIN_PALETTE.map((t) => ({ ...t })) };
    const impostor: TerrainPalette = { name: EXPANDED_PALETTE_NAME, terrains: [{ name: "lava sea", color: "#f00" }] };
    const plan = planPresetTerrains([limited, impostor], ADDED_PRESET_TERRAINS, new Set(), presetTerrains);
    expect(plan.add).toHaveLength(0);
    expect(plan.done).toHaveLength(2); // offered; not installed as a copy, so never again
    expect(impostor.terrains).toHaveLength(1);
  });

  it("works for an empty or custom palette list (nothing installed: nothing to add)", () => {
    const plan = planPresetTerrains([], ADDED_PRESET_TERRAINS, new Set(), presetTerrains);
    expect(plan.add).toHaveLength(0);
  });
});
