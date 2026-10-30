/**
 * 1.5.x → 1.6: terrains got a type (what a terrain *is*, whatever it's
 * called). Existing palettes are given types once, from same-named preset
 * terrains, else inferred from the name; later blanks are the user's choice
 * and stay blank. Called from PaletteStore.attach.
 */
import type { TerrainPalette } from "../types";
import { PALETTE_PRESETS } from "../palettes/presets";
import { inferTerrainType } from "../terrainTypes";
import type { MigrationInfo } from "./types";

export const info: MigrationInfo = {
  id: "v1.5-palette-terrain-types",
  from: "1.5.x",
  to: "1.6",
  phase: "palettes",
  change: "Terrains in your palettes got a terrain type, guessed from their names.",
  recordedBy: "terrainTypesSeeded",
};

/**
 * Fill in missing terrain types: a same-named terrain in a preset wins,
 * else the type is inferred from the name/category. Returns how many
 * terrains were typed.
 */
export function seedTerrainTypes(palettes: TerrainPalette[]): number {
  const known = new Map<string, string>();
  for (const p of PALETTE_PRESETS) for (const t of p.terrains) if (t.type) known.set(t.name.toLowerCase(), t.type);
  let n = 0;
  for (const pal of palettes) {
    for (const t of pal.terrains) {
      if (t.type) continue;
      const type = known.get(t.name.toLowerCase()) ?? inferTerrainType(t.name, t.category);
      if (type) { t.type = type; n++; }
    }
  }
  return n;
}
