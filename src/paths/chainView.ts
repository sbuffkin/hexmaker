/**
 * The COMPATIBILITY VIEW between the stored model (MapPath[]: named paths,
 * anchors, branches) and the every-hex PathChain[] that code not yet
 * switched to paths still reads and edits (map.pathChains: the path tool,
 * generators, type rename/delete, exports). Pure, no Obsidian imports.
 *
 * - buildView: paths → one chain per resolved branch, remembering which
 *   (path, branch) each chain object came from.
 * - reconcile: whatever was done to those chains since (hexes pushed or
 *   spliced in place, chains added, removed, split, replaced by undo
 *   snapshots, a type renamed) → the paths, keeping each path's name,
 *   notes, labels and extra columns. Unchanged branches keep their anchors
 *   exactly; a changed branch is re-anchored from its new hexes (anchorsOf,
 *   which the caller makes exact with fromHexes.anchorsFor).
 *
 * Matching a chain to where it came from, in order: the same object; else
 * an unclaimed source with the same type and hexes (undo/redo snapshots are
 * clones); else a recently removed branch with the same type and hexes
 * (undoing a delete brings its path's name back); else an unclaimed source
 * of the same type it shares a step with (a split: the pieces stay branches
 * of that path); else it's a new path, named `<Type>`, `<Type> 2`…
 */

import type { HexKey, MapPath, PathBranch, PathChain } from "../types";
import type { ResolvedBranch } from "./resolve";
import { uniquePathName } from "./names";
import { stepsOf } from "./fromHexes";

/** Where a handed-out chain came from, and what it held then. */
export interface ChainSource {
  path: string;
  branch: number;
  typeName: string;
  hexes: HexKey[];
}

/** A branch that left the paths through the view (for undo). */
interface RemovedBranch {
  path: string;
  typeName: string;
  notes?: string;
  extra?: Record<string, string>;
  branch: PathBranch;
  hexes: HexKey[];
}

/** How many removed branches are remembered for undo. */
const REMEMBER_REMOVED = 64;

export interface PathView {
  /** Every chain handed out, with its source as of the last build/reconcile. */
  sources: Map<PathChain, ChainSource>;
  /** Branches removed through the view, newest last. */
  removed: RemovedBranch[];
}

export function emptyView(): PathView {
  return { sources: new Map(), removed: [] };
}

/** The chains of resolved branches (one per branch with hexes) and their view. */
export function buildView(resolved: readonly ResolvedBranch[], removed: RemovedBranch[] = []): { chains: PathChain[]; view: PathView } {
  const chains: PathChain[] = [];
  const sources = new Map<PathChain, ChainSource>();
  for (const r of resolved) {
    if (!r.hexes.length) continue;
    const c: PathChain = { typeName: r.typeName, hexes: [...r.hexes] };
    chains.push(c);
    sources.set(c, { path: r.path, branch: r.branch, typeName: r.typeName, hexes: [...r.hexes] });
  }
  return { chains, view: { sources, removed } };
}

const same = (a: readonly HexKey[], b: readonly HexKey[]) => a.length === b.length && a.every((k, i) => k === b[i]);

function cloneBranch(b: PathBranch): PathBranch {
  const out: PathBranch = { anchors: [...b.anchors] };
  if (b.label !== undefined) out.label = b.label;
  if (b.extra) out.extra = { ...b.extra };
  return out;
}

type Claim =
  | { kind: "source"; src: ChainSource }
  | { kind: "attach"; src: ChainSource }
  | { kind: "restore"; dead: RemovedBranch }
  | { kind: "new" };

interface OutBranch {
  branch: PathBranch;
  chain?: PathChain;
}

/**
 * Fold edits made to the view's chains back into the paths. Returns the new
 * paths (the input is never mutated), the view to keep, and whether the
 * paths changed. `anchorsOf(typeName, hexes)` turns a changed chain's hexes
 * into anchors that route back to exactly those hexes.
 */
export function reconcile(
  paths: readonly MapPath[],
  chains: readonly PathChain[],
  view: PathView,
  anchorsOf: (typeName: string, hexes: HexKey[]) => HexKey[],
): { paths: MapPath[]; view: PathView; changed: boolean } {
  const pathIdx = new Map(paths.map((p, i) => [p.name, i]));
  const valid = (s: ChainSource) => {
    const i = pathIdx.get(s.path);
    return i !== undefined && s.branch >= 0 && s.branch < paths[i].branches.length;
  };
  const sources = [...view.sources.values()].filter(valid);
  const claimed = new Set<ChainSource>();
  const removed = [...view.removed];
  const usedDead = new Set<RemovedBranch>();
  const live = chains.filter((c) => c && Array.isArray(c.hexes) && c.hexes.length > 0);
  const claims = new Map<PathChain, Claim>();

  // 1. the same object
  for (const c of live) {
    const s = view.sources.get(c);
    if (s && valid(s) && !claimed.has(s)) {
      claimed.add(s);
      claims.set(c, { kind: "source", src: s });
    }
  }
  // 2. an unclaimed source with the same type and hexes (snapshot clones)
  for (const c of live) {
    if (claims.has(c)) continue;
    const s = sources.find((x) => !claimed.has(x) && x.typeName === c.typeName && same(x.hexes, c.hexes));
    if (s) {
      claimed.add(s);
      claims.set(c, { kind: "source", src: s });
    }
  }
  // 3. a removed branch with the same type and hexes (undo of a delete)
  for (const c of live) {
    if (claims.has(c)) continue;
    for (let i = removed.length - 1; i >= 0; i--) {
      const d = removed[i];
      if (!usedDead.has(d) && d.typeName === c.typeName && same(d.hexes, c.hexes)) {
        usedDead.add(d);
        claims.set(c, { kind: "restore", dead: d });
        break;
      }
    }
  }
  // 4. a step shared with an unclaimed source of the same type (split pieces)
  for (const c of live) {
    if (claims.has(c)) continue;
    const steps = stepsOf([c.hexes]);
    const s = sources.find((x) => !claimed.has(x) && x.typeName === c.typeName && [...stepsOf([x.hexes])].some((k) => steps.has(k)));
    claims.set(c, s ? { kind: "attach", src: s } : { kind: "new" });
  }

  // Branch slots: "<path index>:<branch>" → the chain now holding it.
  const slot = (s: ChainSource) => `${pathIdx.get(s.path)}:${s.branch}`;
  const bySlot = new Map<string, PathChain>();
  const attached = new Map<string, PathChain[]>();
  for (const [c, cl] of claims) {
    if (cl.kind === "source") bySlot.set(slot(cl.src), c);
    else if (cl.kind === "attach") {
      // The first piece takes the branch's place, the others follow it.
      const k = slot(cl.src);
      if (!bySlot.has(k) && !claimed.has(cl.src)) { bySlot.set(k, c); claimed.add(cl.src); }
      else attached.set(k, [...(attached.get(k) ?? []), c]);
    }
  }
  const viewed = new Set(sources.map(slot));

  const changedHexes = (c: PathChain, s: ChainSource | undefined) => !s || !same(s.hexes, c.hexes);
  const sourceOf = (c: PathChain): ChainSource | undefined => {
    const cl = claims.get(c);
    return cl && cl.kind === "source" ? cl.src : undefined;
  };

  const names = paths.map((p) => p.name);
  const out: { path: MapPath; branches: OutBranch[] }[] = [];
  const newPaths: { path: MapPath; branches: OutBranch[] }[] = [];
  const forget = (p: MapPath, b: PathBranch, hexes: HexKey[]) => {
    const d: RemovedBranch = { path: p.name, typeName: p.typeName, branch: cloneBranch(b), hexes: [...hexes] };
    if (p.notes !== undefined) d.notes = p.notes;
    if (p.extra) d.extra = { ...p.extra };
    removed.push(d);
  };

  paths.forEach((p, i) => {
    const branches: OutBranch[] = [];
    let hadView = false;
    p.branches.forEach((b, j) => {
      const k = `${i}:${j}`;
      if (viewed.has(k)) hadView = true;
      const c = bySlot.get(k);
      if (c) {
        const src = sourceOf(c);
        branches.push({
          branch: changedHexes(c, src) ? { ...cloneBranch(b), anchors: anchorsOf(c.typeName, [...c.hexes]) } : cloneBranch(b),
          chain: c,
        });
      } else if (viewed.has(k)) {
        const src = sources.find((s) => slot(s) === k);
        forget(p, b, src?.hexes ?? b.anchors);
      } else {
        branches.push({ branch: cloneBranch(b) }); // never handed out (no hexes yet): keep
      }
      for (const extraChain of attached.get(k) ?? []) {
        branches.push({ branch: { anchors: anchorsOf(extraChain.typeName, [...extraChain.hexes]) }, chain: extraChain });
      }
    });
    if (hadView && !branches.length) return; // every branch was removed: the path goes
    const path: MapPath = { ...p, branches: [] };
    if (p.extra) path.extra = { ...p.extra };
    // A type changed on the chains: the path follows when all of them agree,
    // else the branches of another type become a path of that type.
    const types = new Set(branches.filter((b) => b.chain).map((b) => b.chain!.typeName));
    if (types.size === 1 && !types.has(p.typeName) && branches.every((b) => b.chain)) path.typeName = [...types][0];
    const keep: OutBranch[] = [];
    const moved = new Map<string, OutBranch[]>();
    for (const b of branches) {
      const t = b.chain?.typeName;
      if (t === undefined || t === path.typeName) keep.push(b);
      else moved.set(t, [...(moved.get(t) ?? []), b]);
    }
    if (keep.length || !hadView) out.push({ path, branches: keep });
    for (const [t, bs] of moved) {
      const name = uniquePathName(t, names);
      names.push(name);
      newPaths.push({ path: { name, typeName: t, branches: [] }, branches: bs });
    }
  });

  // Restored and new chains, in chain order.
  for (const c of live) {
    const cl = claims.get(c)!;
    if (cl.kind === "restore") {
      const d = cl.dead;
      const host = [...out, ...newPaths].find((o) => o.path.name === d.path && o.path.typeName === d.typeName);
      const ob: OutBranch = { branch: cloneBranch(d.branch), chain: c };
      if (host) host.branches.push(ob);
      else {
        const name = names.includes(d.path) && out.some((o) => o.path.name === d.path) ? uniquePathName(d.path, names) : d.path;
        if (!names.includes(name)) names.push(name);
        const path: MapPath = { name, typeName: d.typeName, branches: [] };
        if (d.notes !== undefined) path.notes = d.notes;
        if (d.extra) path.extra = { ...d.extra };
        newPaths.push({ path, branches: [ob] });
      }
    } else if (cl.kind === "new") {
      const name = uniquePathName(c.typeName, names);
      names.push(name);
      newPaths.push({ path: { name, typeName: c.typeName, branches: [] }, branches: [{ branch: { anchors: anchorsOf(c.typeName, [...c.hexes]) }, chain: c }] });
    }
  }
  const restoredDead = new Set(usedDead);
  const keptRemoved = removed.filter((d) => !restoredDead.has(d)).slice(-REMEMBER_REMOVED);

  const result: MapPath[] = [];
  const nextSources = new Map<PathChain, ChainSource>();
  for (const o of [...out, ...newPaths]) {
    const p: MapPath = { ...o.path, branches: o.branches.map((b) => b.branch) };
    result.push(p);
    o.branches.forEach((b, j) => {
      if (b.chain) nextSources.set(b.chain, { path: p.name, branch: j, typeName: b.chain.typeName, hexes: [...b.chain.hexes] });
    });
  }
  const changed = JSON.stringify(result) !== JSON.stringify(paths);
  return { paths: changed ? result : paths.map((p) => p), view: { sources: nextSources, removed: keptRemoved }, changed };
}
