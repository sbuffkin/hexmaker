/**
 * Fog of war over a finished map (HF11, plan-explore-reveal-existing): the
 * party reveals what's already on the map instead of rolling it. The map
 * note keeps the revealed hexes compressed as runs per row, so a big map
 * stays readable:
 *
 *   explore-seen: ["3: 4-9, 12", "4: 5-8"]
 *
 * (row 3: x 4 to 9 and 12; row 4: x 5 to 8). Read forgivingly: a bare hex
 * key ("4_3") is one hex, junk is dropped. Pure: no Obsidian imports.
 */

import { hexKey, hexPair } from "../hexKey";
import { ringOrder } from "./exploreOrder";

/** The hexes in an `explore-seen` value. */
export function parseSeen(raw: unknown): Set<string> {
  const out = new Set<string>();
  const items = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[;\n]+/) : [];
  for (const item of items) {
    if (typeof item !== "string" && typeof item !== "number") continue;
    const text = String(item).trim();
    const bare = /^(-?\d+)\s*_\s*(-?\d+)$/.exec(text);
    if (bare) { out.add(hexKey(Number(bare[1]), Number(bare[2]))); continue; }
    const row = /^(-?\d+)\s*:\s*(.*)$/.exec(text);
    if (!row) continue;
    const y = Number(row[1]);
    for (const part of row[2].split(",")) {
      const run = /^\s*(-?\d+)\s*(?:(?:-|–|\.\.)\s*(-?\d+))?\s*$/.exec(part);
      if (!run) continue;
      const a = Number(run[1]);
      const b = run[2] === undefined ? a : Number(run[2]);
      // A run is at most a map's width (a typo can't make millions of hexes).
      if (Math.abs(b - a) > 10000) continue;
      for (let x = Math.min(a, b); x <= Math.max(a, b); x++) out.add(hexKey(x, y));
    }
  }
  return out;
}

/** `seen` as runs per row, top row first ([] when none). */
export function formatSeen(seen: Iterable<string>): string[] {
  const rows = new Map<number, number[]>();
  for (const k of seen) {
    const [x, y] = hexPair(k);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const xs = rows.get(y) ?? [];
    xs.push(x);
    rows.set(y, xs);
  }
  const out: string[] = [];
  for (const y of [...rows.keys()].sort((a, b) => a - b)) {
    const xs = [...new Set(rows.get(y))].sort((a, b) => a - b);
    const runs: string[] = [];
    for (let i = 0; i < xs.length;) {
      let j = i;
      while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++;
      runs.push(i === j ? String(xs[i]) : `${xs[i]}-${xs[j]}`);
      i = j + 1;
    }
    out.push(`${y}: ${runs.join(", ")}`);
  }
  return out;
}

/** The hexes `rings` steps or fewer from `center`, the center first. */
export function sightKeys(center: string, rings: number, neighbours: (k: string) => string[]): string[] {
  return [center, ...ringOrder(center, Math.max(0, rings), neighbours).map((r) => r.hex)];
}

/** `seen` with `keys` added (or taken out, `on` false); the same set when nothing changed. */
export function withSeen(seen: ReadonlySet<string>, keys: readonly string[], on: boolean): ReadonlySet<string> {
  const changed = keys.some((k) => seen.has(k) !== on);
  if (!changed) return seen;
  const out = new Set(seen);
  for (const k of keys) {
    if (on) out.add(k);
    else out.delete(k);
  }
  return out;
}

/** Hidden hexes next to a revealed one (the fog's edge: the "?" layer). */
export function fogEdge(seen: ReadonlySet<string>, neighbours: (k: string) => string[]): string[] {
  const out = new Set<string>();
  for (const k of seen) for (const n of neighbours(k)) if (!seen.has(n)) out.add(n);
  return [...out];
}
