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

import type { PathType, TerrainColor, TerrainPalette } from "../types";

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

// ── Path-type fields added to the shipped path types ─────────────────────────
//
// The same idea for path types: a field the shipped path types gained after
// palettes copied them (River's "Carves: water"). The shipped entry
// (DEFAULT_PATH_TYPES) is the source of the value. A palette's path type gets
// it ONCE, and only when the palette's path types are still a copy of the
// shipped list and that field was never set there (the caller checks the
// palette note: no column for it). A value the user set, or cleared to
// "none", is never touched. The path type must still be the shipped record:
// same name and the same behaviour the plugin wrote (routing, auto-route,
// avoid impassable), so a type the user built or reshaped is left alone.

export type PresetPathField = "carves" | "carveWidth";

export interface AddedPresetPathField {
  /** Path type name in the shipped list. */
  pathType: string;
  field: PresetPathField;
}

/** The once-only key for an entry (stored in settings.presetPathFieldsAdded). */
export const pathFieldKey = (a: AddedPresetPathField): string => `${a.pathType}/${a.field}`.toLowerCase();

export interface PresetPathFieldPlan {
  /** Fields to set, per palette path type (the objects themselves). */
  set: { palette: TerrainPalette; pathType: PathType; field: PresetPathField; value: string | number }[];
  /** Keys to remember as done (offered, whether set anywhere or not). */
  done: string[];
}

/** Still the shipped path type: the behaviour fields the plugin wrote are unchanged. */
const sameShippedRecord = (pt: PathType, shipped: PathType): boolean =>
  pt.routing === shipped.routing && pt.autoRoute === shipped.autoRoute && pt.avoidImpassable === shipped.avoidImpassable;

const isSet = (v: unknown): boolean => (typeof v === "string" ? v.trim() !== "" : v !== undefined && v !== null);

/**
 * Which palettes' path types get which shipped field values. `neverSet` says
 * whether a palette never had `field` set (its note has no column for it).
 * Nothing is changed here.
 */
export function planPresetPathFields(
  palettes: TerrainPalette[],
  entries: AddedPresetPathField[],
  alreadyDone: ReadonlySet<string>,
  shipped: readonly PathType[],
  neverSet: (palette: TerrainPalette, field: PresetPathField) => boolean,
): PresetPathFieldPlan {
  const set: PresetPathFieldPlan["set"] = [];
  const done: string[] = [];
  const shippedNames = shipped.map((t) => t.name.toLowerCase());
  for (const e of entries) {
    const key = pathFieldKey(e);
    if (alreadyDone.has(key)) continue;
    const source = shipped.find((t) => t.name.toLowerCase() === e.pathType.toLowerCase());
    const value = source?.[e.field];
    if (!source || !isSet(value)) continue; // not shipped (yet): try again next time
    done.push(key);
    for (const pal of palettes) {
      const types = pal.pathTypes ?? [];
      // A copy of the shipped list: still has most of its types.
      const names = new Set(types.map((t) => t.name.toLowerCase()));
      const kept = shippedNames.filter((n) => names.has(n)).length;
      if (!shippedNames.length || kept / shippedNames.length < COPY_OVERLAP) continue;
      const pt = types.find((t) => t.name.toLowerCase() === source.name.toLowerCase());
      if (!pt || !sameShippedRecord(pt, source) || isSet(pt[e.field]) || !neverSet(pal, e.field)) continue;
      set.push({ palette: pal, pathType: pt, field: e.field, value: value as string | number });
    }
  }
  return { set, done };
}

/** Apply a plan: set each field. */
export function applyPresetPathFields(plan: PresetPathFieldPlan): void {
  for (const { pathType, field, value } of plan.set) {
    if (field === "carves") pathType.carves = String(value);
    else pathType.carveWidth = Number(value);
  }
}
