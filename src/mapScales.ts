/**
 * Map scales ("What are you mapping?", owner 2026-10-12): the kinds of map
 * a first map can be, each from a module (World: Overland; World maps:
 * Biomes; Space: a sector or system, a planet). A scale brings its default
 * size and palette and the generators that fit it; the list always starts
 * with Blank. The setup wizard picks a scale first, then a generator.
 *
 * Pure: no Obsidian imports.
 */

import { registry } from "./modules";
import type { MapScaleDef } from "./modules/types";

export type { MapScaleDef };

/** The scales whose map type is on (unset or empty = every type), in registry order. */
export function scalesFor(mapKinds: Iterable<string> | undefined): MapScaleDef[] {
  const on = mapKinds ? new Set(mapKinds) : undefined;
  return registry.mapScales().filter((s) => !on || on.size === 0 || on.has(s.kind));
}

/** The scale `id` among `scales`, else the first (undefined when there are none). */
export function scaleOrFirst(scales: readonly MapScaleDef[], id: string | undefined): MapScaleDef | undefined {
  return scales.find((s) => s.id === id) ?? scales[0];
}

/**
 * The generators a scale lists, in its order, Blank first. With
 * `otherGenerators`, also every generator of its map type that no scale
 * lists (learned and shipped ones), in list order.
 */
export function scaleGenerators<K extends { id: string; source?: string; mapKind?: string }>(scale: MapScaleDef, all: readonly K[]): K[] {
  const blank = all.filter((k) => k.source === "blank");
  const own = scale.generators.flatMap((id) => all.filter((k) => k.id === id && k.source !== "blank"));
  if (!scale.otherGenerators) return [...blank, ...own];
  const listed = new Set(registry.mapScales().flatMap((s) => s.generators));
  const fallback = registry.fallbackKind();
  const others = all.filter((k) => k.source !== "blank" && !listed.has(k.id) && (registry.kindId(k.mapKind) ?? fallback) === scale.kind);
  return [...blank, ...own, ...others];
}

/** The palette a scale wants for a generator: the generator's own (Orbits: Space - System), else the scale's. */
export function scalePalette(scale: MapScaleDef, generatorId: string | undefined): string {
  return (generatorId ? scale.generatorPalettes?.[generatorId] : undefined) ?? scale.palette;
}
