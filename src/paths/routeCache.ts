/**
 * Segment route cache for one map. Routes are keyed `a>b|style` under the
 * map's current context signature (router version, orientation, stagger,
 * bounds, blocked hexes). A context change drops the segments but keeps
 * them as the "previous" routes, which the pin check (edit.ts pinChanged)
 * compares against so an unrelated edit never silently moves a path.
 * Pure, no Obsidian imports.
 */

import type { HexKey } from "../types";
import {
  contextSignature,
  routeSegment,
  type RouteContext,
  type SegmentRoute,
  type SegmentStyle,
} from "./router";

/** Anything that can route a segment under some fixed context. */
export interface SegmentRouter {
  route(a: HexKey, b: HexKey, style: SegmentStyle): SegmentRoute;
}

/** The cache key of a segment: its ends (direction matters) and the style flags. */
export function segmentKey(a: HexKey, b: HexKey, style: SegmentStyle): string {
  return `${a}>${b}|${style.avoid ? "a" : "-"}${style.winding ? "w" : "-"}`;
}

/** An uncached router for a context. */
export function contextRouter(ctx: RouteContext): SegmentRouter {
  return { route: (a, b, style) => routeSegment(a, b, { ...ctx, ...style }) };
}

/** Past this many segments the cache starts over (a long drag on a big map). */
const MAX_SEGMENTS = 50_000;

interface Generation {
  ctx: RouteContext;
  sig: string;
  segs: Map<string, SegmentRoute>;
}

function cachedRoute(gen: Generation, a: HexKey, b: HexKey, style: SegmentStyle): SegmentRoute {
  const k = segmentKey(a, b, style);
  let r = gen.segs.get(k);
  if (!r) {
    r = routeSegment(a, b, { ...gen.ctx, ...style });
    if (gen.segs.size >= MAX_SEGMENTS) gen.segs.clear();
    gen.segs.set(k, r);
  }
  return r;
}

/**
 * Routes are returned by reference: callers must not mutate them (resolve
 * copies what it keeps).
 */
export class RouteCache implements SegmentRouter {
  private cur: Generation | null = null;
  private prev: Generation | null = null;

  constructor(ctx?: RouteContext) {
    if (ctx) this.setContext(ctx);
  }

  /** The current context's signature ("" before the first setContext). */
  get signature(): string {
    return this.cur?.sig ?? "";
  }

  get context(): RouteContext | null {
    return this.cur?.ctx ?? null;
  }

  /** Cached segments under the current context. */
  get size(): number {
    return this.cur?.segs.size ?? 0;
  }

  /**
   * Switch to `ctx`. When its signature differs from the current one, the
   * cached segments become the previous generation and the cache starts
   * empty; returns true. Same signature: keeps everything (the new ctx
   * object is adopted), returns false.
   */
  setContext(ctx: RouteContext): boolean {
    const sig = contextSignature(ctx);
    if (this.cur && this.cur.sig === sig) {
      this.cur.ctx = ctx;
      return false;
    }
    if (this.cur) this.prev = this.cur;
    this.cur = { ctx, sig, segs: new Map() };
    return true;
  }

  route(a: HexKey, b: HexKey, style: SegmentStyle): SegmentRoute {
    if (!this.cur) throw new Error("RouteCache: no context set");
    return cachedRoute(this.cur, a, b, style);
  }

  /**
   * A router for the context before the last change (its cached segments,
   * computing any it lacks), or null when there was none.
   */
  previous(): SegmentRouter | null {
    const prev = this.prev;
    if (!prev) return null;
    return { route: (a, b, style) => cachedRoute(prev, a, b, style) };
  }

  /** Forget the previous generation (after the pin check has run). */
  dropPrevious(): void {
    this.prev = null;
  }

  clear(): void {
    this.cur = null;
    this.prev = null;
  }
}
