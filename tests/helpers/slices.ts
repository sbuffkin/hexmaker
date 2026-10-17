/**
 * Slice-aware tests (the feature switches; dev/release/slices.mjs).
 *
 * Tests run with every slice on unless HEXMAKER_SLICES / _ON / _OFF say
 * otherwise (tests/register.mjs sets the flags from the same switch as the
 * build). `npm run test:slices` runs the contract suite with each slice off,
 * the release set and none, so a test that asserts what a slice adds must say
 * which slice it needs:
 *
 *   describeWith("hexflower", "hex flower menu", () => { … })     // only while it's on
 *   describeWithout("hexflower", "no hex flower menu", () => { … }) // its "off" twin
 *   itWith("space", "Space's moon tethers", () => { … })            // one test in a mixed block
 *   if (sliceOn("space")) …
 */

import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { HexmakerModule } from "../../src/modules/types";

type SliceDef = { define: string | null; modules: string[]; released: boolean; requires?: string[] };

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** release-slices.json's slices. */
export const SLICES: Readonly<Record<string, SliceDef>> = (JSON.parse(readFileSync(path.join(ROOT, "release-slices.json"), "utf8")) as { slices: Record<string, SliceDef> }).slices;

/** The slices with a flag (all but foundation). */
export const FLAGGED_SLICES: readonly string[] = Object.keys(SLICES).filter((id) => SLICES[id].define);

/** Is slice `id` built on in this test run? foundation always is. Unknown ids throw (a typo would skip a test silently). */
export function sliceOn(id: string): boolean {
  const s = SLICES[id];
  if (!s) throw new Error(`tests/helpers/slices: no slice "${id}" in release-slices.json`);
  if (!s.define) return true;
  return (globalThis as Record<string, unknown>)[s.define] === true;
}

/** The slice a module belongs to ("hex-flower" → "hexflower"). */
export function sliceOfModule(moduleId: string): string | undefined {
  return Object.keys(SLICES).find((id) => SLICES[id].modules.includes(moduleId));
}

/** Is module `moduleId` (src/modules/<id>) built in this run? */
export function moduleOn(moduleId: string): boolean {
  const slice = sliceOfModule(moduleId);
  return slice !== undefined && sliceOn(slice);
}

/** The slices off in this run. */
export function slicesOff(): string[] {
  return FLAGGED_SLICES.filter((id) => !sliceOn(id));
}

/** A describe block that runs only while slice(s) `ids` are all on; skipped (and says why) otherwise. */
export function describeWith(ids: string | readonly string[], name: string, fn: () => void): void {
  const off = (typeof ids === "string" ? [ids] : ids).filter((id) => !sliceOn(id));
  void describe(name, off.length ? { skip: `slice ${off.join(", ")} built off` } : {}, fn);
}

/** One test that runs only while slice(s) `ids` are all on (for a block that mixes slices). */
export function itWith(ids: string | readonly string[], name: string, fn: () => void | Promise<void>): void {
  const off = (typeof ids === "string" ? [ids] : ids).filter((id) => !sliceOn(id));
  void it(name, off.length ? { skip: `slice ${off.join(", ")} built off` } : {}, fn);
}

/** A describe block that runs only while slice `id` is off (a slice's "off" twin). */
export function describeWithout(id: string, name: string, fn: () => void): void {
  void describe(name, sliceOn(id) ? { skip: `slice ${id} built on` } : {}, fn);
}

/**
 * Every module of every slice, built on or off in this run: read straight
 * from src/modules/<id>/index.ts (a slice built off still has its source).
 * For tests that check a slice's data whichever slices are on (its owned
 * strings, its placement rows).
 */
export function everyModule(): HexmakerModule[] {
  const req = createRequire(import.meta.url);
  return Object.values(SLICES).flatMap((s) => s.modules).map((id) => {
    const exports = req(path.join(ROOT, "src", "modules", id, "index.ts")) as Record<string, unknown>;
    const mod = Object.values(exports).find((v): v is HexmakerModule => !!v && typeof v === "object" && (v as HexmakerModule).id === id);
    if (!mod) throw new Error(`tests/helpers/slices: src/modules/${id}/index.ts exports no module with id "${id}"`);
    return mod;
  });
}

