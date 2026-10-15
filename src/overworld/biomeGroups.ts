/**
 * Groups for the biome pickers (owner 2026-10-12: the list grows long;
 * "scale the UI, never trim the options"): Surface, Mountains, Water,
 * Underground, Blank, worked out from each biome's own data, never its
 * name, so the user's biomes land in a group too:
 *
 * - `blank: yes` → Blank; `layer: underground` → Underground;
 * - its climate's elevation: sea → Water, mid or high → Mountains;
 * - a watery biome (land share under half) → Water;
 * - no climate: by its Mix (half or more water types → Water, underground
 *   types → Underground, hills / mountains / peaks → Mountains);
 * - anything else → Surface.
 *
 * Pure: no Obsidian imports.
 */

import { isPlaceable } from "./biomeClimate";
import { isUnderground, mixShares, type BiomeNoteFields } from "./biomeNote";
import { typesInGroup } from "../terrainTypes";

export type BiomeGroup = "surface" | "mountains" | "water" | "underground" | "blank";

/** The groups in picker order, with their headings. */
export const BIOME_GROUPS: readonly { id: BiomeGroup; label: string }[] = [
  { id: "surface", label: "Surface" },
  { id: "mountains", label: "Mountains" },
  { id: "water", label: "Water" },
  { id: "underground", label: "Underground" },
  { id: "blank", label: "Blank" },
];

/** Terrain types of high ground (the core's vocabulary, not terrain names). */
const HIGH_TYPES = ["hills", "mountains", "peaks"];

/** The picker group of a biome (see the file comment). */
export function biomeGroupOf(b: Pick<BiomeNoteFields, "blank" | "layer" | "climate" | "landShare" | "mix">): BiomeGroup {
  if (b.blank) return "blank";
  if (isUnderground(b)) return "underground";
  const e = b.climate?.elevation;
  if (e === "sea") return "water";
  if (e === "mid" || e === "high") return "mountains";
  if (b.landShare !== undefined && b.landShare < 0.5) return "water";
  if (!isPlaceable(b.climate)) {
    const shares = mixShares(b.mix);
    const sum = (types: readonly string[]) => types.reduce((s, t) => s + (shares.get(t) ?? 0), 0);
    if (sum(typesInGroup("water")) >= 0.5) return "water";
    if (sum(typesInGroup("underground")) >= 0.5) return "underground";
    if (sum(HIGH_TYPES) >= 0.5) return "mountains";
  }
  return "surface";
}

/** Items grouped in picker order (empty groups left out), keeping their order within a group. */
export function groupBiomes<T>(items: readonly T[], groupOf: (item: T) => BiomeGroup): { id: BiomeGroup; label: string; items: T[] }[] {
  return BIOME_GROUPS.map((g) => ({ ...g, items: items.filter((i) => groupOf(i) === g.id) })).filter((g) => g.items.length);
}
