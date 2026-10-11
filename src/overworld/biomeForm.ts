/**
 * The Add / Edit biome form's model (#50), kept apart from the DOM so it
 * can be tested, plus the one routing point for how a biome's regions are
 * made (regionGenerator).
 *
 * Pure: no Obsidian imports.
 */

import { hexNeighbors } from "../../packages/hex-wfc/src/grid";
import type { TerrainColor } from "../types";
import { biomeSlug, type BiomeBlend, type BiomeNoteFields, type BiomeTransition } from "./biomeNote";
import { profileFromFields, type BiomeId } from "./biomes";
import { planRegion, paletteTypeOf, type RegionPlan } from "./regionWorld";
import type { RegionLayout } from "./layout";

// ── routing ──────────────────────────────────────────────────────────────

export type RegionRoute =
  | { kind: "blend" }
  /** Made by a generator note (generateBiomeRegion, src/worldgen/biomeRegion.ts). */
  | { kind: "generator"; generator: string; ready: boolean };

/**
 * How regions of this biome are made: the single routing point. A biome
 * with a `generator:` link has its regions made by that generator
 * (generateBiomeRegion, joined to the cells already painted around it;
 * regionsVault.planRegionWithGenerator); every other biome blends (the
 * blend field mixes its type mix with its neighbours').
 */
export function regionGenerator(biome: Pick<BiomeNoteFields, "generator"> | undefined): RegionRoute {
  if (biome?.generator) return { kind: "generator", generator: biome.generator, ready: true };
  return { kind: "blend" };
}

/** A link target's display name: "world/generators/My tundra" → "My tundra". */
export const generatorName = (target: string): string => target.slice(target.lastIndexOf("/") + 1).replace(/\.md$/, "");

/** The status line shown for a biome (undefined when it simply blends). */
export function routeNote(biome: Pick<BiomeNoteFields, "generator"> | undefined): string | undefined {
  const r = regionGenerator(biome);
  if (r.kind === "generator" && !r.ready) return `Uses ${generatorName(r.generator)}: available once generator regions land. Blends until then.`;
  if (r.kind === "generator") return `Made by ${generatorName(r.generator)}, joined to its neighbours.`;
  return undefined;
}

// ── the form ─────────────────────────────────────────────────────────────

export interface BiomeFormState {
  label: string;
  color: string;
  /** Generator link target, or "" for the built-in blend. */
  generator: string;
  /** Type → weight (0 = not in the mix). */
  mix: Map<string, number>;
  /** "" = the overworld's setting. */
  blend: BiomeBlend | "";
  /** 0..100, or undefined (not set). */
  landPercent?: number;
  minIslands?: number;
  /** Type → fewest patches (the Mix table's Min patches); kept through the form. */
  minPatches: Map<string, number>;
  shore: boolean;
  transitions: BiomeTransition[];
}

/** The types a form offers: the palette's (in order, settlements left out), then any others the biome already uses. */
export function formTypes(palette: TerrainColor[], fields?: Pick<BiomeNoteFields, "mix">): string[] {
  const out: string[] = [];
  for (const t of palette) if (t.type && t.type !== "settlement" && !out.includes(t.type)) out.push(t.type);
  for (const r of fields?.mix ?? []) if (!out.includes(r.type)) out.push(r.type);
  return out;
}

/** A form filled from a biome (or blank for a new one). */
export function formFromFields(fields: BiomeNoteFields | undefined, types: string[]): BiomeFormState {
  const mix = new Map(types.map((t) => [t, 0]));
  for (const r of fields?.mix ?? []) mix.set(r.type, (mix.get(r.type) ?? 0) + r.weight);
  return {
    label: fields?.label ?? "",
    color: fields?.color ?? "#7a9a5a",
    generator: fields?.generator ?? "",
    mix,
    blend: fields?.blend ?? "",
    landPercent: fields?.landShare !== undefined ? Math.round(fields.landShare * 100) : undefined,
    minIslands: fields?.minIslands,
    minPatches: new Map((fields?.mix ?? []).filter((r) => r.minPatches !== undefined).map((r) => [r.type, r.minPatches!])),
    shore: !!fields?.shore,
    transitions: (fields?.transitions ?? []).map((t) => ({ ...t })),
  };
}

/** The note fields a form says (`id` kept from the biome being edited, else from the label). */
export function fieldsFromForm(s: BiomeFormState, id?: string): BiomeNoteFields {
  const f: BiomeNoteFields = {
    id: id ?? (biomeSlug(s.label) || "biome"),
    label: s.label.trim(),
    color: s.color || undefined,
    mix: [...s.mix].filter(([, w]) => w > 0).map(([type, weight]) => {
      const minPatches = s.minPatches?.get(type);
      return minPatches !== undefined ? { type, weight, minPatches } : { type, weight };
    }),
    transitions: s.transitions.filter((t) => t.next.trim() && t.between.trim()).map((t) => ({ next: t.next.trim(), between: t.between.trim() })),
  };
  if (!f.color) delete f.color;
  if (s.generator) f.generator = s.generator;
  if (s.blend) f.blend = s.blend;
  if (s.landPercent !== undefined) f.landShare = Math.min(100, Math.max(0, s.landPercent)) / 100;
  if (s.minIslands !== undefined) f.minIslands = Math.max(0, Math.round(s.minIslands));
  if (s.shore) f.shore = true;
  return f;
}

/** Why the form can't be saved, or undefined. `others`: the labels and ids of the other biomes. */
export function formProblem(s: BiomeFormState, others: { id: string; label: string }[]): string | undefined {
  const label = s.label.trim();
  if (!label) return "Give the biome a name.";
  const k = biomeSlug(label);
  if (!k) return "Use some letters or numbers in the name.";
  if (others.some((o) => o.id === k || biomeSlug(o.label) === k)) return `There's already a biome called ${label}.`;
  if (![...s.mix.values()].some((w) => w > 0)) return "Give at least one terrain type a weight.";
  return undefined;
}

/**
 * A preview of one region of this biome: the region of hex (0, 0) with its
 * neighbours the same biome, made by the blend field from the form's mix.
 */
export function previewRegion(layout: RegionLayout, palette: TerrainColor[], fields: BiomeNoteFields, seed: number): RegionPlan {
  const id: BiomeId = fields.id;
  const biomes = new Map<string, BiomeId>([["0_0", id]]);
  for (const [x, y] of hexNeighbors(0, 0, layout.orientation, layout.parentStagger)) biomes.set(`${x}_${y}`, id);
  const profile = profileFromFields({ ...fields, id }, palette);
  return planRegion({
    layout,
    parent: [0, 0],
    biomes,
    profiles: new Map([[id, profile]]),
    typeOf: paletteTypeOf(palette),
    worldSeed: seed,
    seed,
    blend: fields.blend,
  });
}
