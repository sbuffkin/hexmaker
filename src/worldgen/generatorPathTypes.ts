/**
 * The path type a built-in generator draws its paths with: an explicit
 * option ("Path type for routes" on Star scatter, "Path type for orbits" on
 * Orbits) listing the target palette's own path types. Nothing here picks a
 * type by its name (owner rule): the default comes from the Space presets
 * as data (PalettePreset.pathRoles says which of the preset's types fills
 * the role), and a palette whose types were renamed works through the
 * option. Pure, no Obsidian imports.
 */

import type { PathType } from "../types";
import { PALETTE_PRESETS, type PalettePreset } from "../palettes/presets";
import { registry } from "../modules";
import type { ProcOption } from "./procedural/common";

/** A generator path role id ("routes", "orbits"), from a module's pathRoles. */
export type GeneratorPathRole = string;

/** Option value: draw no paths. */
export const NO_PATHS = "none";
/** Option value: the palette's default for the role (see defaultPathTypeFor). */
export const PRESET_PATH_TYPE = "default";

/** Option keys. */
export const ROUTE_TYPE_KEY = "routeType";
export const ORBIT_TYPE_KEY = "orbitType";

/** Each role's option label, from the modules (Space: routes, orbits). */
const label = (role: GeneratorPathRole): string => registry.pathRoles()[role] ?? `Path type for ${role}`;

/**
 * The role's default on a palette with these path types: the type a preset
 * names for the role (pathRoles), when the palette has a type of that name;
 * else none.
 */
export function defaultPathTypeFor(
  role: GeneratorPathRole,
  types: readonly Pick<PathType, "name">[],
  presets: readonly Pick<PalettePreset, "pathRoles">[] = PALETTE_PRESETS,
): string | undefined {
  const names = new Set(types.map((t) => t.name));
  for (const p of presets) {
    const want = p.pathRoles?.[role];
    if (want && names.has(want)) return want;
  }
  return undefined;
}

/**
 * The option as shown for a palette: one choice per path type, plus
 * "None (no paths)". A palette with no path types offers only None, and
 * the choice says why. The default is the role's default (else None).
 */
export function pathTypeOption(
  key: string,
  role: GeneratorPathRole,
  types: readonly Pick<PathType, "name">[] | undefined,
  presets?: readonly Pick<PalettePreset, "pathRoles">[],
): ProcOption {
  const list = types ?? [];
  if (!list.length) {
    return {
      key,
      label: label(role),
      choices: [{ value: NO_PATHS, label: "None (this palette has no path types)" }],
      default: NO_PATHS,
    };
  }
  const seen = new Set<string>();
  const choices: ProcOption["choices"] = [];
  for (const t of list) {
    if (seen.has(t.name)) continue;
    seen.add(t.name);
    choices.push({ value: t.name, label: t.name });
  }
  choices.push({ value: NO_PATHS, label: "None (no paths)" });
  return { key, label: label(role), choices, default: defaultPathTypeFor(role, list, presets) ?? NO_PATHS };
}

/**
 * The option with no palette known (the generator's static option list):
 * its default is "the palette's default", resolved when generating.
 */
export function staticPathTypeOption(key: string, role: GeneratorPathRole): ProcOption {
  return {
    key,
    label: label(role),
    choices: [{ value: PRESET_PATH_TYPE, label: "Palette default" }, { value: NO_PATHS, label: "None (no paths)" }],
    default: PRESET_PATH_TYPE,
  };
}

/**
 * The path type to draw with, from the option's value: a type the palette
 * has; None → undefined; anything else (the "default" value, or a type
 * this palette doesn't have, e.g. a choice saved on another palette) → the
 * role's default on this palette.
 */
export function chosenPathType(
  value: string | undefined,
  role: GeneratorPathRole,
  types: readonly Pick<PathType, "name">[] | undefined,
  presets?: readonly Pick<PalettePreset, "pathRoles">[],
): string | undefined {
  const list = types ?? [];
  if (value !== undefined && list.some((t) => t.name === value)) return value;
  if (value === NO_PATHS) return undefined;
  return defaultPathTypeFor(role, list, presets);
}
