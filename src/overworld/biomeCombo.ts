/**
 * Combined biomes (owner 2026-10-12: "it'd be nice if the 'edit region' let
 * you multi-select to combine different biomes"): a region made from a
 * weighted blend of several biomes, e.g. Alpine 2 + Taiga 1.
 *
 * Written readably wherever a biome is: the overworld's Biome column and
 * the region map note's `biome:` say "Alpine 2 + Taiga 1" (equal weights:
 * "Alpine + Taiga"). Read forgivingly: labels, ids or note names, links
 * (`[[Alpine]] 2 + [[Taiga]]`), "×2", "x2", "(2)", "+" or "," between
 * parts. Inside the plugin a combination has an id of its own built from
 * its parts ("alpine*2+taiga"), so everything keyed by biome id (the blend
 * field, the region generator, the profiles) takes it like any biome.
 * Biome ids never hold "+" or "*" (biomeSlug), so the two can't clash.
 *
 * Generation draws each cell from the parts by zone (BlendField.zoned:
 * smooth noise per part, weighted), so a mix reads as patches of each part's
 * ground; the combined fields below are what the region's own settings
 * (islands, min patches, tuning) come from.
 *
 * The combination's fields (combineBiomeFields): the Mix is each part's
 * shares times its weight; Terrain weights are merged (weighted); numbers
 * (tuning, land share, islands, min patches) are weighted; the rest
 * (colour, blend width, shore, layer) is the dominant part's, the heaviest
 * (the first listed on a tie). One part is just that biome: same id, same
 * fields, so a single biome gives exactly the output it always did.
 *
 * Pure: no Obsidian imports.
 */

import { TUNING_PARAMS, clampTuning, cleanTuning, tunedOrUnset, type BiomeTuning } from "./biomeTuning";
import { mixShares, type BiomeMixRow, type BiomeNoteFields, type BiomeTerrainWeight } from "./biomeNote";
import { typesInGroup } from "../terrainTypes";

export interface BiomePart {
  id: string;
  /** Relative weight, > 0, any scale. */
  weight: number;
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

/** Whether an id is a combination's ("alpine*2+taiga"). */
export const isComboId = (id: string | undefined): boolean => !!id && id.includes("+");

/**
 * Parts as stored: duplicates merged, weights ≤ 0 (or unreadable) dropped,
 * heaviest first (stable, so equal weights keep their order), and all-equal
 * weights written as 1. One part: that biome alone.
 */
export function normalizeParts(parts: readonly BiomePart[]): BiomePart[] {
  const merged: BiomePart[] = [];
  for (const p of parts) {
    if (!p.id || !Number.isFinite(p.weight) || p.weight <= 0) continue;
    const hit = merged.find((m) => m.id === p.id);
    if (hit) hit.weight += p.weight;
    else merged.push({ id: p.id, weight: p.weight });
  }
  merged.sort((a, b) => b.weight - a.weight);
  if (merged.length && merged.every((p) => Math.abs(p.weight - merged[0].weight) < 1e-9)) for (const p of merged) p.weight = 1;
  if (merged.length === 1) merged[0].weight = 1;
  return merged;
}

/** The id of a combination (a plain biome id for one part, "" for none). */
export function comboId(parts: readonly BiomePart[]): string {
  const n = normalizeParts(parts);
  return n.map((p) => (p.weight === 1 ? p.id : `${p.id}*${fmt(p.weight)}`)).join("+");
}

/** A combination's parts from its id (a plain id: itself, weight 1). */
export function comboParts(id: string): BiomePart[] {
  if (!isComboId(id)) return id ? [{ id, weight: 1 }] : [];
  return id.split("+").map((s) => {
    const [pid, w] = s.split("*");
    return { id: pid, weight: w === undefined ? 1 : Number(w) };
  }).filter((p) => p.id && Number.isFinite(p.weight) && p.weight > 0);
}

/** The heaviest part (the first listed on a tie). */
export function dominantPart(id: string): string | undefined {
  return normalizeParts(comboParts(id))[0]?.id;
}

const WEIGHT_AT_END = /^(.*?)\s*(?:[x×*]\s*)?\(?\s*(\d+(?:\.\d+)?)\s*\)?\s*%?$/i;
const LINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;

/**
 * Read a written combination ("Alpine 2 + Taiga", "[[Alpine]] ×2, [[Taiga]]")
 * into parts, naming each with `resolve` (a label, id or note name → id).
 * Undefined unless there are at least two parts and every one resolves.
 */
export function parseComboRef(ref: string, resolve: (name: string) => string | undefined): BiomePart[] | undefined {
  const text = ref.replace(LINK, (_m, target: string) => target.trim().split("/").pop()!.replace(/\.md$/i, ""));
  const raw = text.split(/\s*[+,]\s*/).map((s) => s.trim()).filter(Boolean);
  if (raw.length < 2) return undefined;
  const parts: BiomePart[] = [];
  for (const r of raw) {
    // The whole part as a name first ("Zone 51" may be a biome), then a weight at its end.
    const whole = resolve(r);
    if (whole) { parts.push({ id: whole, weight: 1 }); continue; }
    const m = WEIGHT_AT_END.exec(r);
    const id = m && m[1] ? resolve(m[1].trim()) : undefined;
    if (!id) return undefined;
    parts.push({ id, weight: Number(m![2]) });
  }
  return parts;
}

/** A combination as written: "Alpine 2 + Taiga 1", or "Alpine + Taiga" when the weights are equal. */
export function formatComboRef(parts: readonly BiomePart[], label: (id: string) => string): string {
  const n = normalizeParts(parts);
  const equal = n.every((p) => p.weight === 1);
  return n.map((p) => (equal ? label(p.id) : `${label(p.id)} ${fmt(p.weight)}`)).join(" + ");
}

/** Share of a mix that's land (not a water type): a land biome's own land share. */
function landOf(mix: readonly BiomeMixRow[]): number {
  let land = 0;
  const water = new Set(typesInGroup("water"));
  for (const [type, share] of mixShares([...mix])) if (!water.has(type)) land += share;
  return land;
}

/** Weighted tuning: each param's value weighted by part share (unset = its default; `inherits` params only where set). */
function combineTuning(parts: readonly { fields: BiomeNoteFields; share: number }[]): BiomeTuning | undefined {
  const out: BiomeTuning = {};
  for (const p of TUNING_PARAMS) {
    const set = parts.map((x) => ({ v: tunedOrUnset(x.fields.tuning, p.key), share: x.share }));
    if (set.every((x) => x.v === undefined)) continue;
    if (p.inherits) {
      const own = set.filter((x) => x.v !== undefined);
      const total = own.reduce((s, x) => s + x.share, 0);
      out[p.key] = clampTuning(p, own.reduce((s, x) => s + x.share * x.v!, 0) / total);
      continue;
    }
    out[p.key] = clampTuning(p, set.reduce((s, x) => s + x.share * (x.v ?? p.default), 0));
  }
  return cleanTuning(out);
}

/**
 * The fields a combination's regions are made from (see the file comment).
 * `parts` must be normalized (heaviest first) and known. One part: its own
 * fields, untouched.
 */
export function combineBiomeFields(id: string, label: string, parts: readonly { fields: BiomeNoteFields; weight: number }[]): BiomeNoteFields {
  if (parts.length === 1) return parts[0].fields;
  const total = parts.reduce((s, p) => s + p.weight, 0);
  const shares = parts.map((p) => ({ fields: p.fields, share: p.weight / total }));
  const lead = parts[0].fields;
  // Mix: each part's shares × its share of the whole (percent, so it reads like a note's).
  const mix: BiomeMixRow[] = [];
  const minP = new Map<string, number>();
  for (const { fields, share } of shares) {
    for (const [type, s] of mixShares(fields.mix)) {
      const hit = mix.find((r) => r.type === type);
      if (hit) hit.weight += s * share * 100;
      else mix.push({ type, weight: s * share * 100 });
    }
    for (const r of fields.mix) if (r.minPatches && r.weight > 0) minP.set(r.type, (minP.get(r.type) ?? 0) + share * r.minPatches);
  }
  for (const r of mix) {
    r.weight = Math.round(r.weight * 1000) / 1000;
    const p = Math.round(minP.get(r.type) ?? 0);
    if (p > 0) r.minPatches = p;
  }
  mix.sort((a, b) => b.weight - a.weight);
  // Terrain weights: every terrain any part weights, weighted by part (unlisted counts 1).
  const names = new Map<string, string>();
  for (const { fields } of shares) for (const w of fields.terrainWeights ?? []) if (!names.has(w.terrain.toLowerCase())) names.set(w.terrain.toLowerCase(), w.terrain);
  const terrainWeights: BiomeTerrainWeight[] = [...names].map(([k, terrain]) => ({
    terrain,
    weight: Math.round(shares.reduce((s, { fields, share }) => s + share * (fields.terrainWeights?.find((w) => w.terrain.toLowerCase() === k)?.weight ?? 1), 0) * 1000) / 1000,
  }));
  const out: BiomeNoteFields = { id, label, mix, transitions: [] };
  if (lead.color) out.color = lead.color;
  if (lead.blend) out.blend = lead.blend;
  if (lead.shore) out.shore = true;
  if (lead.layer) out.layer = lead.layer;
  if (terrainWeights.length) out.terrainWeights = terrainWeights;
  // Islands: weighted, a part without a land share counting its mix's land.
  if (shares.some((s) => s.fields.landShare !== undefined)) {
    out.landShare = Math.round(shares.reduce((s, { fields, share }) => s + share * (fields.landShare ?? landOf(fields.mix)), 0) * 1000) / 1000;
  }
  const islands = Math.round(shares.reduce((s, { fields, share }) => s + share * (fields.minIslands ?? 0), 0));
  if (islands > 0) out.minIslands = islands;
  const tuning = combineTuning(shares);
  if (tuning) out.tuning = tuning;
  // Transitions: every part's (only read for display; combinations aren't placed by World biomes).
  for (const { fields } of shares) for (const t of fields.transitions) if (!out.transitions.some((x) => x.next === t.next && x.between === t.between)) out.transitions.push({ ...t });
  return out;
}
