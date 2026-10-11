/**
 * The path tool (plan-path-anchors section 4): draw, select, continue,
 * fork, reshape by dragging, delete anchors, split, erase. A controller
 * the map view owns; it edits the map's anchored paths (MapData.paths)
 * with the pure ops in src/paths/edit.ts and saves through the map store
 * (mapStore.setPaths). Every edit goes through `commit`, which asks the
 * path edit gate (src/paths/editGate.ts) first.
 *
 * Hit-testing is pure math in lattice units: the pointer is turned into
 * lattice coordinates by the view (one read of the grid's box per event,
 * never per hex) and compared with the same polylines the map draws.
 *
 * The top part of this file is pure (tests/pathTool.test.ts).
 */

import { Notice } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { HexKey, MapPath } from "../types";
import { latticeCenter, type LatticeGrid, type PathStroke, type Pt } from "../paths/pathGeometry";
import type { ResolvedBranch } from "../paths/resolve";
import type { RouteCache } from "../paths/routeCache";
import {
  appendAnchor,
  clonePath,
  clonePaths,
  deleteAnchor,
  deleteBranch,
  forkAt,
  insertAnchorAt,
  moveAnchor,
  newPath,
  pathNameKey,
  reverseBranch,
  splitBranchAt,
} from "../paths/edit";
import { anchorsFor, routeFnFor } from "../paths/fromHexes";
import { canEditPaths, PATH_EDIT_LOCKED_HINT, type PathEditAction } from "../paths/editGate";
import { pathRouteText } from "../maps/mapNote";
import { pathRouteStats } from "../maps/MapStore";
import { impassableNames, noRouteMessage } from "../impassable";
import { hexNeighbors } from "./hexGeometry";
import { PathPickerModal } from "./PathPickerModal";
import { PathNameModal } from "./PathNameModal";

// ── Pure: hit-testing ────────────────────────────────────────────────────────

/** Anchor handle radius, lattice units (a hex's centre-to-corner is 1). */
export const HANDLE_R = 0.24;
/** End handles ("+": continue from here) are drawn a little bigger. */
export const END_HANDLE_R = 0.32;
/** Slack added to half the stroke width when hitting a line (lattice units). */
export const LINE_SLACK = 0.25;

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.cx - a.cx) * dx + (p.cy - a.cy) * dy) / len2)) : 0;
  return Math.hypot(p.cx - (a.cx + t * dx), p.cy - (a.cy + t * dy));
}

export function distToPolyline(p: Pt, pts: readonly Pt[]): number {
  if (!pts.length) return Infinity;
  if (pts.length === 1) return Math.hypot(p.cx - pts[0].cx, p.cy - pts[0].cy);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, distToSegment(p, pts[i - 1], pts[i]));
  return best;
}

/** Index of the hex of `hexes` whose centre is nearest `p` (ties: the lower index). */
export function nearestHexIdx(p: Pt, hexes: readonly HexKey[], grid: LatticeGrid): number {
  let best = -1;
  let bestD = Infinity;
  hexes.forEach((h, i) => {
    const c = latticeCenter(h, grid);
    const d = Math.hypot(p.cx - c.cx, p.cy - c.cy);
    if (d < bestD - 1e-9) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** Which end of its branch an anchor is: head (first, not a fork's start), tail (last), or neither. */
export function anchorEnd(rb: Pick<ResolvedBranch, "anchorIdx" | "forkFrom">, anchor: number): "head" | "tail" | null {
  const n = rb.anchorIdx.length;
  if (n > 1 && anchor === n - 1) return "tail";
  if (anchor === 0 && !rb.forkFrom) return n > 1 ? "head" : "tail";
  return null;
}

export interface PathHit {
  path: string;
  branch: number;
  /** The branch's routed hex nearest the pointer. */
  hexIdx: number;
  /** The anchor whose handle is under the pointer (selected path only), else null. */
  anchor: number | null;
  /** When `anchor` is a branch end. */
  end: "head" | "tail" | null;
}

/**
 * What's under lattice point `p`: an anchor handle of the selected path
 * first (the nearest within its radius), else the nearest path line within
 * half its stroke plus LINE_SLACK (the selected path wins where lines
 * overlap). Null when nothing is.
 */
export function hitTestPaths(
  p: Pt,
  strokes: readonly PathStroke[],
  resolved: readonly ResolvedBranch[],
  grid: LatticeGrid,
  selected: string | null,
): PathHit | null {
  if (selected !== null) {
    let best: PathHit | null = null;
    let bestD = Infinity;
    for (const rb of resolved) {
      if (rb.path !== selected) continue;
      rb.anchorIdx.forEach((hexIdx, a) => {
        const end = anchorEnd(rb, a);
        const c = latticeCenter(rb.hexes[hexIdx], grid);
        const d = Math.hypot(p.cx - c.cx, p.cy - c.cy);
        if (d <= (end ? END_HANDLE_R : HANDLE_R) && d < bestD - 1e-9) {
          bestD = d;
          best = { path: rb.path, branch: rb.branch, hexIdx, anchor: a, end };
        }
      });
    }
    if (best) return best;
  }
  let pick: PathStroke | null = null;
  let pickD = Infinity;
  let pickSel = false;
  for (const s of strokes) {
    const d = distToPolyline(p, s.pts);
    if (d > s.width / 2 + LINE_SLACK) continue;
    const sel = s.path === selected;
    if ((sel && !pickSel) || (sel === pickSel && d < pickD - 1e-9)) {
      pick = s;
      pickD = d;
      pickSel = sel;
    }
  }
  if (!pick) return null;
  const rb = resolved.find((r) => r.path === pick.path && r.branch === pick.branch);
  if (!rb) return null;
  return { path: rb.path, branch: rb.branch, hexIdx: nearestHexIdx(p, rb.hexes, grid), anchor: null, end: null };
}

// ── Pure: what a click does ──────────────────────────────────────────────────

export type PathClick =
  | { kind: "none" }
  /** Start a new path here (it's created by the next click). */
  | { kind: "start" }
  /** Add an anchor at the clicked hex, from the active end. */
  | { kind: "append" }
  /** The active end clicked again: finish the branch (the path stays selected). */
  | { kind: "finish" }
  | { kind: "select"; path: string }
  | { kind: "deselect" }
  /** Continue the selected path from this end. */
  | { kind: "continue"; path: string; branch: number; end: "head" | "tail" }
  /** Start a fork of the selected path at this hex of it. */
  | { kind: "fork"; path: string; branch: number; hexIdx: number }
  /** Erase mode: split the branch at this hex. */
  | { kind: "split"; path: string; branch: number; hexIdx: number };

export interface PathClickState {
  erasing: boolean;
  /** Alt held, or "New path" pressed: start a new path whatever is under the pointer. */
  forceNew: boolean;
  /** The hex clicks add to (an active end, or a path/fork just started), if any. */
  activeHex: HexKey | null;
  selected: string | null;
}

/**
 * The click table (replaces the old hex-by-hex pathClickOutcome):
 * erase splits; Alt / New path starts a new path; while drawing, every
 * click adds an anchor (the active end again finishes); on the selected
 * path an end continues it and anywhere else forks; another path is
 * selected; empty map deselects, or starts a path when nothing is selected.
 */
export function pathClickOutcome(s: PathClickState, key: HexKey, hit: PathHit | null): PathClick {
  if (s.erasing) return hit ? { kind: "split", path: hit.path, branch: hit.branch, hexIdx: hit.hexIdx } : { kind: "none" };
  if (s.forceNew) return { kind: "start" };
  if (s.activeHex !== null) return key === s.activeHex ? { kind: "finish" } : { kind: "append" };
  if (hit && hit.path === s.selected) {
    if (hit.end) return { kind: "continue", path: hit.path, branch: hit.branch, end: hit.end };
    return { kind: "fork", path: hit.path, branch: hit.branch, hexIdx: hit.hexIdx };
  }
  if (hit) return { kind: "select", path: hit.path };
  return s.selected !== null ? { kind: "deselect" } : { kind: "start" };
}

/** "Road, 2 forks" for the mode bar. */
export function pathSummary(p: MapPath): string {
  const forks = p.branches.length - 1;
  return forks ? `${p.typeName}, ${forks} fork${forks === 1 ? "" : "s"}` : p.typeName;
}

/** What the path items of the right-click menu do. */
export interface PathMenuActions {
  split: () => void;
  deleteBranch: () => void;
  deletePath: () => void;
  rename: () => void;
  changeType: () => void;
  reverse: () => void;
}

/**
 * The path's items in the right-click menu, in order (#48): Split here,
 * Delete this fork (or main line; only with forks), Delete path, Rename…,
 * Change type…, Reverse. The menu lists them above the tool's own items.
 */
export function pathMenuItems(p: MapPath, branch: number, act: PathMenuActions): { label: string; onClick: () => void }[] {
  const items = [{ label: "Split here", onClick: act.split }];
  if (p.branches.length > 1) items.push({ label: branch === 0 ? "Delete main line" : "Delete this fork", onClick: act.deleteBranch });
  items.push(
    { label: `Delete path: ${p.name}`, onClick: act.deletePath },
    { label: "Rename…", onClick: act.rename },
    { label: "Change type…", onClick: act.changeType },
    { label: "Reverse", onClick: act.reverse },
  );
  return items;
}

/**
 * "3, 4 → 9, 2 · 2 forks · 18 hexes": a path's ends, forks and size
 * (distinct routed hexes over every branch, from the resolved routes), so
 * paths with similar names (Road 2 … Road 6) can be told apart in "Paths
 * on this map" (#48). It's the map note's own Route cell (pathRouteText,
 * pathRouteStats), so the list and the note say the same thing, warnings
 * included. Before the routes are resolved the size is left out.
 */
export function pathListSummary(p: MapPath, resolved: readonly ResolvedBranch[], pathTypes?: string[]): string {
  const own = resolved.filter((r) => r.path === p.name);
  return pathRouteText(p, { pathRoutes: pathRouteStats([p], own), pathTypes });
}

// ── The controller ───────────────────────────────────────────────────────────

/** What the tool needs from the map view. */
export interface PathToolHost {
  plugin: HexmakerPlugin;
  mapName(): string;
  /** The pointer in lattice units, from one read of the grid's box (null before the path layer is calibrated). */
  pointerLattice(e: { clientX: number; clientY: number }): Pt | null;
  /** The hex under a screen point. */
  hexAtPoint(clientX: number, clientY: number): HexKey | null;
  /** The document listeners for a drag go on (the view's own window). */
  ownerDocument(): Document;
  /** Record one undo step. */
  pushUndo(mapName: string, before: MapPath[], after: MapPath[]): void;
  /** Redraw the path layer (and its handles). */
  redraw(): void;
  /** Refresh the mode bar. */
  refreshBar(): void;
  /** Show (or clear) the "grab" cursor over the selected path. */
  setGrabCursor(on: boolean): void;
}

/** A path or fork started by one click: it's created when the second anchor comes. */
type Pending = { kind: "new"; hex: HexKey } | { kind: "fork"; path: string; hex: HexKey };

interface Drag {
  path: string;
  branch: number;
  hit: PathHit;
  route: Pick<ResolvedBranch, "branch" | "hexes" | "anchorIdx">;
  before: MapPath[];
  startHex: HexKey;
  lastHex: HexKey;
  startX: number;
  startY: number;
  started: boolean;
  preview: MapPath[] | null;
  frame: number | null;
  cleanup: () => void;
}

/** The branch end a draw adds to: a path (by name), its branch, which end. */
interface DrawTarget {
  name: string;
  branch: number;
  end: "head" | "tail";
}

/** Hex-by-hex press-and-drag: every hex the pointer enters becomes an anchor; one commit on release. */
interface DrawDrag {
  /** What a click at the press would have done (start, append, finish or continue). */
  outcome: PathClick;
  pressHex: HexKey;
  lastHex: HexKey;
  startX: number;
  startY: number;
  started: boolean;
  /** The paths as drawn so far (shown as the preview; committed on release). */
  work: MapPath[] | null;
  target: DrawTarget | null;
  /** The branch's anchor count before the drag: only anchors past it can be stepped back over. */
  baseLen: number;
  /** Some entered hex couldn't be reached (impassable, off the map) and was skipped. */
  blocked: boolean;
  frame: number | null;
  cleanup: () => void;
}

/**
 * One anchor added to a branch end (pure): `leg` is what legAnchors gives
 * from the end to `key` (tail) or from `key` to the end (head), the new
 * anchor included last (tail) / the end included last (head).
 */
export function extendBranch(p: MapPath, branch: number, end: "head" | "tail", key: HexKey, leg: readonly HexKey[]): MapPath {
  if (end === "tail") return leg.reduce((q, k) => appendAnchor(q, branch, k), p);
  const q = clonePath(p);
  q.branches[branch].anchors = [key, ...leg.slice(0, -1), ...p.branches[branch].anchors];
  return q;
}

/**
 * Drag-drawing stepped back into the hex before the end: drop the end
 * anchor (pure). Only anchors the drag added (past `baseLen`) go; null
 * when `key` isn't that hex or the end wasn't added by this drag.
 */
export function stepBack(p: MapPath, branch: number, end: "head" | "tail", key: HexKey, baseLen: number): MapPath | null {
  const a = p.branches[branch]?.anchors;
  if (!a || a.length <= baseLen || a.length < 2) return null;
  const prev = end === "tail" ? a[a.length - 2] : a[1];
  if (prev !== key) return null;
  const q = clonePath(p);
  q.branches[branch].anchors = end === "tail" ? a.slice(0, -1) : a.slice(1);
  return q;
}

/** Decorations the path layer draws for the tool. */
export interface PathToolOverlay {
  /** The selected path (drawn highlighted). */
  selected: string | null;
  /** Anchor handles of the selected path. */
  handles: { hex: HexKey; end: boolean; hover: boolean }[];
  /** The hex clicks add to. */
  active: HexKey | null;
}

export class PathTool {
  /** The type for new paths. */
  typeName: string | null = null;
  autoRoute = false;
  /** Let the next routes go through impassable terrain (pinned with anchors, so it's kept). */
  crossImpassable = false;
  selected: string | null = null;
  /** Where clicks add anchors on the selected path. */
  active: { branch: number; end: "head" | "tail" } | null = null;
  private pending: Pending | null = null;
  /** "New path" was pressed: the next click starts one whatever is under it. */
  private forceNew = false;
  /** A short note for the mode bar about the last click. */
  hint: string | null = null;
  private hover: { branch: number; anchor: number } | null = null;
  private drag: Drag | null = null;
  private drawDrag: DrawDrag | null = null;
  private suppressClick = false;
  private strokeMemo: { resolved: readonly ResolvedBranch[]; strokes: PathStroke[] } | null = null;

  constructor(private host: PathToolHost) {}

  private get plugin(): HexmakerPlugin {
    return this.host.plugin;
  }

  private get map(): string {
    return this.host.mapName();
  }

  // ── reads ──

  /** The map's stored paths. */
  paths(): readonly MapPath[] {
    return this.plugin.mapStore.paths(this.map);
  }

  private pathNamed(name: string | null): MapPath | undefined {
    return name === null ? undefined : this.paths().find((p) => p.name === name);
  }

  private resolved(): ResolvedBranch[] {
    return this.plugin.paths.resolved(this.map);
  }

  private branchRoute(path: string, branch: number): ResolvedBranch | undefined {
    return this.resolved().find((r) => r.path === path && r.branch === branch);
  }

  private grid(): LatticeGrid | null {
    return this.plugin.paths.lattice(this.map);
  }

  private strokes(): PathStroke[] {
    const resolved = this.resolved();
    if (this.strokeMemo?.resolved !== resolved) this.strokeMemo = { resolved, strokes: this.plugin.paths.strokes(this.map) };
    return this.strokeMemo.strokes;
  }

  private hitAt(e: { clientX: number; clientY: number }): PathHit | null {
    const p = this.host.pointerLattice(e);
    const grid = this.grid();
    if (!p || !grid) return null;
    return hitTestPaths(p, this.strokes(), this.resolved(), grid, this.selected);
  }

  /** The hex clicks add to, if any. */
  activeHex(): HexKey | null {
    const t = this.drawDrag?.target;
    const work = this.drawDrag?.work;
    if (work && t) {
      const a = work.find((p) => p.name === t.name)?.branches[t.branch]?.anchors;
      if (a?.length) return t.end === "head" ? a[0] : a[a.length - 1];
    }
    if (this.pending) return this.pending.hex;
    const p = this.pathNamed(this.selected);
    if (!p || !this.active) return null;
    const a = p.branches[this.active.branch]?.anchors;
    if (!a?.length) return null;
    return this.active.end === "head" ? a[0] : a[a.length - 1];
  }

  /** Is a branch being drawn (an active end or a fresh start)? */
  isDrawing(): boolean {
    return this.activeHex() !== null;
  }

  /** The type of what's being drawn or edited: the selected path's, else the one picked for new paths. */
  currentType(): string | null {
    if (this.pending?.kind === "fork") return this.pathNamed(this.pending.path)?.typeName ?? this.typeName;
    if (this.pending?.kind === "new") return this.typeName;
    return this.pathNamed(this.selected)?.typeName ?? this.typeName;
  }

  /** For the mode bar label. */
  labelState(): { selected: string | null; summary: string | null; drawing: boolean; note: string | null; forceNew: boolean } {
    const p = this.pathNamed(this.selected);
    return {
      selected: p?.name ?? null,
      summary: p ? pathSummary(p) : null,
      drawing: this.isDrawing(),
      note: this.hint,
      forceNew: this.forceNew,
    };
  }

  overlay(): PathToolOverlay {
    const handles: PathToolOverlay["handles"] = [];
    if (this.selected !== null) {
      for (const rb of this.resolved()) {
        if (rb.path !== this.selected) continue;
        rb.anchorIdx.forEach((hexIdx, a) => {
          handles.push({
            hex: rb.hexes[hexIdx],
            end: anchorEnd(rb, a) !== null,
            hover: this.hover?.branch === rb.branch && this.hover.anchor === a,
          });
        });
      }
    }
    return { selected: this.selected, handles, active: this.activeHex() };
  }

  // ── the one place paths are written ──

  /**
   * THE choke point for the tool's path edits: asks the gate
   * (canEditPaths), saves through the map store, records one undo step.
   */
  private commit(next: MapPath[], action: PathEditAction = "draw"): boolean {
    const map = this.map;
    if (!canEditPaths(map, action)) {
      new Notice(PATH_EDIT_LOCKED_HINT);
      return false;
    }
    const before = clonePaths(this.paths());
    if (JSON.stringify(before) === JSON.stringify(next)) return false;
    // setPaths settles any pending routing-context change against the paths
    // as they were, so the new ones are never pinned to an out-of-date route.
    this.plugin.mapStore.setPaths(map, next);
    void this.plugin.saveSettings();
    if (action !== "history") this.host.pushUndo(map, before, clonePaths(next));
    this.strokeMemo = null;
    this.host.redraw();
    this.host.refreshBar();
    return true;
  }

  /** Undo / redo of a path step: restore a snapshot (through the gate). */
  applySnapshot(mapName: string, paths: MapPath[]): void {
    if (!canEditPaths(mapName, "history")) {
      new Notice(PATH_EDIT_LOCKED_HINT);
      return;
    }
    this.plugin.mapStore.setPaths(mapName, clonePaths(paths));
    void this.plugin.saveSettings();
    this.pending = null;
    this.active = null;
    this.hover = null;
    if (mapName === this.map && !this.pathNamed(this.selected)) this.selected = null;
    this.strokeMemo = null;
    this.host.redraw();
    this.host.refreshBar();
  }

  private replacePath(name: string, next: MapPath | null): MapPath[] {
    const out: MapPath[] = [];
    for (const p of this.paths()) {
      if (p.name !== name) out.push(clonePath(p));
      else if (next) out.push(next);
    }
    return out;
  }

  private ready(): boolean {
    if (this.plugin.paths.isReady(this.map)) return true;
    new Notice("This map's paths are still loading.");
    return false;
  }

  // ── tool state ──

  /** Leave the tool (or switch map): forget everything but the picked type and switches. */
  reset(): void {
    this.cancelDrag();
    this.cancelDrawDrag();
    this.selected = null;
    this.active = null;
    this.pending = null;
    this.forceNew = false;
    this.hint = null;
    this.hover = null;
    this.host.setGrabCursor(false);
  }

  /** Pick the type for new paths. A new type ends the branch being drawn. */
  setType(typeName: string): void {
    if (typeName !== this.typeName) {
      this.pending = null;
      this.active = null;
    }
    this.typeName = typeName;
  }

  setAutoRoute(on: boolean): void {
    this.autoRoute = on;
    this.hint = null;
    this.host.refreshBar();
  }

  /** Select a path by name (the picker's "Paths on this map"). */
  selectPath(name: string): void {
    const p = this.pathNamed(name);
    if (!p) return;
    // Picked from the list before any type: new paths take this one.
    if (!this.typeName) this.typeName = p.typeName;
    this.selected = p.name;
    this.active = null;
    this.pending = null;
    this.forceNew = false;
    this.hint = null;
    this.host.redraw();
    this.host.refreshBar();
  }

  /** "New path" (mode bar): the next click starts a new path, even on top of another. */
  startNewPath(): void {
    // No type picked yet (the tool was entered from "Paths on this map"):
    // the new path takes the selected one's.
    if (!this.typeName) this.typeName = this.currentType();
    this.selected = null;
    this.active = null;
    this.pending = null;
    this.forceNew = true;
    this.hint = null;
    this.host.redraw();
    this.host.refreshBar();
  }

  /** Finish the branch being drawn; with nothing being drawn, deselect. ("Done" in the mode bar.) */
  done(): void {
    if (this.isDrawing() || this.forceNew) {
      this.pending = null;
      this.active = null;
      this.forceNew = false;
    } else {
      this.selected = null;
    }
    this.hint = null;
    this.host.redraw();
    this.host.refreshBar();
  }

  /** Esc: cancel a drag, else finish the branch, else deselect. False when there was nothing to step out of. */
  escape(): boolean {
    if (this.drag) {
      this.cancelDrag();
      return true;
    }
    if (this.drawDrag) {
      this.cancelDrawDrag();
      return true;
    }
    if (this.isDrawing() || this.forceNew || this.selected !== null) {
      this.done();
      return true;
    }
    return false;
  }

  // ── clicks ──

  /** A left-click on hex (x, y). */
  click(x: number, y: number, e: { clientX: number; clientY: number; altKey?: boolean } | undefined, erasing: boolean): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    if (!this.ready()) return;
    const key = `${x}_${y}`;
    const forceNew = this.forceNew || !!e?.altKey;
    const activeHex = this.activeHex();
    const hit = e && (erasing || (!forceNew && activeHex === null)) ? this.hitAt(e) : null;
    const outcome = pathClickOutcome({ erasing, forceNew, activeHex, selected: this.selected }, key, hit);
    this.hint = null;
    switch (outcome.kind) {
      case "none":
        break;
      case "start":
        // No type picked yet: Alt-click beside a selected path takes its type.
        if (!this.typeName) this.typeName = this.currentType();
        if (!this.typeName) {
          new Notice("Pick a path type first: click the path button.");
          return;
        }
        this.forceNew = false;
        this.selected = null;
        this.active = null;
        this.pending = { kind: "new", hex: key };
        break;
      case "append":
        this.append(key);
        break;
      case "finish":
        this.pending = null;
        this.active = null;
        break;
      case "select":
        this.selected = outcome.path;
        this.active = null;
        break;
      case "deselect":
        this.selected = null;
        break;
      case "continue":
        this.selected = outcome.path;
        this.active = { branch: outcome.branch, end: outcome.end };
        break;
      case "fork": {
        const rb = this.branchRoute(outcome.path, outcome.branch);
        if (rb) this.pending = { kind: "fork", path: outcome.path, hex: rb.hexes[outcome.hexIdx] };
        break;
      }
      case "split":
        this.split(outcome.path, outcome.branch, outcome.hexIdx);
        break;
    }
    this.host.redraw();
    this.host.refreshBar();
  }

  /**
   * The anchors that take a branch from `from` to `to` (excluding `from`):
   * just [to] normally. With Cross impassable on, a route through
   * impassable terrain is pinned with whatever anchors make the normal
   * router reproduce it. Null (with a notice) when there's no route.
   */
  private legAnchors(from: HexKey, to: HexKey, typeName: string, quiet = false): HexKey[] | null {
    const router: RouteCache | null = this.plugin.paths.router(this.map);
    if (!router) return null;
    const say = (msg: string) => { if (!quiet) new Notice(msg); };
    const style = this.plugin.paths.styleOf(this.map, typeName);
    const seg = router.route(from, to, style);
    if (this.crossImpassable && style.avoid) {
      const through = router.route(from, to, { ...style, avoid: false });
      if (through.fallback) {
        say("Both ends must be on the map.");
        return null;
      }
      const same = !seg.fallback && seg.hexes.length === through.hexes.length && seg.hexes.every((k, i) => k === through.hexes[i]);
      if (same) return [to];
      return anchorsFor(through.hexes, routeFnFor(router, style), router.context ?? undefined).slice(1);
    }
    if (seg.fallback === "out-of-bounds") {
      say("Both ends must be on the map.");
      return null;
    }
    if (seg.fallback === "no-route") {
      say(noRouteMessage(style.avoid ? impassableNames(this.plugin.getMapPalette(this.map)) : []));
      return null;
    }
    return [to];
  }

  /** Hex-by-hex mode: say when a click wasn't next to the end (the router filled the gap). */
  private noteGap(from: HexKey, to: HexKey): void {
    if (this.autoRoute) return;
    const [x, y] = from.split("_").map(Number);
    const grid = this.grid();
    if (!grid) return;
    const near = hexNeighbors(x, y, grid.orientation, grid.stagger).some(([nx, ny]) => `${nx}_${ny}` === to);
    if (!near) this.hint = "not next to the end, so the gap was routed";
  }

  /**
   * Where the next anchor goes, as paths + a branch end: a started path or
   * fork is created here (with its one anchor) in a copy of the map's
   * paths; an active end is used as it is. Null when nothing is being drawn.
   */
  private drawTarget(): { paths: MapPath[]; target: DrawTarget } | null {
    const pending = this.pending;
    if (pending?.kind === "new") {
      const type = this.typeName;
      if (!type) return null;
      const p = newPath(type, pending.hex, this.paths().map((q) => q.name));
      return { paths: [...clonePaths(this.paths()), p], target: { name: p.name, branch: 0, end: "tail" } };
    }
    if (pending?.kind === "fork") {
      const base = this.pathNamed(pending.path);
      if (!base) return null;
      const { path, branch } = forkAt(base, pending.hex);
      return { paths: this.replacePath(base.name, path), target: { name: path.name, branch, end: "tail" } };
    }
    const p = this.pathNamed(this.selected);
    if (!p || !this.active || !p.branches[this.active.branch]) return null;
    return { paths: clonePaths(this.paths()), target: { name: p.name, ...this.active } };
  }

  /** `paths` with an anchor added at `key` on the target's end (routed from it); null when it can't be reached. */
  private extendTo(paths: readonly MapPath[], t: DrawTarget, key: HexKey, quiet = false): MapPath[] | null {
    const p = paths.find((q) => q.name === t.name);
    const anchors = p?.branches[t.branch]?.anchors;
    if (!p || !anchors?.length) return null;
    const endHex = t.end === "tail" ? anchors[anchors.length - 1] : anchors[0];
    if (endHex === key) return null;
    // The branch runs head → tail, so a head leg is routed key → head.
    const leg = t.end === "tail" ? this.legAnchors(endHex, key, p.typeName, quiet) : this.legAnchors(key, endHex, p.typeName, quiet);
    if (!leg) return null;
    const next = extendBranch(p, t.branch, t.end, key, leg);
    return paths.map((q) => (q === p ? next : q));
  }

  /** Add an anchor at `key` from the active end (creating a started path or fork). */
  private append(key: HexKey): void {
    const d = this.drawTarget();
    if (!d) {
      if (this.pending?.kind === "fork") this.pending = null;
      return;
    }
    const from = this.activeHex();
    const next = this.extendTo(d.paths, d.target, key);
    if (!next) return;
    if (from) this.noteGap(from, key);
    if (this.commit(next)) {
      this.pending = null;
      this.selected = d.target.name;
      this.active = { branch: d.target.branch, end: d.target.end };
    }
  }

  // ── edits on a path ──

  private routeFn(typeName: string) {
    const router = this.plugin.paths.router(this.map);
    if (!router) return null;
    return { fn: routeFnFor(router, this.plugin.paths.styleOf(this.map, typeName)), grid: router.context ?? undefined };
  }

  /** Split a branch at one of its routed hexes (the hex's two steps go; nothing else moves). */
  split(path: string, branch: number, hexIdx: number): void {
    const p = this.pathNamed(path);
    const rb = this.branchRoute(path, branch);
    const r = p && this.routeFn(p.typeName);
    if (!p || !rb || !r) return;
    const next = splitBranchAt(p, rb, hexIdx, r.fn, r.grid);
    this.afterPathEdit(p.name, next);
  }

  deleteBranch(path: string, branch: number): void {
    const p = this.pathNamed(path);
    if (!p) return;
    this.afterPathEdit(p.name, deleteBranch(p, branch));
  }

  deletePath(path: string): void {
    if (!this.pathNamed(path)) return;
    this.afterPathEdit(path, null);
  }

  deleteAnchor(path: string, branch: number, anchor: number): void {
    const p = this.pathNamed(path);
    if (!p) return;
    const next = deleteAnchor(p, branch, anchor);
    // The active end steps back with its anchor; a branch that went takes it along.
    this.afterPathEdit(p.name, next, (q) => {
      if (!q || q.branches.length < p.branches.length) this.active = null;
    });
  }

  reverse(path: string, branch: number): void {
    const p = this.pathNamed(path);
    const rb = this.branchRoute(path, branch);
    const r = p && this.routeFn(p.typeName);
    if (!p || !rb || !r) return;
    this.afterPathEdit(p.name, reverseBranch(p, rb, r.fn, r.grid));
  }

  rename(path: string): void {
    const p = this.pathNamed(path);
    if (!p) return;
    const others = this.paths().filter((q) => q.name !== p.name).map((q) => pathNameKey(q.name));
    new PathNameModal(this.plugin.app, p.name, (name) => (others.includes(pathNameKey(name)) ? `There's already a path called ${name} on this map.` : null), (name) => {
      const q = clonePath(p);
      q.name = name;
      if (this.commit(this.replacePath(p.name, q)) && this.selected === p.name) this.selected = name;
      this.host.refreshBar();
    }).open();
  }

  changeType(path: string): void {
    const p = this.pathNamed(path);
    if (!p) return;
    new PathPickerModal(this.plugin.app, this.plugin, this.plugin.mapPaletteName(this.map), p.typeName, (typeName) => {
      const cur = this.pathNamed(path);
      if (!cur || cur.typeName === typeName) return;
      const q = clonePath(cur);
      q.typeName = typeName;
      this.commit(this.replacePath(cur.name, q));
    }).open();
  }

  /** Commit one path's replacement (null removes it), keeping the tool state valid. */
  private afterPathEdit(name: string, next: MapPath | null, adjust?: (next: MapPath | null) => void): void {
    if (!this.commit(this.replacePath(name, next))) return;
    adjust?.(next);
    if (!next && this.selected === name) {
      this.selected = null;
      this.active = null;
    }
    if (next && this.active && this.active.branch >= next.branches.length) this.active = null;
    this.hover = null;
    this.hint = null;
    this.host.redraw();
    this.host.refreshBar();
  }

  /** Backspace / Delete: the hovered anchor, else the active end's anchor; cancels a fresh start. */
  deleteKey(): boolean {
    if (this.pending) {
      this.pending = null;
      this.host.redraw();
      this.host.refreshBar();
      return true;
    }
    const p = this.pathNamed(this.selected);
    if (!p) return false;
    if (this.hover) {
      const { branch, anchor } = this.hover;
      this.deleteAnchor(p.name, branch, anchor);
      return true;
    }
    if (this.active) {
      const a = p.branches[this.active.branch].anchors;
      this.deleteAnchor(p.name, this.active.branch, this.active.end === "head" ? 0 : a.length - 1);
      return true;
    }
    return false;
  }

  // ── right-click ──

  /**
   * Right-click in the path tool: on an anchor handle of the selected path
   * it deletes that anchor ("handled"); on a path it selects it and returns
   * the path's menu items; elsewhere null (the usual tool menu).
   */
  contextMenu(e: { clientX: number; clientY: number }): { handled: true } | { items: { label: string; onClick: () => void }[] } | null {
    if (!this.plugin.paths.isReady(this.map)) return null;
    const hit = this.hitAt(e);
    if (!hit) return null;
    if (hit.path === this.selected && hit.anchor !== null) {
      this.deleteAnchor(hit.path, hit.branch, hit.anchor);
      return { handled: true };
    }
    if (this.selected !== hit.path) {
      this.selected = hit.path;
      this.active = null;
      this.pending = null;
      this.host.redraw();
      this.host.refreshBar();
    }
    const p = this.pathNamed(hit.path);
    if (!p) return null;
    const { path, branch, hexIdx } = hit;
    return {
      items: pathMenuItems(p, branch, {
        split: () => this.split(path, branch, hexIdx),
        deleteBranch: () => this.deleteBranch(path, branch),
        deletePath: () => this.deletePath(path),
        rename: () => this.rename(path),
        changeType: () => this.changeType(path),
        reverse: () => this.reverse(path, branch),
      }),
    };
  }

  // ── pointer: hover and drag ──

  /** Pointer moved (no button): hover an anchor handle, show "grab" over the selected path. */
  pointerMove(e: { clientX: number; clientY: number }): void {
    if (this.drag || this.drawDrag || this.selected === null || this.isDrawing()) {
      if (this.hover) { this.hover = null; this.host.redraw(); }
      this.host.setGrabCursor(false);
      return;
    }
    const hit = this.hitAt(e);
    const over = hit && hit.path === this.selected ? hit : null;
    const hover = over && over.anchor !== null ? { branch: over.branch, anchor: over.anchor } : null;
    const changed = (hover?.branch ?? -1) !== (this.hover?.branch ?? -1) || (hover?.anchor ?? -1) !== (this.hover?.anchor ?? -1);
    this.hover = hover;
    this.host.setGrabCursor(!!over);
    if (changed) this.host.redraw();
  }

  /**
   * Left button down. Hex by hex: where a click would draw (start a path,
   * add to the active end, or continue from an end handle), get ready to
   * drag-draw. Otherwise, on the selected path (not while drawing, erasing
   * or with Alt), get ready to drag it into a new shape. Returns true when
   * it took the press (and stops the browser's own image drag, so a press
   * on a hex icon works too).
   */
  pointerDown(e: MouseEvent, erasing: boolean): boolean {
    if (e.button !== 0 || erasing) return false;
    if (!this.plugin.paths.isReady(this.map)) return false;
    if (!this.autoRoute && this.beginDrawDrag(e)) {
      e.preventDefault();
      return true;
    }
    if (e.altKey || this.forceNew || this.isDrawing() || this.selected === null) return false;
    const hit = this.hitAt(e);
    if (!hit || hit.path !== this.selected) return false;
    const rb = this.branchRoute(hit.path, hit.branch);
    if (!rb) return false;
    const startHex = rb.hexes[hit.anchor !== null ? rb.anchorIdx[hit.anchor] : hit.hexIdx];
    const doc = this.host.ownerDocument();
    const onMove = (ev: MouseEvent) => this.dragMove(ev);
    const onUp = () => this.dragEnd();
    doc.addEventListener("mousemove", onMove);
    doc.addEventListener("mouseup", onUp);
    this.drag = {
      path: hit.path,
      branch: hit.branch,
      hit,
      route: { branch: rb.branch, hexes: [...rb.hexes], anchorIdx: [...rb.anchorIdx] },
      before: clonePaths(this.paths()),
      startHex,
      lastHex: startHex,
      startX: e.clientX,
      startY: e.clientY,
      started: false,
      preview: null,
      frame: null,
      cleanup: () => {
        doc.removeEventListener("mousemove", onMove);
        doc.removeEventListener("mouseup", onUp);
      },
    };
    e.preventDefault();
    return true;
  }

  // ── hex-by-hex press-and-drag drawing ──

  /** Hex by hex: a press where a click would draw gets ready to drag-draw (nothing changes until the pointer leaves the hex). */
  private beginDrawDrag(e: MouseEvent): boolean {
    const key = this.host.hexAtPoint(e.clientX, e.clientY);
    if (!key) return false;
    const forceNew = this.forceNew || e.altKey;
    const activeHex = this.activeHex();
    const hit = !forceNew && activeHex === null ? this.hitAt(e) : null;
    const outcome = pathClickOutcome({ erasing: false, forceNew, activeHex, selected: this.selected }, key, hit);
    if (outcome.kind !== "start" && outcome.kind !== "append" && outcome.kind !== "finish" && outcome.kind !== "continue") return false;
    if (outcome.kind === "start" && !(this.typeName ?? this.currentType())) return false;
    if (!canEditPaths(this.map, "draw")) return false;
    const doc = this.host.ownerDocument();
    const onMove = (ev: MouseEvent) => this.drawDragMove(ev);
    const onUp = () => this.drawDragEnd();
    doc.addEventListener("mousemove", onMove);
    doc.addEventListener("mouseup", onUp);
    this.drawDrag = {
      outcome,
      pressHex: key,
      lastHex: key,
      startX: e.clientX,
      startY: e.clientY,
      started: false,
      work: null,
      target: null,
      baseLen: 0,
      blocked: false,
      frame: null,
      cleanup: () => {
        doc.removeEventListener("mousemove", onMove);
        doc.removeEventListener("mouseup", onUp);
      },
    };
    return true;
  }

  /**
   * The pointer left the pressed hex: do what the press would have done
   * as a click (start the path, continue from the end, add the pressed
   * hex), in a working copy. False when there's nothing to draw from.
   */
  private startDrawDrag(d: DrawDrag): boolean {
    const o = d.outcome;
    if (o.kind === "start") {
      if (!this.typeName) this.typeName = this.currentType();
      if (!this.typeName) return false;
      this.forceNew = false;
      this.selected = null;
      this.active = null;
      this.pending = { kind: "new", hex: d.pressHex };
    } else if (o.kind === "continue") {
      this.selected = o.path;
      this.active = { branch: o.branch, end: o.end };
      this.pending = null;
    }
    this.hint = null;
    const t = this.drawTarget();
    if (!t) return false;
    const len = (paths: readonly MapPath[]) => paths.find((p) => p.name === t.target.name)?.branches[t.target.branch]?.anchors.length ?? 0;
    d.baseLen = this.pending?.kind === "new" ? 0 : len(t.paths);
    d.target = t.target;
    d.work = t.paths;
    // A press away from the active end adds that hex first, as a click would.
    if (o.kind === "append") {
      const next = this.extendTo(d.work, d.target, d.pressHex, true);
      if (next) d.work = next;
      else d.blocked = true;
    }
    return true;
  }

  /** One hex entered: it becomes an anchor (or, stepping back into the hex before the end, the end goes). */
  private drawStep(d: DrawDrag, key: HexKey): void {
    const t = d.target;
    if (!t || !d.work) return;
    const p = d.work.find((q) => q.name === t.name);
    if (!p) return;
    const back = stepBack(p, t.branch, t.end, key, d.baseLen);
    if (back) {
      d.work = d.work.map((q) => (q === p ? back : q));
      return;
    }
    const next = this.extendTo(d.work, t, key, true);
    if (next) d.work = next;
    else d.blocked = true;
  }

  private drawDragMove(e: MouseEvent): void {
    const d = this.drawDrag;
    if (!d) return;
    if (!d.started && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) <= 4) return;
    const hex = this.host.hexAtPoint(e.clientX, e.clientY);
    if (!hex || hex === d.lastHex) return;
    if (!d.started) {
      d.started = true;
      if (!this.startDrawDrag(d)) {
        this.cancelDrawDrag();
        return;
      }
      // The bar says "drawing" from the first hex, not only after release.
      this.host.refreshBar();
    }
    d.lastHex = hex;
    // Every hex is taken now (none skipped); the preview redraws once per frame.
    this.drawStep(d, hex);
    if (d.frame === null) {
      d.frame = window.requestAnimationFrame(() => {
        d.frame = null;
        if (this.drawDrag === d) this.showDrawPreview(d);
      });
    }
  }

  private showDrawPreview(d: DrawDrag): void {
    this.plugin.paths.setPreview(this.map, d.work);
    this.strokeMemo = null;
    this.host.redraw();
  }

  /** Release: the whole drag is one commit (one undo step). */
  private drawDragEnd(): void {
    const d = this.drawDrag;
    if (!d) return;
    d.cleanup();
    if (d.frame !== null) window.cancelAnimationFrame(d.frame);
    this.drawDrag = null;
    if (!d.started) return; // a click: the click handler takes it
    this.suppressClick = true;
    window.setTimeout(() => { this.suppressClick = false; }, 0);
    this.plugin.paths.setPreview(this.map, null);
    this.strokeMemo = null;
    const t = d.target;
    if (t && d.work && this.commit(d.work)) {
      this.pending = null;
      this.selected = t.name;
      this.active = { branch: t.branch, end: t.end };
    }
    this.hint = d.blocked ? "some hexes couldn't be reached and were skipped" : null;
    this.host.redraw();
    this.host.refreshBar();
  }

  private cancelDrawDrag(): void {
    const d = this.drawDrag;
    if (!d) return;
    d.cleanup();
    if (d.frame !== null) window.cancelAnimationFrame(d.frame);
    this.drawDrag = null;
    if (d.started) {
      this.suppressClick = true;
      window.setTimeout(() => { this.suppressClick = false; }, 0);
    }
    this.plugin.paths.setPreview(this.map, null);
    this.strokeMemo = null;
    this.host.redraw();
    this.host.refreshBar();
  }

  private dragMove(e: MouseEvent): void {
    const d = this.drag;
    if (!d) return;
    if (!d.started && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) <= 4) return;
    d.started = true;
    const hex = this.host.hexAtPoint(e.clientX, e.clientY);
    if (!hex || hex === d.lastHex) return;
    d.lastHex = hex;
    // One reroute per animation frame, only when the pointer enters a new hex.
    if (d.frame === null) {
      d.frame = window.requestAnimationFrame(() => {
        d.frame = null;
        if (this.drag === d) this.updatePreview(d);
      });
    }
  }

  /** The dragged anchor (inserted into its segment if the drag began on the line) moved to the hex under the pointer. */
  private updatePreview(d: Drag): void {
    const base = d.before.find((p) => p.name === d.path);
    if (!base) return;
    let p = base;
    let anchor = d.hit.anchor;
    if (anchor === null) {
      const ins = insertAnchorAt(base, d.route, d.hit.hexIdx);
      p = ins.path;
      anchor = ins.anchor;
    }
    const moved = moveAnchor(p, d.branch, anchor, d.lastHex);
    d.preview = d.before.map((q) => (q.name === d.path ? moved : q));
    this.plugin.paths.setPreview(this.map, d.preview);
    this.strokeMemo = null;
    this.host.redraw();
  }

  private dragEnd(): void {
    const d = this.drag;
    if (!d) return;
    d.cleanup();
    if (d.frame !== null) window.cancelAnimationFrame(d.frame);
    this.drag = null;
    if (!d.started) return; // a click: the click handler takes it
    // The click that ends a drag isn't a click on the map.
    this.suppressClick = true;
    window.setTimeout(() => { this.suppressClick = false; }, 0);
    if (d.lastHex !== d.startHex) this.updatePreview(d);
    this.plugin.paths.setPreview(this.map, null);
    this.strokeMemo = null;
    // Dropped back where it started: nothing changes.
    if (d.lastHex !== d.startHex && d.preview) this.commit(d.preview);
    else this.host.redraw();
  }

  private cancelDrag(): void {
    const d = this.drag;
    if (!d) return;
    d.cleanup();
    if (d.frame !== null) window.cancelAnimationFrame(d.frame);
    this.drag = null;
    this.plugin.paths.setPreview(this.map, null);
    this.strokeMemo = null;
    this.host.redraw();
  }

  /** Is a drag under way (its click must not count)? */
  isDragging(): boolean {
    return !!this.drag?.started || !!this.drawDrag?.started;
  }

  // ── mode bar controls ──

  /** Draw-mode switch, Cross impassable, the selected path's name (rename), New path, Done. */
  renderBarControls(el: HTMLElement): void {
    const auto = el.createEl("button", {
      cls: "duckmage-mode-bar-route-toggle",
      text: "Auto-route",
      attr: {
        "aria-pressed": String(this.autoRoute),
        title: this.autoRoute
          ? "On: click far away and the path finds its way there. Click to draw hex by hex."
          : "Off: drawing hex by hex (a click away from the end is routed too). Click to auto-route.",
      },
    });
    auto.toggleClass("is-active", this.autoRoute);
    auto.addEventListener("click", () => this.setAutoRoute(!this.autoRoute));

    const type = this.currentType();
    const avoids = type ? this.plugin.paths.styleOf(this.map, type).avoid : true;
    if (avoids) {
      const blocked = impassableNames(this.plugin.getMapPalette(this.map));
      if (!blocked.length) {
        if (this.autoRoute) {
          el.createSpan({
            cls: "duckmage-mode-bar-route-note",
            text: "No impassable terrain",
            attr: { title: "Nothing in this map's palette is impassable, so routes go straight through anything. Mark terrains (e.g. water) impassable in the palette editor or the terrain editor." },
          });
        }
      } else {
        const label = el.createEl("label", {
          cls: "duckmage-mode-bar-route-cross",
          attr: { title: `Let new legs go through ${blocked.join(", ")} (anchors are added so the line stays put)` },
        });
        const box = label.createEl("input", { type: "checkbox" });
        box.checked = this.crossImpassable;
        box.addEventListener("change", () => { this.crossImpassable = box.checked; });
        label.createSpan({ text: "Cross impassable" });
      }
    }

    const p = this.pathNamed(this.selected);
    if (p) {
      const chip = el.createEl("button", {
        cls: "duckmage-mode-bar-route-toggle duckmage-mode-bar-path-name",
        text: p.name,
        attr: { title: "Rename this path" },
      });
      chip.addEventListener("click", () => this.rename(p.name));
    }
    const fresh = el.createEl("button", {
      cls: "duckmage-mode-bar-route-toggle",
      text: "New path",
      attr: { title: "Start a new path with the next click, even on top of another path. Holding alt while clicking does the same." },
    });
    fresh.toggleClass("is-active", this.forceNew);
    fresh.addEventListener("click", () => this.startNewPath());
    if (p || this.isDrawing() || this.forceNew) {
      const done = el.createEl("button", {
        cls: "duckmage-mode-bar-route-toggle",
        text: "Done",
        attr: { title: this.isDrawing() ? "Finish this branch (Esc)" : "Deselect the path (Esc)" },
      });
      done.addEventListener("click", () => this.done());
    }
  }
}
