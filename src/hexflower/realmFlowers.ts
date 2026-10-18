/**
 * A realm's flower (plan-hf6-generator-realms, HF8 step 3): made in memory
 * from the terrain mix of the generator (or blend) that powers it. The mix
 * is read off a seeded 16×16 run of the generator on the map's palette, so
 * every kind of generator (the engines, the shipped biomes and presets,
 * your learned ones) gives terrains this palette has, fitted the way a real
 * map of it would be. The six biggest shares become the flower's patches
 * (fillFromShares), seeded by the map and the realm, so the same map always
 * makes the same flowers. A blend is the weighted sum of its shares.
 *
 * The flowers are cached (RealmFlowers): one sample run per generator,
 * palette and seed.
 */

import type { TerrainColor } from "../types";
import { optionsWithTuning, runGenerator, type TerrainGeneratorKind } from "../worldgen/registry";
import { hashSeed } from "../arrival/arrival";
import { emptyFlower, type Flower } from "./flower";
import { fillFromShares, MAX_FLOWER_TERRAINS, type CellShare } from "./fromPalette";
import type { Realm, RealmSource } from "./realms";

/** The size of the sample run a generator's mix is read from. */
export const SAMPLE_SIZE = 16;

/** The generator a realm's source names: an id, a generator note link, or a generator's name. */
export function kindForSource(src: Pick<RealmSource, "ref" | "link">, kinds: readonly TerrainGeneratorKind[]): TerrainGeneratorKind | undefined {
  const ref = src.ref.trim();
  const t = ref.replace(/\.md$/i, "").toLowerCase();
  if (!src.link) {
    const byId = kinds.find((k) => k.id === ref);
    if (byId) return byId;
  }
  const byPath = kinds.find((k) => {
    const p = k.generatorPath?.replace(/\.md$/i, "").toLowerCase();
    return !!p && (p === t || p.endsWith(`/${t}`));
  });
  return byPath ?? kinds.find((k) => k.label.toLowerCase() === t);
}

/** How a generator is written in a realm: its id, or a link to its note. */
export function sourceOf(kind: Pick<TerrainGeneratorKind, "id" | "generatorPath">, weight = 1): RealmSource {
  return kind.generatorPath
    ? { ref: kind.generatorPath.replace(/\.md$/i, ""), link: true, weight }
    : { ref: kind.id, link: false, weight };
}

/** The six biggest shares of `cells` (palette terrains only), largest first. */
export function topShares(counts: ReadonlyMap<string, number>, terrains: readonly string[], max = MAX_FLOWER_TERRAINS): CellShare[] {
  const known = new Map(terrains.map((t) => [t.toLowerCase(), t]));
  const out = new Map<string, number>();
  for (const [t, w] of counts) {
    const name = known.get(t.toLowerCase());
    if (name && w > 0) out.set(name, (out.get(name) ?? 0) + w);
  }
  return [...out].map(([terrain, weight]) => ({ terrain, weight }))
    .sort((a, b) => b.weight - a.weight || a.terrain.localeCompare(b.terrain))
    .slice(0, max);
}

/** A generator's terrain shares on this palette (a seeded sample run), or why there are none. */
export function generatorShares(
  kind: TerrainGeneratorKind,
  terrains: TerrainColor[],
  seed: number,
  orientation: "flat" | "pointy",
): { shares: Map<string, number> } | { error: string } {
  if (!kind.fits(terrains)) return { error: `${kind.label} doesn't fit this palette.` };
  try {
    const outcome = runGenerator(orientation, kind, {
      terrains,
      grid: { cols: SAMPLE_SIZE, rows: SAMPLE_SIZE, offset: { x: 0, y: 0 }, stagger: "odd" },
      seed,
      options: optionsWithTuning(kind, {}),
    });
    if (!outcome.ok) return { error: `${kind.label}: ${outcome.message}` };
    const counts = new Map<string, number>();
    for (const t of outcome.cells.values()) counts.set(t, (counts.get(t) ?? 0) + 1);
    if (!counts.size) return { error: `${kind.label} makes no terrain on this palette.` };
    const total = outcome.cells.size;
    return { shares: new Map([...counts].map(([t, n]) => [t, n / total])) };
  } catch (e) {
    return { error: `${kind.label}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** The flowers of a map's realms, made once each. */
export class RealmFlowers {
  private shares = new Map<string, Map<string, number> | { error: string }>();
  private flowers = new Map<string, { flower: Flower; problems: string[] }>();

  /** The shares of `kind` on palette `palette` (cached). */
  sharesOf(kind: TerrainGeneratorKind, palette: string, terrains: TerrainColor[], seed: number, orientation: "flat" | "pointy"): Map<string, number> | { error: string } {
    const key = `${kind.id}\u0000${palette}\u0000${seed}\u0000${orientation}`;
    let got = this.shares.get(key);
    if (!got) {
      const r = generatorShares(kind, terrains, seed, orientation);
      got = "error" in r ? r : r.shares;
      this.shares.set(key, got);
    }
    return got;
  }

  /**
   * Realm `realm`'s flower on palette `palette`: its generators' shares
   * (weighted), the six biggest laid out as patches. Problems name sources
   * that couldn't be found or run; with none at all, undefined.
   */
  flowerOf(
    realm: Realm,
    ctx: { kinds: readonly TerrainGeneratorKind[]; palette: string; terrains: TerrainColor[]; mapSeed: number; orientation: "flat" | "pointy" },
  ): { flower: Flower; problems: string[] } | undefined {
    const key = `${realm.name}\u0000${realm.from.map((s) => `${s.ref}*${s.weight}`).join("+")}\u0000${ctx.palette}\u0000${ctx.mapSeed}`;
    const cached = this.flowers.get(key);
    if (cached) return cached;
    const sum = new Map<string, number>();
    const problems: string[] = [];
    // One sample per generator and map, whatever the realm.
    const sampleSeed = hashSeed(ctx.mapSeed >>> 0, "realm-sample");
    for (const src of realm.from) {
      const kind = kindForSource(src, ctx.kinds);
      if (!kind) { problems.push(`No generator called "${src.ref}".`); continue; }
      const s = this.sharesOf(kind, ctx.palette, ctx.terrains, sampleSeed, ctx.orientation);
      if ("error" in s) { problems.push(s.error); continue; }
      for (const [t, w] of s) sum.set(t, (sum.get(t) ?? 0) + w * src.weight);
    }
    const shares = topShares(sum, ctx.terrains.map((t) => t.name));
    if (!shares.length) return undefined;
    const flower = emptyFlower(realm.name, ctx.palette);
    flower.cells = fillFromShares(shares, hashSeed(ctx.mapSeed >>> 0, "realm-flower", realm.name.toLowerCase()));
    const made = { flower, problems };
    this.flowers.set(key, made);
    return made;
  }

  /** Forget everything (generators or palettes changed). */
  clear(): void {
    this.shares.clear();
    this.flowers.clear();
  }
}
