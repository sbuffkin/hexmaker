/**
 * Phase 7 (Decision 3): keep a route where it was when its routing inputs
 * change, and offer "Reroute instead".
 *
 * Routing inputs are the map's context (terrain shown as impassable, the
 * palette's impassable flags, the map's bounds, the stagger) and each path
 * type's explicit routing fields (avoidImpassable, autoRoute). When one of
 * them would move a segment, `pinChanged` adds just enough anchors that the
 * segment keeps its old hexes, and a notice says so with a "Reroute
 * instead" button that drops those anchors again.
 *
 * Hooks:
 * - context changes come from MapStore.onRouteContextChange (terrain painted
 *   or imported, and any change MapStore sees when it next routes the map).
 *   This class TAKES OVER the store's own silent pin (returns true): it
 *   pins the same way and also knows what it added, for the notice;
 * - palette flags, resizes and type style edits are caught before the next
 *   draw: PathsService calls `sync(map)` whenever the map's context
 *   signature or its types' styles differ from its last resolve. `sync`
 *   asks MapStore to route under the current context (which fires the
 *   context hook above when it changed) and compares the types' styles with
 *   the last ones it saw.
 *
 * Every write goes through the path edit gate (editGate.ts).
 */

import { Notice } from "obsidian";
import type { HexKey, MapData, MapPath } from "../types";
import type { SegmentStyle } from "./router";
import type { RouteCache } from "./routeCache";
import type { StyleFor } from "./resolve";
import { clonePath, pinChanged, segmentFn } from "./edit";
import { canEditPaths } from "./editGate";
import type { RouteContextChange } from "../maps/MapStore";

/** What the pins need of the map store. */
export interface PinStore {
  isReady(map?: string): boolean;
  paths(name: string): readonly MapPath[];
  setPaths(name: string, paths: MapPath[]): void;
  routeCache(map: MapData): RouteCache;
  pathStyleFor(map: MapData): StyleFor;
  onRouteContextChange(fn: (e: RouteContextChange) => boolean | void): () => void;
}

export interface PinHost {
  getMap(name: string): MapData | undefined;
  mapStore: PinStore;
  /** Persist settings (maps whose paths still live in data.json). */
  saveSettings?(): Promise<void>;
}

/** One map's pin: the pinned paths as they were before, and how many anchors each gained. */
export interface PinRecord {
  map: string;
  before: MapPath[];
  added: { path: string; added: number }[];
}

/** Is `sub` a subsequence of `seq`? */
function isSubsequence(sub: readonly HexKey[], seq: readonly HexKey[]): boolean {
  let i = 0;
  for (const k of seq) if (i < sub.length && k === sub[i]) i++;
  return i === sub.length;
}

/**
 * `current` with the anchors a pin added taken out again: each branch whose
 * anchors before the pin are still all there, in order, goes back to them.
 * Anything else (a branch edited since in other ways, a branch added or
 * removed) is left as it is now.
 */
export function dropAddedAnchors(current: MapPath, before: MapPath): MapPath {
  if (current.branches.length !== before.branches.length) return current;
  let changed = false;
  const out = clonePath(current);
  out.branches.forEach((b, i) => {
    const old = before.branches[i].anchors;
    if (old.length < b.anchors.length && isSubsequence(old, b.anchors)) {
      b.anchors = [...old];
      changed = true;
    }
  });
  return changed ? out : current;
}

/** The styles of a map's types as a plain snapshot (type name → style). */
function styleSnapshot(paths: readonly MapPath[], styleFor: StyleFor): Map<string, SegmentStyle | undefined> {
  const out = new Map<string, SegmentStyle | undefined>();
  for (const p of paths) if (!out.has(p.typeName)) out.set(p.typeName, styleFor(p.typeName));
  return out;
}

const sameStyle = (a: SegmentStyle | undefined, b: SegmentStyle | undefined) =>
  (!a && !b) || (!!a && !!b && a.avoid === b.avoid && a.winding === b.winding);

/** How long pins are collected into one notice (a palette change pins many maps at once). */
const BATCH_MS = 60;

export class RoutePins {
  private styles = new Map<string, Map<string, SegmentStyle | undefined>>();
  private batch: PinRecord[] = [];
  private batchTimer: number | undefined;
  private listeners = new Set<(r: PinRecord) => void>();
  private off: (() => void) | null = null;

  constructor(private host: PinHost) {}

  /** Start listening to the store's context changes. */
  attach(): void {
    this.off?.();
    this.off = this.host.mapStore.onRouteContextChange((e) => this.onContextChange(e));
  }

  detach(): void {
    this.off?.();
    this.off = null;
    if (this.batchTimer !== undefined) window.clearTimeout(this.batchTimer);
    this.batchTimer = undefined;
  }

  /** Hear about each pin (the map view folds a pin into the undo step that caused it). */
  onPinned(fn: (r: PinRecord) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The store saw a context change: pin with a notice. Always handled here. */
  onContextChange(e: RouteContextChange): boolean {
    if (!canEditPaths(e.map, "pin")) return true; // not allowed: the route moves
    const paths = this.host.mapStore.paths(e.map);
    if (!paths.length) return true;
    const r = pinChanged(paths, segmentFn(e.previous, e.styleFor), segmentFn(e.current, e.styleFor), e.after);
    if (r.pinned.length) this.apply(e.map, paths, r.paths, r.pinned);
    return true;
  }

  /**
   * Before a map's paths are drawn after its routing inputs changed: route
   * it under the current context (the store then reports a context change
   * to onContextChange), and pin against any type whose routing style
   * changed since the last look.
   */
  sync(mapName: string): void {
    const map = this.host.getMap(mapName);
    const store = this.host.mapStore;
    if (!map || !store.isReady(mapName)) return;
    const cache = store.routeCache(map);
    if (!map.paths) return;
    const paths = store.paths(mapName);
    const styleFor = store.pathStyleFor(map);
    const now = styleSnapshot(paths, styleFor);
    const prev = this.styles.get(mapName);
    this.styles.set(mapName, now);
    if (!prev || !paths.length || !cache.context) return;
    const changed = [...now].some(([t, s]) => prev.has(t) && !sameStyle(prev.get(t), s));
    if (!changed || !canEditPaths(mapName, "pin")) return;
    const oldStyleFor: StyleFor = (t) => (prev.has(t) ? prev.get(t) : styleFor(t));
    const r = pinChanged(paths, segmentFn(cache, oldStyleFor), segmentFn(cache, styleFor), cache.context);
    if (r.pinned.length) this.apply(mapName, paths, r.paths, r.pinned);
  }

  /** Forget what was seen for a map (deleted or renamed). */
  forget(mapName: string): void {
    this.styles.delete(mapName);
  }

  private apply(mapName: string, before: readonly MapPath[], after: MapPath[], added: { path: string; added: number }[]): void {
    const names = new Set(added.map((a) => a.path));
    const rec: PinRecord = { map: mapName, before: before.filter((p) => names.has(p.name)).map(clonePath), added };
    this.host.mapStore.setPaths(mapName, after);
    void this.host.saveSettings?.();
    for (const fn of this.listeners) {
      try { fn(rec); } catch (e) { console.error("Hexmaker: pin listener failed", e); }
    }
    this.batch.push(rec);
    if (this.batchTimer === undefined) this.batchTimer = window.setTimeout(() => this.showNotice(), BATCH_MS);
  }

  /** The pending pins, shown as one notice now (tests call this directly). */
  flushNotice(): PinRecord[] {
    if (this.batchTimer !== undefined) window.clearTimeout(this.batchTimer);
    this.batchTimer = undefined;
    const recs = this.batch;
    this.batch = [];
    return recs;
  }

  private showNotice(): void {
    const recs = this.flushNotice();
    if (!recs.length) return;
    const msg = pinNoticeText(recs);
    const notice = new Notice(msg, 15000);
    const el = (notice as unknown as { noticeEl?: HTMLElement }).noticeEl;
    if (el) {
      const btn = el.createEl("button", { text: "Reroute instead", cls: "duckmage-notice-btn" });
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.rerouteInstead(recs);
        notice.hide();
      });
    }
  }

  /** "Reroute instead": take the pinned anchors out again (only those still there). */
  rerouteInstead(recs: readonly PinRecord[]): void {
    const byMap = new Map<string, PinRecord[]>();
    for (const r of recs) byMap.set(r.map, [...(byMap.get(r.map) ?? []), r]);
    for (const [mapName, rs] of byMap) {
      if (!this.host.getMap(mapName) || !canEditPaths(mapName, "reroute")) continue;
      const current = this.host.mapStore.paths(mapName);
      let changed = false;
      const next = current.map((p) => {
        let q = p;
        for (const r of rs) {
          const b = r.before.find((x) => x.name === p.name);
          if (b) q = dropAddedAnchors(q, b);
        }
        if (q !== p) changed = true;
        return q;
      });
      if (changed) this.host.mapStore.setPaths(mapName, next);
    }
    void this.host.saveSettings?.();
  }
}

/** "Kept the route of King's Road, Glass River (3 anchors added)." */
export function pinNoticeText(recs: readonly PinRecord[]): string {
  const names: string[] = [];
  let added = 0;
  for (const r of recs) {
    for (const a of r.added) {
      if (!names.includes(a.path)) names.push(a.path);
      added += a.added;
    }
  }
  const shown = names.length > 4 ? `${names.slice(0, 4).join(", ")} and ${names.length - 4} more` : names.join(", ");
  const maps = new Set(recs.map((r) => r.map)).size;
  return `Kept the route of ${shown}${maps > 1 ? ` on ${maps} maps` : ""} (${added} anchor${added === 1 ? "" : "s"} added).`;
}

