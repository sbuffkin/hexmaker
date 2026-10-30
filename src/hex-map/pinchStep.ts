/**
 * Touch-gesture maths for the map, free of Obsidian imports (unit tests).
 * A pinch is a pair of fingers: its distance sets the zoom, its midpoint
 * drags the pan, so the map point under the fingers stays under them.
 */

/** Same limits as the wheel zoom (MapViewport.flushPendingZoom). */
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 5;

export interface PinchFrame {
  /** Distance between the two fingers, px. */
  dist: number;
  /** Midpoint, relative to the map's box. */
  mx: number;
  my: number;
}

export interface PanZoom {
  zoom: number;
  panX: number;
  panY: number;
}

interface Pt { x: number; y: number }

/** The frame of a finger pair; `origin` is the map box's top-left. */
export function pinchFrame(a: Pt, b: Pt, origin: { left: number; top: number }): PinchFrame {
  return {
    dist: Math.hypot(a.x - b.x, a.y - b.y),
    mx: (a.x + b.x) / 2 - origin.left,
    my: (a.y + b.y) / 2 - origin.top,
  };
}

/**
 * One pinch step: zoom by the change in finger distance (clamped like the
 * wheel zoom), keeping the point that was under the previous midpoint under
 * the new one. Fingers closer than 1px apart (or a stalled pair) just pan.
 */
export function pinchStep(prev: PinchFrame, cur: PinchFrame, s: PanZoom, min = MIN_ZOOM, max = MAX_ZOOM): PanZoom {
  const ratio = prev.dist >= 1 && cur.dist >= 1 ? cur.dist / prev.dist : 1;
  const zoom = Math.min(max, Math.max(min, s.zoom * ratio));
  const real = zoom / s.zoom;
  return {
    zoom,
    panX: cur.mx - (prev.mx - s.panX) * real,
    panY: cur.my - (prev.my - s.panY) * real,
  };
}

/** How far a finger may wander (px) before a press stops being a long-press / a tap. */
export const TOUCH_SLOP = 10;
/** Press-and-hold time that opens what right-click opens. */
export const LONG_PRESS_MS = 500;

export interface LongPressOptions {
  delayMs?: number;
  slop?: number;
  onFire(x: number, y: number): void;
  /** Injectable for tests. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

/**
 * Long-press detector: start() on finger down, move() on finger move
 * (wandering beyond the slop cancels), end()/cancel() on lift. Fires once.
 */
export class LongPress {
  private timer: unknown = null;
  private sx = 0;
  private sy = 0;
  private fired_ = false;
  private readonly delay: number;
  private readonly slop: number;
  private readonly setT: (fn: () => void, ms: number) => unknown;
  private readonly clearT: (id: unknown) => void;

  constructor(private readonly o: LongPressOptions) {
    this.delay = o.delayMs ?? LONG_PRESS_MS;
    this.slop = o.slop ?? TOUCH_SLOP;
    this.setT = o.setTimer ?? ((fn, ms) => window.setTimeout(fn, ms));
    this.clearT = o.clearTimer ?? ((id) => window.clearTimeout(id as number));
  }

  /** Did the last press fire (so the lift that follows must not also be a tap)? */
  get fired(): boolean { return this.fired_; }

  start(x: number, y: number): void {
    this.cancel();
    this.fired_ = false;
    this.sx = x;
    this.sy = y;
    this.timer = this.setT(() => {
      this.timer = null;
      this.fired_ = true;
      this.o.onFire(this.sx, this.sy);
    }, this.delay);
  }

  /** Returns true while the press is still a candidate. */
  move(x: number, y: number): boolean {
    if (this.timer === null) return false;
    if (Math.hypot(x - this.sx, y - this.sy) > this.slop) {
      this.cancel();
      return false;
    }
    return true;
  }

  cancel(): void {
    if (this.timer !== null) this.clearT(this.timer);
    this.timer = null;
  }

  end(): void {
    this.cancel();
  }
}
