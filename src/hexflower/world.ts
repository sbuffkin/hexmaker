/**
 * The hidden world of an explored map (owner 2026-10-25: "it should be ONE
 * hex of the wider world rather than just accounting for the immediate
 * ones… more like revealing a normal generated map").
 *
 * Before this every hex was rolled on its realm's flower from the terrain
 * of the hex the party came from: no shape bigger than a step, so water
 * came out as scattered ponds instead of coasts and lakes. Now the big
 * shape is fixed by the seed and exploring uncovers it (owner's picks):
 *
 *   - Each realm's generators make a large hidden tile (WORLD_TILE hexes a
 *     side, centred on the realm's centre), the same run New map's
 *     "Generate it now" would make. Past the tile's edge it is mirrored, so
 *     coasts and ranges carry on instead of stopping.
 *   - A realm built from several generators (a blend) gives each a share of
 *     the land in broad patches (smooth noise), not hex by hex.
 *   - Which realm a hex belongs to is realmAt's (soft borders, by area).
 *   - Small local variety: now and then (NUDGE_CHANCE) the realm's flower
 *     moves the hex one step to a nearby terrain, but only to one of the same
 *     shape (water stays water, land stays land, impassable stays
 *     impassable), so it never breaks a coastline or a range.
 *
 * The same hex always has the same hidden terrain (the GM's peek shows it);
 * the nudge is rolled when it is revealed, so rerolls can differ in detail.
 */

import type { TerrainColor } from "../types";
import type { GridSpec } from "../worldgen/generators";
import { optionsWithTuning, runGenerator, type TerrainGeneratorKind } from "../worldgen/registry";
import { mulberry32 } from "../../packages/hex-wfc/src/rng";
import { hashSeed } from "../arrival/arrival";
import { hexKey, hexPair } from "../hexKey";
import { isImpassable } from "../impassable";
import { effectiveTerrainType, inferTerrainType, terrainTypeGroup } from "../terrainTypes";
import { step, type Flower } from "./flower";
import { classifyResult, startCell } from "./explore";
import { kindForSource } from "./realmFlowers";
import { realmAt, type Borders, type Geometry, type Realm } from "./realms";

/** A hidden tile's side, in hexes (a big map's worth: room for the farthest realm's reach). */
export const WORLD_TILE = 64;
/** How often a revealed hex is nudged to a nearby terrain of the same shape. */
export const NUDGE_CHANCE = 0.12;
/** How broad a blend's patches are (hexes across, roughly). */
const BLEND_PATCH = 14;

/** One generator's hidden tile: its cells by tile-local "x_y". */
export interface Tile {
  /** The world hex at the tile's local 0_0 (both even, so the stagger lines up). */
  x0: number;
  y0: number;
  side: number;
  cells: ReadonlyMap<string, string>;
}

/** `v` folded into [0, n): mirrored at each edge, so the land carries on across it. */
export function mirror(v: number, n: number): number {
  const p = 2 * n;
  const t = ((v % p) + p) % p;
  return t < n ? t : p - 1 - t;
}

/** Where a realm centred on `centre` puts its tile's corner (even, so odd/even columns or rows stay odd/even). */
export function tileOrigin(centre: string, side: number): [number, number] {
  const [cx, cy] = hexPair(centre);
  const even = (n: number) => n - (((n % 2) + 2) % 2);
  return [even(cx - Math.floor(side / 2)), even(cy - Math.floor(side / 2))];
}

/** The tile's terrain at world hex `hex` (mirrored past the edge). */
export function tileAt(tile: Tile, hex: string): string | undefined {
  const [x, y] = hexPair(hex);
  return tile.cells.get(hexKey(mirror(x - tile.x0, tile.side), mirror(y - tile.y0, tile.side)));
}

function hash01(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Which of a blend's sources holds `hex`: broad patches (a jittered point
 * every BLEND_PATCH hexes, each given a source by weight; a hex goes with
 * the nearest), each source's land in proportion to its weight. One source:
 * always it.
 */
export function blendPick(weights: readonly number[], hex: string, seed: number): number {
  if (weights.length <= 1) return 0;
  const [x, y] = hexPair(hex);
  const cx = Math.floor(x / BLEND_PATCH), cy = Math.floor(y / BLEND_PATCH);
  let best = Infinity;
  let bestCell: [number, number] = [cx, cy];
  for (let i = cx - 1; i <= cx + 1; i++) {
    for (let j = cy - 1; j <= cy + 1; j++) {
      const px = (i + hash01(seed, i, j)) * BLEND_PATCH;
      const py = (j + hash01(seed ^ 0x5bd1e995, i, j)) * BLEND_PATCH;
      const d = (px - x) ** 2 + (py - y) ** 2;
      if (d < best) { best = d; bestCell = [i, j]; }
    }
  }
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = hash01(seed ^ 0x27d4eb2f, bestCell[0], bestCell[1]) * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll < 0) return i;
  }
  return weights.length - 1;
}

/** A terrain's shape: what a nudge must keep (water / land / …, and impassable or not). */
export function shapeOf(name: string, terrains: readonly TerrainColor[]): string {
  const t = terrains.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!t) return `?${name.toLowerCase()}`;
  // Untyped terrains: by name, as the palette editor would guess.
  const type = effectiveTerrainType(t) ?? inferTerrainType(t.name, t.category);
  return `${terrainTypeGroup(type) ?? "land"}|${isImpassable({ ...t, ...(t.type ? {} : { type }) }) ? "x" : ""}`;
}

/**
 * The small local variety on a revealed hex: with chance `chance` the
 * flower moves one step from the cell showing `base`, and the hex takes
 * that terrain when it has the same shape. Otherwise (or when `base` isn't
 * on the flower) it stays `base`.
 */
export function nudge(base: string, flower: Flower | undefined, terrains: readonly TerrainColor[], seed: number, chance = NUDGE_CHANCE): string {
  if (!flower) return base;
  const rand = mulberry32(seed >>> 0);
  if (rand() >= chance) return base;
  const names = terrains.map((t) => t.name);
  const from = startCell(flower, undefined, base, true);
  const shown = classifyResult(flower.cells[from - 1]?.result ?? "", names, () => false);
  if (shown?.kind !== "terrain" || shown.value.toLowerCase() !== base.toLowerCase()) return base;
  const s = step(flower, from, rand);
  const to = classifyResult(flower.cells[s.cell - 1]?.result ?? "", names, () => false);
  if (to?.kind !== "terrain") return base;
  return shapeOf(to.value, terrains) === shapeOf(base, terrains) ? to.value : base;
}

export interface WorldContext {
  kinds: readonly TerrainGeneratorKind[];
  palette: string;
  terrains: TerrainColor[];
  mapSeed: number;
  geometry: Geometry;
  borders?: Borders;
}

/** The hidden tiles of a map's realms, made once each (per session). */
export class RealmWorlds {
  private tiles = new Map<string, Tile | { error: string }>();

  /** Generator `kind`'s tile for realm `realm` (cached), or why there's none. */
  tileOf(realm: Realm, kind: TerrainGeneratorKind, ctx: WorldContext, side = WORLD_TILE): Tile | { error: string } {
    // By the palette's terrains, not its name: New map's preview and the made map share tiles.
    const palette = ctx.terrains.map((t) => t.name).join("\u0001");
    const key = [realm.name.toLowerCase(), realm.centre, realm.reach, kind.id, palette, ctx.mapSeed, ctx.geometry.orientation, ctx.geometry.stagger, side].join("\u0000");
    let got = this.tiles.get(key);
    if (got) return got;
    const [x0, y0] = tileOrigin(realm.centre, side);
    got = makeTile(kind, ctx, side, hashSeed(ctx.mapSeed >>> 0, "realm-world", realm.name.toLowerCase(), kind.id), x0, y0);
    // Home: the party starts on its centre, so that must be land it can stand on.
    if (!("error" in got) && realm.reach === "home") got = anchorOnLand(got, realm.centre, ctx.terrains);
    this.tiles.set(key, got);
    return got;
  }

  /**
   * The hidden terrain at `hex` (before any nudge), with the realm it lies
   * in; undefined when that realm has no generator tile (a flower note
   * realm, or its generators couldn't run): the caller rolls the flower.
   */
  baseAt(hex: string, realms: readonly Realm[], ctx: WorldContext): { realm: Realm; terrain: string } | undefined {
    const realm = realmAt(hex, realms, ctx.geometry, { seed: ctx.mapSeed, ...(ctx.borders ? { borders: ctx.borders } : {}) });
    if (!realm || realm.flower) return undefined;
    const sources = realm.from.map((s) => ({ s, kind: kindForSource(s, ctx.kinds) })).filter((x) => x.kind && x.kind.fits(ctx.terrains));
    if (!sources.length) return undefined;
    const pick = blendPick(sources.map((x) => x.s.weight), hex, hashSeed(ctx.mapSeed >>> 0, "realm-blend", realm.name.toLowerCase()));
    // The picked source's tile, else any of the others that ran.
    for (const i of [pick, ...sources.keys()]) {
      const tile = this.tileOf(realm, sources[i].kind!, ctx);
      if ("error" in tile) continue;
      const terrain = tileAt(tile, hex);
      if (terrain) return { realm, terrain };
    }
    return undefined;
  }

  /** Forget everything (generators or palettes changed). */
  clear(): void {
    this.tiles.clear();
  }
}

/** Can the party stand on this terrain (not water, not impassable)? */
export function standable(name: string | undefined, terrains: readonly TerrainColor[]): boolean {
  if (!name) return false;
  const [group, blocked] = shapeOf(name, terrains).split("|");
  return group !== "water" && !blocked;
}

/**
 * `tile` shifted (by even steps, so the stagger still lines up) so that
 * `centre` lands on the nearest hex the party can stand on. Unchanged when
 * it already does, or when the tile has no such hex.
 */
export function anchorOnLand(tile: Tile, centre: string, terrains: readonly TerrainColor[]): Tile {
  if (standable(tileAt(tile, centre), terrains)) return tile;
  const [cx, cy] = hexPair(centre);
  const lx = mirror(cx - tile.x0, tile.side), ly = mirror(cy - tile.y0, tile.side);
  let best: [number, number] | undefined;
  let bestD = Infinity;
  for (const [k, t] of tile.cells) {
    const [x, y] = hexPair(k);
    if ((x - lx) % 2 || (y - ly) % 2 || !standable(t, terrains)) continue;
    const d = (x - lx) ** 2 + (y - ly) ** 2;
    if (d < bestD) { bestD = d; best = [x, y]; }
  }
  if (!best) return tile;
  return { ...tile, x0: tile.x0 - (best[0] - lx), y0: tile.y0 - (best[1] - ly) };
}

function makeTile(kind: TerrainGeneratorKind, ctx: WorldContext, side: number, seed: number, x0: number, y0: number): Tile | { error: string } {
  const grid: GridSpec = { cols: side, rows: side, offset: { x: 0, y: 0 }, stagger: ctx.geometry.stagger };
  try {
    const outcome = runGenerator(ctx.geometry.orientation, kind, { terrains: ctx.terrains, grid, seed, options: optionsWithTuning(kind, {}) });
    if (!outcome.ok) return { error: `${kind.label}: ${outcome.message}` };
    if (!outcome.cells.size) return { error: `${kind.label} makes no terrain on this palette.` };
    return { x0, y0, side, cells: outcome.cells };
  } catch (e) {
    return { error: `${kind.label}: ${e instanceof Error ? e.message : String(e)}` };
  }
}
