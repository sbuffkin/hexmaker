import type { PathType, SubmapDefault, TerrainColor, TerrainPalette } from "../types";
import type { MapKind } from "../mapKinds";
import { clonePathTypes } from "./pathTypeTable";
import { DEFAULT_PATH_TYPES } from "../constants";
import { registry } from "../modules";

/**
 * A built-in palette users can install from "Add palette", the setup wizard,
 * or any new-map palette dropdown. Installing copies the terrains into a new
 * palette note and merges any preset path types (by name) into settings.
 */
export interface PalettePreset {
  name: string;
  description: string;
  terrains: TerrainColor[];
  pathTypes?: PathType[];
  /** Palette suggested for submaps of maps using this one. */
  childPalette?: string;
  /** Map type this preset belongs to (hidden when that type is off). */
  kind: MapKind;
  /** Per-terrain submap setup (see SubmapDefault). */
  submapDefaults?: Record<string, SubmapDefault>;
  /**
   * Which of the preset's own path types the built-in generators draw with
   * by default (data, so nothing in code picks a path type by its name).
   * Only a default: each generator has an option to pick any of the
   * palette's path types, so a renamed type works through that option.
   */
  pathRoles?: PresetPathRoles;
}

/** The generator path roles a preset can fill (see worldgen/generatorPathTypes.ts). */
export interface PresetPathRoles {
  /** Star scatter's routes between systems. */
  routes?: string;
  /** Orbits' rings around the star. */
  orbits?: string;
}

/**
 * Every preset, in module order (src/modules): World's Expanded and
 * Limited, then Space's. A module that isn't there adds none.
 */
export const PALETTE_PRESETS: PalettePreset[] = registry.palettes();

export function getPreset(name: string): PalettePreset | undefined {
  return PALETTE_PRESETS.find((p) => p.name === name);
}

/** Deep copy of a preset's terrains, safe to mutate. */
export function presetToPalette(preset: PalettePreset, name = preset.name): TerrainPalette {
  const pal: TerrainPalette = { name, terrains: preset.terrains.map((t) => ({ ...t })), kind: preset.kind };
  if (preset.childPalette) pal.childPalette = preset.childPalette;
  if (preset.submapDefaults) pal.submapDefaults = cloneSubmapDefaults(preset.submapDefaults);
  pal.pathTypes = clonePathTypes(preset.pathTypes ?? DEFAULT_PATH_TYPES);
  return pal;
}

/** `base`, or `base 2`, `base 3`, … — first name not taken (case-insensitive). */
export function uniquePaletteName(base: string, taken: Iterable<string>): string {
  const lower = new Set([...taken].map((n) => n.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}


/** Deep copy of a submap-defaults map. */
export function cloneSubmapDefaults(d: Record<string, SubmapDefault>): Record<string, SubmapDefault> {
  return Object.fromEntries(
    Object.entries(d).map(([k, v]) => [k, { ...v, ...(v.options ? { options: { ...v.options } } : {}) }]),
  );
}
