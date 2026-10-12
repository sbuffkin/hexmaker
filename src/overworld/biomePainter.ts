/**
 * The Biome painter (owner round 5, BC1 + MM1): a drawing tool on
 * overworlds. Pick a biome in a compact palette, then click or drag over
 * overworld hexes: each hex gets the biome and its region is made (or
 * remade) automatically, no modal.
 *
 * - A hex with no region yet: placing is a first placement (Build, God).
 * - A hex whose region exists: changing its biome needs God, and only
 *   happens when the hex's biome DIFFERS from the painter's. Re-clicking a
 *   hex that already has the painter's biome does nothing (no regeneration).
 * - Play: nothing changes; the stroke says how to unlock it, once.
 *
 * Strokes run one hex at a time, in order (each region pins the ones made
 * before it), and each changed region is recorded for undo in the
 * overworld's queue for its mode (the view pushes one entry per stroke).
 *
 * Pure: no Obsidian imports.
 */

import { canAdd, canChangeRegion, PLACE_LOCKED_HINT, regionChangeHint } from "../workMode";
import type { BiomeId } from "./biomes";

export type BiomePaintStep =
  /** Nothing to do: the hex already has this biome and its region. */
  | { kind: "skip" }
  /** First placement: set the biome, make the region (Build, God). */
  | { kind: "place" }
  /** A different biome on a placed region: set it, remake the region (God; Build while the region is new, see canChangeRegion). */
  | { kind: "reshape" }
  /** The map's mode doesn't allow it. */
  | { kind: "locked"; hint: string };

/** What painting `painter` onto a hex does, in this map's mode (`region`: the hex's region, for whether it's still open). */
export function biomePaintStep(map: { workMode?: string } | undefined, hasRegion: boolean, current: BiomeId | undefined, painter: BiomeId, region?: { arrival?: string }): BiomePaintStep {
  if (hasRegion) {
    if (current === painter) return { kind: "skip" };
    return canChangeRegion(map, region) ? { kind: "reshape" } : { kind: "locked", hint: regionChangeHint(region) };
  }
  return canAdd(map) ? { kind: "place" } : { kind: "locked", hint: PLACE_LOCKED_HINT };
}

/** What painting one hex came to. */
export interface BiomePaintResult<E> {
  step: BiomePaintStep["kind"];
  /** Undo edits of a reshape (the overworld hex and the region's cells). */
  edits?: E[];
  /** A region that was made. */
  made?: string;
  hint?: string;
  error?: string;
}

/**
 * One drag of the painter: hexes are painted one at a time, in the order
 * the pointer crossed them, each at most once per stroke. `finish()`
 * resolves once every queued hex is done, with what the stroke did.
 */
export class BiomeStroke<E> {
  private seen = new Set<string>();
  private chain: Promise<void> = Promise.resolve();
  private edits: E[] = [];
  private made: string[] = [];
  private changed = 0;
  private remade = 0;
  private hints = new Set<string>();
  private errors: string[] = [];

  constructor(private paintOne: (key: string) => Promise<BiomePaintResult<E>>) {}

  /** Queue a hex (false when this stroke already did it). */
  add(key: string): boolean {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    this.chain = this.chain.then(async () => {
      try {
        const r = await this.paintOne(key);
        if (r.edits?.length) this.edits.push(...r.edits);
        if (r.made) this.made.push(r.made);
        if (r.step === "place" || r.step === "reshape") this.changed++;
        if (r.step === "reshape" && !r.error) this.remade++;
        if (r.hint) this.hints.add(r.hint);
        if (r.error) this.errors.push(r.error);
      } catch (e) {
        this.errors.push(e instanceof Error ? e.message : String(e));
      }
    });
    return true;
  }

  /** Wait for the queue; what the stroke did. */
  async finish(): Promise<{ edits: E[]; made: string[]; changed: number; remade: number; hints: string[]; errors: string[] }> {
    await this.chain;
    return { edits: [...this.edits], made: [...this.made], changed: this.changed, remade: this.remade, hints: [...this.hints], errors: [...this.errors] };
  }
}

/**
 * The one notice after a painter stroke that made or remade regions
 * ("Made Demo Bricks 2, 4.", "Made 3 regions, remade 1 region."), or null when it
 * changed nothing. Once per stroke, like the locked hint.
 */
export function strokeNotice(r: { made: string[]; remade: number }, label: (name: string) => string): string | null {
  const made = r.made.length;
  const remade = r.remade;
  if (!made && !remade) return null;
  const regions = (n: number) => (n === 1 ? "1 region" : `${n} regions`);
  const parts: string[] = [];
  if (made) parts.push(made === 1 ? `Made ${label(r.made[0])}` : `Made ${regions(made)}`);
  if (remade) parts.push(made ? `remade ${regions(remade)}` : `Remade ${regions(remade)}`);
  return parts.join(", ") + ".";
}
