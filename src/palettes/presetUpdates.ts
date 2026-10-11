/**
 * Terrains added to a bundled palette after people installed it (OW8:
 * "savanna" and "river delta" in Expanded). Each is offered to an installed
 * copy of that palette ONCE: added when the palette doesn't have a terrain
 * of that name, then remembered as done, so a user who deletes or renames
 * it never gets it back, and a terrain they already have (their own colour,
 * type, icon) is never touched.
 *
 * Generic: any preset can list new terrains here; nothing is special-cased.
 * A palette counts as a copy of the preset when it has the preset's name
 * and still shares most of its terrains (an unrelated palette that happens
 * to have the name is left alone).
 *
 * Pure: no Obsidian imports. PaletteStore backs up the palette notes before
 * applying the result.
 */

import type { TerrainColor, TerrainPalette } from "../types";

export interface AddedPresetTerrain {
  /** Preset (palette) name. */
  preset: string;
  /** Terrain name in the preset's terrain list. */
  terrain: string;
}

/** Share of the preset's (older) terrains a palette must still have to count as its copy. */
export const COPY_OVERLAP = 0.5;

/** The once-only key for an entry (stored in settings.presetTerrainsAdded). */
export const addedKey = (a: AddedPresetTerrain): string => `${a.preset}/${a.terrain}`.toLowerCase();

export interface PresetTerrainPlan {
  /** Terrains to append, per palette (the palette objects themselves). */
  add: { palette: TerrainPalette; terrains: TerrainColor[] }[];
  /** Keys to remember as done (offered, whether added or not). */
  done: string[];
}

/**
 * Which new preset terrains go into which installed palettes. `presetTerrains`
 * looks a preset's current terrains up by name. Nothing is changed here.
 */
export function planPresetTerrains(
  palettes: TerrainPalette[],
  entries: AddedPresetTerrain[],
  alreadyDone: ReadonlySet<string>,
  presetTerrains: (preset: string) => TerrainColor[] | undefined,
): PresetTerrainPlan {
  const add = new Map<TerrainPalette, TerrainColor[]>();
  const done: string[] = [];
  for (const e of entries) {
    const key = addedKey(e);
    if (alreadyDone.has(key)) continue;
    const preset = presetTerrains(e.preset);
    const fresh = preset?.find((t) => t.name.toLowerCase() === e.terrain.toLowerCase());
    if (!preset || !fresh) continue; // not shipped (yet): try again next time
    done.push(key);
    const pal = palettes.find((p) => p.name === e.preset);
    if (!pal) continue; // not installed: a later install copies the preset as it is now
    const names = new Set(pal.terrains.map((t) => t.name.toLowerCase()));
    const newNames = new Set(entries.filter((x) => x.preset === e.preset).map((x) => x.terrain.toLowerCase()));
    const older = preset.filter((t) => !newNames.has(t.name.toLowerCase()));
    const kept = older.filter((t) => names.has(t.name.toLowerCase())).length;
    if (older.length && kept / older.length < COPY_OVERLAP) continue;
    if (names.has(fresh.name.toLowerCase())) continue;
    const list = add.get(pal) ?? [];
    if (!list.some((t) => t.name.toLowerCase() === fresh.name.toLowerCase())) list.push({ ...fresh });
    add.set(pal, list);
  }
  return { add: [...add].map(([palette, terrains]) => ({ palette, terrains })), done };
}

/** Apply a plan: append the terrains to each palette. */
export function applyPresetTerrains(plan: PresetTerrainPlan): void {
  for (const { palette, terrains } of plan.add) palette.terrains.push(...terrains.map((t) => ({ ...t })));
}
