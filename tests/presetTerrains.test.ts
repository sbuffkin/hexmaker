import { describe, it } from "node:test";
import expect from "expect";
import { ADDED_PRESET_TERRAINS, DEFAULT_PATH_TYPES, DEFAULT_TERRAIN_PALETTE, EXPANDED_PALETTE_NAME, LIMITED_TERRAIN_PALETTE } from "../src/constants";
import { registry } from "../src/modules";

// The World maps module's one-time path-type field (River carves, P7).
const ADDED_PRESET_PATH_FIELDS = registry.addedPresetPathFields();
import { PALETTE_PRESETS } from "../src/palettes/presets";
import { addedKey, applyPresetPathFields, applyPresetTerrains, pathFieldKey, planPresetPathFields, planPresetTerrains } from "../src/palettes/presetUpdates";
import { pathTableHasColumn } from "../src/palettes/pathTypeTable";
import type { PathType, TerrainPalette } from "../src/types";

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
    const added = ADDED_PRESET_TERRAINS.map((a) => a.terrain);
    expect(plan.add[0].terrains.map((t) => t.name)).toEqual(added);
    applyPresetTerrains(plan);
    expect(pal.terrains.slice(-added.length).map((t) => t.name)).toEqual(added);
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
    expect(plan.done).toHaveLength(ADDED_PRESET_TERRAINS.length); // offered; not installed as a copy, so never again
    expect(impostor.terrains).toHaveLength(1);
  });

  it("ships the underground and blight terrains (2026-10-12) in Expanded, each with its own type", () => {
    const want: Record<string, string> = {
      "cave floor": "cave", "solid rock": "cave-wall", chasm: "chasm", "underground lake": "underground-water", "fungal forest": "fungus",
      "crystal cave": "crystal", "lava flow": "lava", "mine shaft": "mine", "dwarven hall": "mine", "blighted land": "blight", "dead forest": "blight",
    };
    for (const [name, type] of Object.entries(want)) {
      expect(DEFAULT_TERRAIN_PALETTE.find((t) => t.name === name)).toMatchObject({ type });
      expect(NEW.has(name)).toBe(true);
    }
    // New types only: no older biome's mix picks them up.
    const older = new Set(DEFAULT_TERRAIN_PALETTE.filter((t) => !NEW.has(t.name)).map((t) => t.type));
    for (const type of Object.values(want)) expect(older.has(type)).toBe(false);
    // Limited stays minimal (G7).
    expect(LIMITED_TERRAIN_PALETTE.some((t) => t.name in want)).toBe(false);
  });

  it("adds the underground terrains once, beside the user's own, and never over a terrain they made", () => {
    const pal = oldExpanded();
    // Their own "Chasm" (a different colour and type) and no savanna (deleted long ago, done).
    pal.terrains.push({ name: "Chasm", color: "#123456", type: "badlands" });
    const done = new Set(["expanded/savanna", "expanded/river delta"]);
    const plan = planPresetTerrains([pal], ADDED_PRESET_TERRAINS, done, presetTerrains);
    applyPresetTerrains(plan);
    expect(pal.terrains.filter((t) => t.name.toLowerCase() === "chasm")).toEqual([{ name: "Chasm", color: "#123456", type: "badlands" }]);
    expect(pal.terrains.some((t) => t.name === "savanna")).toBe(false);
    expect(pal.terrains.find((t) => t.name === "cave floor")).toMatchObject({ type: "cave" });
    // Recorded once: a later start adds nothing, even after the user deletes one.
    pal.terrains = pal.terrains.filter((t) => t.name !== "cave floor");
    const later = planPresetTerrains([pal], ADDED_PRESET_TERRAINS, new Set([...done, ...plan.done]), presetTerrains);
    expect(later.add).toHaveLength(0);
    expect(later.done).toHaveLength(0);
  });

  it("works for an empty or custom palette list (nothing installed: nothing to add)", () => {
    const plan = planPresetTerrains([], ADDED_PRESET_TERRAINS, new Set(), presetTerrains);
    expect(plan.add).toHaveLength(0);
  });
});

describe("fields added to the shipped path types (River: Carves water)", () => {
  const shipped = DEFAULT_PATH_TYPES;
  /** Path types as copied into a palette before carving shipped. */
  const oldTypes = (): PathType[] => shipped.map(({ carves: _c, carveWidth: _w, ...t }) => ({ ...t }));
  const pal = (name: string, pathTypes: PathType[]): TerrainPalette => ({ name, terrains: [], pathTypes });
  const always = () => true;

  it("ships River carving water (the value the upgrade copies)", () => {
    expect(shipped.find((t) => t.name === "River")?.carves).toBe("water");
    expect(ADDED_PRESET_PATH_FIELDS).toEqual([{ pathType: "River", field: "carves" }]);
  });

  it("sets it once on a copy of the shipped types that never set it, and records it as done", () => {
    const p = pal("Mine", oldTypes());
    const plan = planPresetPathFields([p], ADDED_PRESET_PATH_FIELDS, new Set(), shipped, always);
    expect(plan.done).toEqual(["river/carves"]);
    expect(plan.done).toEqual(ADDED_PRESET_PATH_FIELDS.map(pathFieldKey));
    applyPresetPathFields(plan);
    expect(p.pathTypes!.find((t) => t.name === "River")?.carves).toBe("water");
    expect(p.pathTypes!.find((t) => t.name === "Road")?.carves).toBeUndefined();
    // Once: a later run (even with the field cleared again) does nothing.
    p.pathTypes!.find((t) => t.name === "River")!.carves = undefined;
    const again = planPresetPathFields([p], ADDED_PRESET_PATH_FIELDS, new Set(plan.done), shipped, always);
    expect(again).toEqual({ set: [], done: [] });
  });

  it("never overrides a value the user set, or a field they cleared", () => {
    const own = oldTypes();
    own.find((t) => t.name === "River")!.carves = "swamp";
    const ownPal = pal("Own", own);
    const cleared = pal("Cleared", oldTypes());
    // Cleared to none: the note has the Carves column, so it was set.
    const plan = planPresetPathFields([ownPal, cleared], ADDED_PRESET_PATH_FIELDS, new Set(), shipped, (p) => p !== cleared);
    expect(plan.set).toEqual([]);
    expect(plan.done).toEqual(["river/carves"]);
    applyPresetPathFields(plan);
    expect(own.find((t) => t.name === "River")!.carves).toBe("swamp");
    expect(cleared.pathTypes!.find((t) => t.name === "River")!.carves).toBeUndefined();
  });

  it("is a no-op on a palette without the shipped entry (or one reshaped by the user)", () => {
    const noRiver = pal("Roads only", oldTypes().filter((t) => t.name !== "River"));
    const custom = pal("Custom", [
      { name: "Canal", color: "#00f", width: 2, lineStyle: "solid", routing: "edge", avoidImpassable: true, autoRoute: "direct" },
      { name: "Lane", color: "#a50", width: 2, lineStyle: "dashed", routing: "through", avoidImpassable: true, autoRoute: "direct" },
      { name: "Track", color: "#555", width: 1, lineStyle: "dotted", routing: "through", avoidImpassable: true, autoRoute: "direct" },
    ]);
    // A "River" the user reshaped (straight along the edges) is theirs now.
    const reshaped = oldTypes();
    reshaped.find((t) => t.name === "River")!.routing = "edge";
    const plan = planPresetPathFields([noRiver, custom, pal("Reshaped", reshaped), pal("Empty", [])], ADDED_PRESET_PATH_FIELDS, new Set(), shipped, always);
    expect(plan.set).toEqual([]);
    expect(plan.done).toEqual(["river/carves"]);
  });

  it("waits while the shipped entry has no value (nothing recorded)", () => {
    const plan = planPresetPathFields([pal("Mine", oldTypes())], ADDED_PRESET_PATH_FIELDS, new Set(), oldTypes(), always);
    expect(plan).toEqual({ set: [], done: [] });
  });

  it("reads 'never set' from the palette note: no Carves column", () => {
    const old = "## Path types\n\n| Path | Color | Width | Style | Routing |\n| --- | --- | --- | --- | --- |\n| River | `#3b82f6` | 3 | solid | meander |\n";
    const cleared = "## Path types\n\n| Path | Color | Width | Style | Routing | Carves | Carve width |\n| --- | --- | --- | --- | --- | --- | --- |\n| River | `#3b82f6` | 3 | solid | meander | none | 0 |\n";
    expect(pathTableHasColumn(old, "carves")).toBe(false);
    expect(pathTableHasColumn("no table here", "carves")).toBe(false);
    expect(pathTableHasColumn(cleared, "carves")).toBe(true);
    expect(pathTableHasColumn(cleared.replace(/\n/g, "\r\n"), "carveWidth")).toBe(true);
  });
});
