/**
 * Hex chains → anchors. `anchorsFor` is the only way hexes become anchors
 * (migration, pinning, splitting, reversing, generators): a greedy longest
 * match against the router, exact for any neighbour-connected chain.
 * `mergeChains` joins same-type chains that touch end-on into one path with
 * branches (stroke-preserving), and `compactLegacy` runs the whole legacy
 * migration step over dense-anchor paths. Pure, no Obsidian imports.
 */

import type { HexKey, MapPath } from "../types";
import { hexDistance, type SegmentContext, type SegmentStyle, type RouteContext } from "./router";
import { contextRouter, RouteCache, type SegmentRouter } from "./routeCache";
import { routeBranch, styleOf, type StyleFor } from "./resolve";
import { uniquePathName } from "./names";
import { hexPair } from "../hexKey";

/** The route between two anchors under some fixed context and style. */
export type RouteFn = (a: HexKey, b: HexKey) => { hexes: readonly HexKey[]; fallback?: string };

/** A RouteFn from a router and a style. */
export function routeFnFor(router: SegmentRouter, style: SegmentStyle): RouteFn {
  return (a, b) => router.route(a, b, style);
}

function asRouteFn(r: SegmentContext | RouteFn): RouteFn {
  if (typeof r === "function") return r;
  const router = contextRouter(r);
  return routeFnFor(router, r);
}

/** The chain with consecutive repeats of a hex collapsed (they aren't steps). */
export function dedupeSteps(hexes: readonly HexKey[]): HexKey[] {
  const out: HexKey[] = [];
  for (const h of hexes) if (out[out.length - 1] !== h) out.push(h);
  return out;
}

/**
 * The fewest anchors (greedy, longest match first) whose routes reproduce
 * `hexes`: from anchor i, take the largest j whose routed segment equals
 * hexes[i..j] exactly (a fallback segment only counts for j = i + 1), else
 * j = i + 1. Between neighbours the router always returns the direct step,
 * so any neighbour-connected chain is reproduced exactly. Consecutive
 * repeats are collapsed first. The first and last hexes are always anchors.
 */
export function anchorsFor(
  hexes: readonly HexKey[],
  route: SegmentContext | RouteFn,
  grid?: Pick<RouteContext, "orientation" | "stagger">,
): HexKey[] {
  const h = dedupeSteps(hexes);
  if (h.length <= 1) return h;
  const fn = asRouteFn(route);
  // Only for skipping candidates that can't match (a route is never
  // shorter than the hex distance); taken from the context when there is one.
  const ctx = typeof route === "function" ? grid ?? null : route;
  const anchors = [h[0]];
  let i = 0;
  while (i < h.length - 1) {
    let best = i + 1;
    for (let j = h.length - 1; j > i + 1; j--) {
      // A route is never shorter than the hex distance.
      if (ctx && hexDistance(hexPair(h[i]), hexPair(h[j]), ctx.orientation, ctx.stagger) > j - i) continue;
      const r = fn(h[i], h[j]);
      if (r.fallback || r.hexes.length !== j - i + 1) continue;
      let same = true;
      for (let k = 0; k <= j - i; k++) {
        if (r.hexes[k] !== h[i + k]) { same = false; break; }
      }
      if (same) { best = j; break; }
    }
    anchors.push(h[best]);
    i = best;
  }
  return anchors;
}

/** Whether `anchors` route to exactly `hexes` (consecutive repeats ignored). */
export function reproduces(anchors: readonly HexKey[], hexes: readonly HexKey[], route: SegmentContext | RouteFn): boolean {
  const fn = asRouteFn(route);
  const want = dedupeSteps(hexes);
  const got = routeBranch(anchors, { avoid: false, winding: false }, { route: (a, b) => {
    const r = fn(a, b);
    return { hexes: [...r.hexes] };
  } }).hexes;
  return got.length === want.length && got.every((k, n) => k === want[n]);
}

// ── Merging ──────────────────────────────────────────────────────────────────

/** An undirected step "a|b" (a < b). */
export function stepKey(a: HexKey, b: HexKey): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** The set of undirected steps a set of chains draws. */
export function stepsOf(chains: Iterable<readonly HexKey[]>): Set<string> {
  const s = new Set<string>();
  for (const c of chains) for (let i = 1; i < c.length; i++) if (c[i] !== c[i - 1]) s.add(stepKey(c[i - 1], c[i]));
  return s;
}

export interface MergedGroup {
  /** Branch hex chains; branches[0] is the main line. */
  branches: HexKey[][];
  /** Indices (into the input) of the chains in this group, ascending. */
  members: number[];
  /** Members dropped because every one of their steps was already drawn. */
  duplicates: number[];
}

/**
 * Merge chains (all of ONE type) that touch at an end: a chain whose first
 * or last hex lies anywhere on another chain. Chains that only cross mid-way
 * stay apart. Stroke-preserving: the longest chain of a group is the main
 * line; a chain continuing a branch's tail is appended to it (reversed if
 * needed; the main line can also grow at its head); a chain starting or
 * ending on the path becomes a fork (reversed so it starts on the path); a
 * chain whose every step is already drawn is dropped as a duplicate. The
 * set of steps drawn is unchanged. Groups come out in order of their first
 * member. Chains of fewer than 2 distinct hexes are each their own group.
 */
export function mergeChains(chains: readonly (readonly HexKey[])[]): MergedGroup[] {
  const cs = chains.map(dedupeSteps);
  const n = cs.length;
  const parent = cs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const sets = cs.map((c) => new Set(c));
  for (let a = 0; a < n; a++) {
    if (cs[a].length < 2) continue;
    const ends = [cs[a][0], cs[a][cs[a].length - 1]];
    for (let b = 0; b < n; b++) {
      if (a === b || cs[b].length < 2) continue;
      if (ends.some((e) => sets[b].has(e))) parent[find(a)] = find(b);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  }
  const out: MergedGroup[] = [];
  for (const members of [...groups.values()].sort((x, y) => x[0] - y[0])) {
    // Longest first; ties keep input order.
    const pool = [...members].sort((x, y) => cs[y].length - cs[x].length || x - y);
    const branches: HexKey[][] = [[...cs[pool.shift()!]]];
    const duplicates: number[] = [];
    while (pool.length) {
      const steps = stepsOf(branches);
      const onPath = new Set(branches.flat());
      let placed = -1;
      for (let p = 0; p < pool.length && placed < 0; p++) {
        const c = cs[pool[p]];
        const first = c[0];
        const last = c[c.length - 1];
        if (c.length >= 2 && [...stepsOf([c])].every((s) => steps.has(s))) {
          duplicates.push(pool[p]);
          placed = p;
          break;
        }
        for (const br of branches) {
          const tail = br[br.length - 1];
          if (first === tail) { br.push(...c.slice(1)); placed = p; break; }
          if (last === tail) { br.push(...[...c].reverse().slice(1)); placed = p; break; }
        }
        if (placed >= 0) break;
        const main = branches[0];
        if (last === main[0]) { main.unshift(...c.slice(0, -1)); placed = p; break; }
        if (first === main[0]) { main.unshift(...[...c].reverse().slice(0, -1)); placed = p; break; }
        if (onPath.has(first)) { branches.push([...c]); placed = p; break; }
        if (onPath.has(last)) { branches.push([...c].reverse()); placed = p; break; }
      }
      // Nothing attaches by an end yet (a chain touched only in its interior
      // by a chain that is itself still waiting): take the first one that
      // shares a hex with the path as its own stretch, else the first.
      if (placed < 0) {
        const touching = pool.findIndex((i) => cs[i].some((k) => onPath.has(k)));
        placed = touching >= 0 ? touching : 0;
        branches.push([...cs[pool[placed]]]);
      }
      pool.splice(placed, 1);
    }
    out.push({ branches, members: [...members].sort((x, y) => x - y), duplicates: duplicates.sort((x, y) => x - y) });
  }
  return out;
}

// ── Legacy compaction (the migration step) ───────────────────────────────────

export interface CompactReport {
  pathsIn: number;
  pathsOut: number;
  branches: number;
  anchors: number;
  /** Merged groups: the new path's name and the legacy names it took in. */
  merged: { name: string; from: string[] }[];
  /** Legacy chains dropped because every step was already drawn by the path they joined. */
  duplicates: { name: string; into: string }[];
  /** One-hex leftovers dropped (no Notes, no extra columns). Still in the backup. */
  singlesDropped: { name: string; typeName: string; hex: HexKey }[];
  /** Paths whose new anchors don't reproduce the old steps (kept dense instead). */
  inexact: string[];
  /** Paths that combined differing Notes / extra values from merged chains. */
  combinedText: string[];
}

export interface CompactOptions {
  /** Drop one-hex legacy paths that carry no Notes and no extra columns (Decision 2). */
  dropSingles: boolean;
  /** The types' explicit routing style (see resolve.ts StyleFor). */
  styleFor?: StyleFor;
  /** A cache for the map's routing context (optional). */
  cache?: RouteCache;
}

const hasText = (p: MapPath) => !!p.notes?.trim() || Object.values(p.extra ?? {}).some((v) => v.trim());

/** Distinct non-empty values, joined; and whether more than one was combined. */
function combine(values: (string | undefined)[]): [string | undefined, boolean] {
  const seen: string[] = [];
  for (const v of values) {
    const t = v?.trim();
    if (t && !seen.includes(t)) seen.push(t);
  }
  return [seen.length ? seen.join("; ") : undefined, seen.length > 1];
}

/**
 * The migration step for legacy paths (dense anchors, one branch each, as
 * legacyChainsToPaths makes them): drop one-hex leftovers if asked (only
 * those with no Notes and no extra columns), merge same-type paths that
 * touch end-on, compress every branch with anchorsFor, and rename the
 * results `<Type>`, `<Type> 2`… in the old order. Every result is checked
 * to route back to exactly the steps it came from; one that doesn't keeps
 * its dense anchors and is listed in `inexact`.
 *
 * Paths that aren't legacy-shaped (several branches, or branch labels or
 * extra columns) pass through unchanged.
 */
export function compactLegacy(
  paths: readonly MapPath[],
  ctx: RouteContext,
  opts: CompactOptions,
): { paths: MapPath[]; report: CompactReport } {
  const router: SegmentRouter = opts.cache ? opts.cache : contextRouter(ctx);
  if (opts.cache) opts.cache.setContext(ctx);
  const report: CompactReport = {
    pathsIn: paths.length, pathsOut: 0, branches: 0, anchors: 0,
    merged: [], duplicates: [], singlesDropped: [], inexact: [], combinedText: [],
  };

  const isLegacy = (p: MapPath) =>
    p.branches.length === 1 && !p.branches[0].label && !Object.keys(p.branches[0].extra ?? {}).length;
  const isSingle = (p: MapPath) => isLegacy(p) && dedupeSteps(p.branches[0].anchors).length < 2;

  // Slots in input order; each holds the output path for that position (or null).
  const slots: (MapPath | null)[] = paths.map(() => null);
  const renamed: boolean[] = paths.map(() => false);
  const byType = new Map<string, number[]>();
  paths.forEach((p, i) => {
    if (!isLegacy(p)) {
      slots[i] = p;
      return;
    }
    if (isSingle(p)) {
      if (opts.dropSingles && !hasText(p)) {
        report.singlesDropped.push({ name: p.name, typeName: p.typeName, hex: p.branches[0].anchors[0] });
      } else {
        slots[i] = { ...p, branches: [{ anchors: dedupeSteps(p.branches[0].anchors) }] };
        renamed[i] = true;
      }
      return;
    }
    const list = byType.get(p.typeName);
    if (list) list.push(i);
    else byType.set(p.typeName, [i]);
  });

  for (const [typeName, idx] of byType) {
    const style = styleOf(opts.styleFor, typeName);
    const route = routeFnFor(router, style);
    for (const g of mergeChains(idx.map((i) => paths[i].branches[0].anchors))) {
      const members = g.members.map((m) => paths[idx[m]]);
      const [notes, notesCombined] = combine(members.map((m) => m.notes));
      const extraKeys: string[] = [];
      for (const m of members) for (const k of Object.keys(m.extra ?? {})) if (!extraKeys.includes(k)) extraKeys.push(k);
      const extra: Record<string, string> = {};
      let extraCombined = false;
      for (const k of extraKeys) {
        const [v, c] = combine(members.map((m) => m.extra?.[k]));
        extra[k] = v ?? "";
        extraCombined ||= c;
      }
      const name = members[0].name;
      const branches = g.branches.map((hexes) => {
        const anchors = anchorsFor(hexes, route, ctx);
        return reproduces(anchors, hexes, route) ? anchors : null;
      });
      let exact = branches.every((b) => b !== null);
      const finalBranches = g.branches.map((hexes, k) => ({ anchors: branches[k] ?? [...hexes] }));
      // Segment-exact against the chains that went in.
      if (exact) {
        const want = stepsOf(g.members.map((m) => dedupeSteps(paths[idx[m]].branches[0].anchors)));
        const got = stepsOf(finalBranches.map((b) => routeBranch(b.anchors, style, router).hexes));
        exact = want.size === got.size && [...want].every((s) => got.has(s));
      }
      if (!exact) report.inexact.push(name);
      const out: MapPath = { name, typeName, branches: finalBranches };
      if (notes !== undefined) out.notes = notes;
      if (extraKeys.length) out.extra = extra;
      if (notesCombined || extraCombined) report.combinedText.push(name);
      const at = idx[g.members[0]];
      slots[at] = out;
      renamed[at] = true;
      if (g.members.length > 1) report.merged.push({ name, from: members.map((m) => m.name) });
      for (const d of g.duplicates) report.duplicates.push({ name: paths[idx[d]].name, into: name });
    }
  }

  // Names: <Type>, <Type> 2… in the old order, unique against the paths
  // that passed through unchanged.
  const taken = slots.filter((p, i): p is MapPath => !!p && !renamed[i]).map((p) => p.name);
  const finalNames = new Map<string, string>();
  const result: MapPath[] = [];
  slots.forEach((p, i) => {
    if (!p) return;
    if (renamed[i]) {
      const name = uniquePathName(p.typeName, taken);
      taken.push(name);
      finalNames.set(p.name, name);
      p = { ...p, name };
    }
    result.push(p);
    report.branches += p.branches.length;
    for (const b of p.branches) report.anchors += b.anchors.length;
  });
  const rename = (n: string) => finalNames.get(n) ?? n;
  report.merged = report.merged.map((m) => ({ ...m, name: rename(m.name) }));
  report.duplicates = report.duplicates.map((d) => ({ ...d, into: rename(d.into) }));
  report.inexact = report.inexact.map(rename);
  report.combinedText = report.combinedText.map(rename);
  report.pathsOut = result.length;
  return { paths: result, report };
}
