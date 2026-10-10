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

/** Overworld hexes are searched this many steps out from the cell's own parent. */
const SEARCH_RING = 3;
/** Influence cut-off, in region spacings. */
const CUTOFF = 2;

export type BiomeMix = Map<BiomeId, number>;

export class BlendField {
  readonly k: number;
  /** Region spacing D, child-plane units. */
  readonly spacing: number;
  private centres = new Map<string, [number, number]>();
  private cache = new Map<string, BiomeMix>();

  readonly warp: number;
  readonly warpSeed: number;

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
    opts: { warp?: number; seed?: number } = {},
  ) {
    this.k = blendK(width);
    this.spacing = regionSpacing(layout);
    this.warp = Math.max(0, opts.warp ?? 0);
    this.warpSeed = (opts.seed ?? 0) >>> 0;
  }

  /** The cell's (warped) point in the child plane. */
  private point(x: number, y: number): [number, number] {
    const [cx, cy] = childPoint(this.layout, x, y);
    if (!this.warp) return [cx, cy];
    // About one noise bump per region; two octaves.
    const f = 1.4 / this.spacing;
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
    for (let dy = -SEARCH_RING; dy <= SEARCH_RING; dy++) {
      for (let dx = -SEARCH_RING; dx <= SEARCH_RING; dx++) {
        const px = p0x + dx, py = p0y + dy;
        if (hexDistance([p0x, p0y], [px, py], l.orientation, l.parentStagger) > SEARCH_RING) continue;
        const key = `${px}_${py}`;
        if (!this.biomes.has(key)) continue;
        const [ax, ay] = this.centre(px, py);
        const d = Math.hypot(ax - cx, ay - cy) / this.spacing;
        if (d > CUTOFF) continue;
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
