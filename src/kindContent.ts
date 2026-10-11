/**
 * What a setup installs follows the map types it picked (owner call SP3:
 * a space-only setup gets nothing fantasy). Every shipped content item says
 * which map type it belongs to — palette presets (`PalettePreset.kind`),
 * biome presets (`kind` on each), the world types table (space) — and this
 * plans, from that data alone, what to install or drop. Nothing here looks
 * at a palette's name to decide its type.
 *
 * - A type's content is installed only when the setup wizard picks the
 *   type or it's turned on in Settings, and once (settings.kindContent
 *   records which), so a palette or biome note the user deleted stays
 *   deleted. Startup never installs: a vault without a record gets one
 *   inferred from its enabled types (inferKindContent) and nothing written.
 * - During the first setup only (before the wizard finishes), shipped
 *   palettes a fresh install put in for a type the user then left off are
 *   dropped again, but only when untouched (same terrains as the preset)
 *   and no map uses them.
 * - "Palette for new maps" moves to the first palette of an enabled type
 *   only when the one it names belongs to a type that's off.
 *
 * Pure: no Obsidian imports.
 */

import { ALL_MAP_KINDS, paletteKind, type MapKind } from "./mapKinds";
import type { TerrainColor } from "./types";
import { PALETTE_PRESETS, type PalettePreset } from "./palettes/presets";
import { terrainsEqual } from "./palettes/paletteNote";

export interface KindContentInput {
  /** Map types on now. */
  kinds: readonly MapKind[];
  /** settings.kindContent: types whose content is in already (null/undefined = none decided yet). */
  done: readonly string[] | null | undefined;
  /** The first setup hasn't finished: untouched shipped palettes of types left off may go. */
  firstSetup: boolean;
  palettes: readonly { name: string; kind?: string; terrains: readonly TerrainColor[] }[];
  /** Palettes a map uses (the unused placeholder map left out). */
  inUse: ReadonlySet<string>;
  /** settings.defaultPalette */
  defaultPalette?: string;
  presets?: readonly PalettePreset[];
}

export interface KindContentPlan {
  /** Preset names to install, in preset order. */
  install: string[];
  /** Installed palettes to drop (first setup only). */
  remove: string[];
  /** Types whose content goes in now (biome notes, world types…). */
  newKinds: MapKind[];
  /** New "Palette for new maps", when it has to change. */
  defaultPalette?: string;
  /** settings.kindContent afterwards. */
  done: MapKind[];
}

export function planKindContent(input: KindContentInput): KindContentPlan {
  const presets = input.presets ?? PALETTE_PRESETS;
  const on = new Set(input.kinds);
  const done = new Set((input.done ?? []).filter((k): k is MapKind => (ALL_MAP_KINDS as string[]).includes(k)));
  const newKinds = ALL_MAP_KINDS.filter((k) => on.has(k) && !done.has(k));

  const lower = (n: string) => n.toLowerCase();
  const remove = input.firstSetup
    ? input.palettes
      .filter((p) => !on.has(paletteKind(p)) && !input.inUse.has(p.name))
      .filter((p) => {
        const preset = presets.find((x) => lower(x.name) === lower(p.name));
        return !!preset && preset.kind === paletteKind(p) && terrainsEqual([...p.terrains], preset.terrains);
      })
      .map((p) => p.name)
    : [];
  const gone = new Set(remove);
  const kept = input.palettes.filter((p) => !gone.has(p.name));
  const have = new Set(kept.map((p) => lower(p.name)));
  const install = presets
    .filter((p) => newKinds.includes(p.kind) && !have.has(lower(p.name)))
    .map((p) => p.name);

  // The palette list once the plan is applied, for the default.
  const after = [
    ...kept.map((p) => ({ name: p.name, kind: paletteKind(p) })),
    ...install.map((n) => ({ name: n, kind: presets.find((p) => p.name === n)!.kind })),
  ];
  const want = input.defaultPalette;
  const wantKind = want
    ? after.find((p) => p.name === want)?.kind ?? presets.find((p) => p.name === want)?.kind
    : undefined;
  let defaultPalette: string | undefined;
  if (want && (wantKind === undefined ? gone.has(want) : !on.has(wantKind))) {
    const first = ALL_MAP_KINDS.filter((k) => on.has(k))
      .map((k) => after.find((p) => p.kind === k)?.name ?? presets.find((p) => p.kind === k)?.name)
      .find((n): n is string => !!n);
    if (first && first !== want) defaultPalette = first;
  }

  return {
    install,
    remove,
    newKinds,
    ...(defaultPalette ? { defaultPalette } : {}),
    done: ALL_MAP_KINDS.filter((k) => done.has(k) || on.has(k)),
  };
}

/**
 * May the shipped biome notes of map type `kind` be written? Never while the
 * type is off (a space-only setup gets none). Otherwise when it's asked for
 * (`explicit`: the setup picked the type, it was turned on in Settings, or
 * the first overworld or region was made, DJ-Q4), or when the vault
 * already has shipped biome notes (later shipped biomes top them up, once
 * each). A vault that never had biome notes and makes no overworld gets
 * none written on its own (no content into a vault that didn't ask for it).
 */
export function biomeSeedingOn(
  settings: { mapKinds?: string[]; biomesSeeded?: string[] },
  kind: MapKind,
  explicit = false,
): boolean {
  const kinds = Array.isArray(settings.mapKinds) ? settings.mapKinds : ALL_MAP_KINDS;
  if (!kinds.includes(kind)) return false;
  return explicit || (settings.biomesSeeded?.length ?? 0) > 0;
}

/**
 * settings.kindContent once the setup is over (finished or turned off)
 * without picking the map types (a vault set up by hand, a recipe, an
 * older build): the types it has on count as decided, and nothing is
 * installed for them. Undecided while the setup is still to come.
 */
export function inferKindContent(settings: {
  kindContent?: string[] | null;
  mapKinds?: string[];
  setupComplete?: boolean;
  setupDismissed?: boolean;
}): string[] | null {
  if (Array.isArray(settings.kindContent)) return settings.kindContent;
  if (!settings.setupComplete && !settings.setupDismissed) return null;
  return [...(Array.isArray(settings.mapKinds) ? settings.mapKinds : ALL_MAP_KINDS)];
}

/**
 * settings.kindContent for data.json as loaded: a saved list wins; `null`
 * (saved by a fresh install) means its setup hasn't picked the map types
 * yet; no key at all on an install that already had settings (an update
 * from before map-type content) counts its enabled types as installed (it
 * has their content already). A fresh install starts at `null`.
 */
export function resolveKindContent(
  raw: Record<string, unknown> | null | undefined,
  mapKinds: readonly string[],
): string[] | null {
  const saved = raw?.["kindContent"];
  if (Array.isArray(saved)) return saved.filter((k): k is string => typeof k === "string");
  if (saved === null) return null;
  return raw && Object.keys(raw).length > 0 ? [...mapKinds] : null;
}
