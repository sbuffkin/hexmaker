/**
 * The shipped biomes as preset DATA (#50): written into biome notes once by
 * BiomeStore (seedBiomeNotes), then the notes are what counts. Nothing here
 * is read at run time except to seed a missing note and for "Restore
 * default".
 *
 * Mixes are each biome's terrain-type shares (percent) from the shipped
 * generator it used to borrow its mix from (src/worldgen/builtin), fitted
 * to the Expanded palette; transitions are the old ecotone table; colours
 * are the Expanded terrain each biome painted; the archipelago's islands
 * (land share 30%, at least 2) are the archipelago fix's (BiomeInfo).
 *
 * Min patches: the types smoothing washed out of most regions of the biome
 * (measured with dev/measure-patches.ts: 200 seeds of an 8×8 region, on
 * Expanded) that give it its character, e.g. alpine peaks, a volcano.
 * Coast is a note-only preset (no row in the BIOMES table): a `shore`
 * biome whose land faces its land neighbours. Its climate (coastal
 * lowland, BC3, 2026-10-11) lets World biomes place it on sea↔land borders.
 * "Custom (blank)" is the other note-only preset: `blank`, so its regions
 * start empty for painting by hand (BC1); it has no mix and no climate and
 * is never placed by World biomes.
 *
 * Pure: no Obsidian imports.
 */

import type { BiomeNoteFields } from "./biomeNote";
import { copyClimate } from "./biomeClimate";
import type { MapKind } from "../mapKinds";
import { SHIPPED_BIOMES } from "../modules/world-maps/biomePresets";

/**
 * A shipped biome: its note fields plus the map type it belongs to (data on
 * each item, never decided by name). Its note is only written while that
 * type is on (BiomeStore, biomeSeedingOn): a space-only setup gets none.
 * The type isn't written into the note.
 */
export type BiomePreset = BiomeNoteFields & { kind: MapKind };

/**
 * The shipped biomes. The data lives in the World maps module
 * (src/modules/world-maps/biomePresets.ts, one biome per line); tuned values
 * from a vault are copied in with dev/biomes/export-tuned-biomes.mjs.
 */
export const BIOME_PRESETS: readonly BiomePreset[] = SHIPPED_BIOMES;

/** A copy of a preset's fields (callers may change it). */
export function biomePreset(id: string): BiomeNoteFields | undefined {
  const p = BIOME_PRESETS.find((b) => b.id === id);
  if (!p) return undefined;
  const { kind: _kind, ...fields } = p;
  const out: BiomeNoteFields = { ...fields, mix: p.mix.map((r) => ({ ...r })), transitions: p.transitions.map((t) => ({ ...t })) };
  const climate = copyClimate(p.climate);
  if (climate) out.climate = climate;
  else delete out.climate;
  return out;
}
