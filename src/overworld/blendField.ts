/**
 * The influence field (plan-overworld-regions §4.2): a per-cell biome mix
 * that depends only on the cell's position and the overworld, never on
 * which regions were generated first. Both sides of a seam therefore see
 * the same mix, and a biome two regions away has ~no weight (no "smear").
 *
 *   w_X(p) = exp(−k · (|p − c_X| / D)²)   for overworld hexes X within 2·D of p
 *   Φ(p)   = Σ_X w_X β_X / Σ_X w_X          β_X = X's biome (one-hot)
 *
 * c_X is region X's centre in the child plane, D the spacing between
 * neighbouring region centres, k the blend width (narrow 6, normal 3.5,
 * wide 2; any number works).
 *
 * `terrainMix` turns Φ into terrain odds type first, then name within type
 * (§4.2 "blend by type, then pick within the type").
 *
 * Pure: no Obsidian imports.
 */

import { hexDistance } from "../../packages/hex-wfc/src/grid";
import type { BiomeId, BiomeProfile } from "./biomes";
import { fbm } from "./noise";
import { childPoint, parentOf, regionCentrePoint, regionSpacing, type RegionLayout } from "./layout";

/**
 * Domain warp used for region generation (region spacings). Measured on the
 * preview fixtures: hex-flower seams agree on type ~84% vs ~79% unwarped,
 * with the far-seam smear still ~1%. The plain field (warp 0) is the plan default.
 */
export const REGION_WARP = 0.2;

export type BlendWidth = "narrow" | "normal" | "wide";
export const BLEND_K: Record<BlendWidth, number> = { narrow: 6, normal: 3.5, wide: 2 };

/** k for a named width or a number (clamped to a sane range). */
export function blendK(width: BlendWidth | number | undefined): number {
  if (typeof width === "number" && Number.isFinite(width)) return Math.min(20, Math.max(0.5, width));
  return BLEND_K[(width as BlendWidth) ?? "normal"] ?? BLEND_K.normal;
}

/** Overworld hexes are searched this many steps out from the cell's own parent (at least; a longer reach searches further). */
const SEARCH_RING = 3;
/** Influence cut-off, in region spacings (biome tuning "reach"). */
export const CUTOFF = 2;
/** Border-wiggle noise frequency: bumps per region spacing (biome tuning "wiggle-scale"). */
export const WARP_SCALE = 1.4;

export type BiomeMix = Map<BiomeId, number>;

/** Zones of a mixed biome's parts: noise bumps per region spacing, and how sharply a zone belongs to one part. */
export const ZONE_SCALE = 2.2;
export const ZONE_SHARPNESS = 14;

/** A part's zone noise seed: from its id and the world's warp seed (position-only, so seams agree). */
function zoneSeed(id: string, seed: number): number {
  let h = 0x811c9dc5 ^ seed;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

export class BlendField {
  readonly k: number;
  /** Region spacing D, child-plane units. */
  readonly spacing: number;
  private centres = new Map<string, [number, number]>();
  private cache = new Map<string, BiomeMix>();

  readonly warp: number;
  readonly warpSeed: number;
  /** Noise bumps per region spacing in the warp. */
  readonly warpScale: number;
  /** Influence cut-off, in region spacings. */
  readonly reach: number;
  private ring: number;
  /** A mixed biome's parts (biomeCombo.ts), for zoned(); undefined for a plain biome. */
  private readonly expand?: (id: BiomeId) => readonly { id: BiomeId; weight: number }[] | undefined;
  private zoneCache = new Map<string, BiomeMix>();

  /**
   * @param biomes overworld hex key ("px_py") → its biome. Hexes without a
   *   biome (off the map, blank, settlements nobody resolved) are skipped.
   * @param opts.warp domain warp, in region spacings (default 0 = the plain
   *   field). Each cell's position is pushed by smooth noise before the
   *   field is read, so biome boundaries wander instead of following the
   *   seams. Still a function of position only: seams match from both sides.
   */
  constructor(
    readonly layout: RegionLayout,
    readonly biomes: ReadonlyMap<string, BiomeId>,
    width: BlendWidth | number = "normal",
    opts: { warp?: number; seed?: number; warpScale?: number; reach?: number; expand?: (id: BiomeId) => readonly { id: BiomeId; weight: number }[] | undefined } = {},
  ) {
    this.expand = opts.expand;
    this.k = blendK(width);
    this.spacing = regionSpacing(layout);
    this.warp = Math.max(0, opts.warp ?? 0);
    this.warpSeed = (opts.seed ?? 0) >>> 0;
    this.warpScale = opts.warpScale !== undefined && opts.warpScale > 0 ? opts.warpScale : WARP_SCALE;
    this.reach = opts.reach !== undefined && opts.reach > 0 ? opts.reach : CUTOFF;
    this.ring = Math.max(SEARCH_RING, Math.ceil(this.reach) + 1);
  }

  /** The cell's (warped) point in the child plane. */
  private point(x: number, y: number): [number, number] {
    const [cx, cy] = childPoint(this.layout, x, y);
    if (!this.warp) return [cx, cy];
    // About one noise bump per region; two octaves.
    const f = this.warpScale / this.spacing;
    const dx = fbm(this.warpSeed + 17, cx * f, cy * f, 2) - 0.5;
    const dy = fbm(this.warpSeed + 4099, cx * f, cy * f, 2) - 0.5;
    const amp = 2 * this.warp * this.spacing;
    return [cx + dx * amp, cy + dy * amp];
  }

  private centre(px: number, py: number): [number, number] {
    const key = `${px}_${py}`;
    let c = this.centres.get(key);
    if (!c) { c = regionCentrePoint(this.layout, px, py); this.centres.set(key, c); }
    return c;
  }

  /** Raw weights per overworld hex for child cell (x, y): [parentKey, weight][]. */
  weights(x: number, y: number): [string, number][] {
    const l = this.layout;
    const [p0x, p0y] = parentOf(l, x, y);
    const [cx, cy] = this.point(x, y);
    const out: [string, number][] = [];
    const ring = this.ring;
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        const px = p0x + dx, py = p0y + dy;
        if (hexDistance([p0x, p0y], [px, py], l.orientation, l.parentStagger) > ring) continue;
        const key = `${px}_${py}`;
        if (!this.biomes.has(key)) continue;
        const [ax, ay] = this.centre(px, py);
        const d = Math.hypot(ax - cx, ay - cy) / this.spacing;
        if (d > this.reach) continue;
        out.push([key, Math.exp(-this.k * d * d)]);
      }
    }
    return out;
  }

  /** Φ at child cell (x, y): biome → share, summing to 1 (empty when no overworld hex is near). */
  at(x: number, y: number): BiomeMix {
    const ck = `${x}_${y}`;
    const hit = this.cache.get(ck);
    if (hit) return hit;
    const mix: BiomeMix = new Map();
    let total = 0;
    for (const [key, w] of this.weights(x, y)) {
      const b = this.biomes.get(key)!;
      mix.set(b, (mix.get(b) ?? 0) + w);
      total += w;
    }
    if (total > 0) for (const [b, w] of mix) mix.set(b, w / total);
    this.cache.set(ck, mix);
    return mix;
  }

  /**
   * Φ with each mixed biome (Alpine 2 + Taiga) split into its parts by
   * zone: smooth noise per part, weighted by the part's weight, so each part
   * holds patches of ground (alpine ridges, taiga woods) rather than a
   * salt-and-pepper mix that smoothing would wash into the heaviest type.
   * A function of position only, so both sides of a seam agree. The very
   * same map as at() when no mixed biome is near (single biomes: no change).
   */
  zoned(x: number, y: number): BiomeMix {
    const phi = this.at(x, y);
    if (!this.expand) return phi;
    const ck = `${x}_${y}`;
    const hit = this.zoneCache.get(ck);
    if (hit) return hit;
    let out: BiomeMix | undefined;
    for (const [b, f] of phi) {
      const parts = this.expand(b);
      if (!parts || parts.length < 2) continue;
      out ??= new Map();
      const [cx, cy] = this.point(x, y);
      const fr = ZONE_SCALE / this.spacing;
      const score = parts.map((p) => Math.log(Math.max(1e-9, p.weight)) + ZONE_SHARPNESS * (fbm(zoneSeed(p.id, this.warpSeed), cx * fr, cy * fr, 2) - 0.5));
      const top = Math.max(...score);
      const z = score.map((s) => Math.exp(s - top));
      const sum = z.reduce((s, v) => s + v, 0);
      parts.forEach((p, i) => out!.set(p.id, (out!.get(p.id) ?? 0) + (f * z[i]) / sum));
    }
    if (!out) { this.zoneCache.set(ck, phi); return phi; }
    // Plain biomes keep their share (in Φ's order, after the parts).
    for (const [b, f] of phi) if ((this.expand(b)?.length ?? 0) < 2) out.set(b, (out.get(b) ?? 0) + f);
    this.zoneCache.set(ck, out);
    return out;
  }

  /** Mean Φ over a set of cells (a region's own mix: its biome + "from"). */
  mean(cells: Iterable<[number, number]>): BiomeMix {
    const out: BiomeMix = new Map();
    let n = 0;
    for (const [x, y] of cells) {
      for (const [b, v] of this.at(x, y)) out.set(b, (out.get(b) ?? 0) + v);
      n++;
    }
    if (n) for (const [b, v] of out) out.set(b, v / n);
    return out;
  }
}

/** τ(p): terrain-type odds, Σ_b Φ_b · share_b(type). */
export function typeMix(phi: BiomeMix, profiles: ReadonlyMap<BiomeId, BiomeProfile>): Map<string, number> {
  const out = new Map<string, number>();
  let total = 0;
  for (const [b, f] of phi) {
    const p = profiles.get(b);
    if (!p) continue;
    for (const [type, s] of p.types) {
      out.set(type, (out.get(type) ?? 0) + f * s);
      total += f * s;
    }
  }
  if (total > 0) for (const [t, v] of out) out.set(t, v / total);
  return out;
}

/**
 * ν(p)[name | type]: which palette terrain a cell of `type` uses. Each
 * biome votes with (Φ_b · share_b(type))^sharpness · P_b(name | type), so
 * the biome that supplies most of that type there picks its names
 * (pine vs broadleaf). sharpness 1 is a plain linear mix.
 */
export function namesWithinType(
  phi: BiomeMix,
  profiles: ReadonlyMap<BiomeId, BiomeProfile>,
  type: string,
  sharpness = 2,
): Map<string, number> {
  const out = new Map<string, number>();
  let total = 0;
  for (const [b, f] of phi) {
    const p = profiles.get(b);
    const share = p?.types.get(type);
    if (!p || !share) continue;
    const vote = Math.pow(f * share, sharpness);
    for (const [name, q] of p.names.get(type) ?? []) {
      out.set(name, (out.get(name) ?? 0) + vote * q);
      total += vote * q;
    }
  }
  if (total > 0) for (const [n, v] of out) out.set(n, v / total);
  return out;
}

/** P(name | p) = τ(p)[type] · ν(p)[name | type]. Sums to 1. */
export function terrainMix(phi: BiomeMix, profiles: ReadonlyMap<BiomeId, BiomeProfile>, sharpness = 2): Map<string, number> {
  const out = new Map<string, number>();
  for (const [type, t] of typeMix(phi, profiles)) {
    for (const [name, v] of namesWithinType(phi, profiles, type, sharpness)) out.set(name, (out.get(name) ?? 0) + t * v);
  }
  return out;
}
