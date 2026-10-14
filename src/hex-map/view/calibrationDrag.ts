/**
 * Calibration drag helpers (L2a, split out of HexMapView): a drag's
 * mousemove coalesced to one per frame, and the eight resize handles around
 * the bg image layer or the grid.
 */

export interface DragMove {
  onMove: (ev: MouseEvent) => void;
  stop: () => void;
}

/**
 * Coalesce a drag's mousemove to at most once per animation frame (latest
 * event wins) so calibration drag/resize don't issue redundant CSS-var
 * writes — and the style recalcs they trigger — several times per painted
 * frame. `stop()` flushes the final position and cancels any pending frame;
 * call it from mouseup so the release lands exactly under the cursor.
 *
 * `begin` runs first (swap the hex cells for the colour snapshot) and `end`
 * runs on stop, after the final move (swap them back).
 *
 * When `window.DUCKMAGE_PERF` is truthy it records, for the drag's lifetime:
 * mousemove count, frames run, mean synchronous work() time per frame, and
 * the median inter-frame gap — logged on stop(). A cheap work() paired with a
 * large frame gap means the drag is paint/composite-bound (the scene, not our
 * JS) — the expected signature when resizing over a big background image.
 */
export function coalesceDragMove(
  label: string,
  work: (ev: MouseEvent) => void,
  begin: () => void,
  end: () => void,
): DragMove {
  // Swap the 3843 hex cells for a single-canvas colour snapshot for the
  // drag's duration: build the snapshot, then add the class that hides the
  // real cells. Transforming one canvas per frame is a single composite op vs
  // re-rasterising every cell (a translate alone measured ~373ms/frame).
  begin();
  let latest: MouseEvent | null = null;
  let frameId: number | null = null;
  const perf = !!(window as unknown as { DUCKMAGE_PERF?: unknown })
    .DUCKMAGE_PERF;
  let moves = 0,
    frames = 0,
    workMs = 0,
    lastTickAt = 0;
  const gaps: number[] = [];
  const run = (ev: MouseEvent) => {
    if (!perf) {
      work(ev);
      return;
    }
    const now = performance.now();
    if (lastTickAt) gaps.push(now - lastTickAt);
    lastTickAt = now;
    work(ev);
    workMs += performance.now() - now;
    frames++;
  };
  const tick = () => {
    frameId = null;
    if (latest) {
      run(latest);
      latest = null;
    }
  };
  return {
    onMove: (ev: MouseEvent) => {
      if (perf) moves++;
      latest = ev;
      if (frameId === null) frameId = window.requestAnimationFrame(tick);
    },
    stop: () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        frameId = null;
      }
      if (latest) {
        run(latest);
        latest = null;
      }
      end();
      if (perf) {
        const sorted = gaps.slice().sort((a, b) => a - b);
        const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
        console.warn(
          `[duckmage perf] ${label}: moves=${moves} frames=${frames} ` +
            `workMs/frame=${(workMs / Math.max(1, frames)).toFixed(2)} ` +
            `medianFrameGapMs=${med.toFixed(1)}`,
        );
      }
    },
  };
}

export interface ResizeOpts {
  aspectLocked: boolean;
  getStartTransform: () => { tx: number; ty: number; sx: number; sy: number };
  onResize: (next: { tx: number; ty: number; sx: number; sy: number }) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

/**
 * Add 8 resize handles (4 corners + 4 edges) to a positioned element.
 * `onResize` is called with the scale factor change (x and y, possibly 1)
 * relative to the start of the drag — caller multiplies its current scale
 * by the factor and re-applies its transform.
 *
 * If `aspectLocked`, edge handles are disabled and corner drags constrain
 * factor.x = factor.y (using whichever axis the cursor moved further on).
 *
 * Caller must use `transform-origin: 0 0` so the anchor math below works.
 *
 * Standard direct-manipulation rule: the side the user grabs moves with
 * the cursor; the **opposite** side stays fixed in screen space. We
 * achieve that by adjusting `translate` alongside `scale` on every
 * mousemove. See `topics/design/notes/resize-handle-anchor-rule` for the
 * derivation. The math (anchor at object-local (ax, ay)):
 *
 *   tx_new = tx_old + ax * (sx_old - sx_new)
 *   ty_new = ty_old + ay * (sy_old - sy_new)
 *
 * `zoom` reads the viewport's CSS scale at drag start; `coalesce` wraps the
 * per-frame move (coalesceDragMove with the caller's snapshot hooks).
 */
export function attachResizeHandles(
  el: HTMLElement,
  opts: ResizeOpts,
  zoom: () => number,
  coalesce: (label: string, work: (ev: MouseEvent) => void) => DragMove,
): void {
  type Handle =
    | "nw" | "n" | "ne"
    | "w"        | "e"
    | "sw" | "s" | "se";
  const handles: Handle[] = opts.aspectLocked
    ? ["nw", "ne", "sw", "se"]
    : ["nw", "n", "ne", "w", "e", "sw", "s", "se"];

  for (const h of handles) {
    const handle = el.createDiv({
      cls: `duckmage-calibration-handle duckmage-calibration-handle-${h}`,
    });
    handle.addEventListener("mousedown", (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      opts.onDragStart?.();

      const rect = el.getBoundingClientRect();
      const start = opts.getStartTransform();
      const viewportZoom = zoom(); // CSS scale on the viewport wrapper
      // Pre-transform dimensions (W0, H0): rect is post-everything, so undo
      // both the element's own scale AND the viewport zoom to recover.
      const W0 = rect.width / (start.sx * viewportZoom);
      const H0 = rect.height / (start.sy * viewportZoom);

      // Object-local anchor: the corner opposite the grabbed handle, in
      // pre-transform pixel space (W0 / H0).
      const ax = h.includes("e") ? 0 : h.includes("w") ? W0 : W0 / 2;
      const ay = h.includes("s") ? 0 : h.includes("n") ? H0 : H0 / 2;

      const startX = e.clientX, startY = e.clientY;
      const { onMove, stop } = coalesce(`resize-${h}`, (ev) => {
        // Cursor delta in screen pixels → pre-transform pixels (undo viewport zoom)
        const dx = (ev.clientX - startX) / viewportZoom;
        const dy = (ev.clientY - startY) / viewportZoom;

        // New scale: only the dimension matching the grabbed axis changes.
        // Edge handles leave the perpendicular scale untouched.
        let sxNew = start.sx, syNew = start.sy;
        if (h.includes("e")) sxNew = Math.max(0.05, (W0 * start.sx + dx) / W0);
        if (h.includes("w")) sxNew = Math.max(0.05, (W0 * start.sx - dx) / W0);
        if (h.includes("s")) syNew = Math.max(0.05, (H0 * start.sy + dy) / H0);
        if (h.includes("n")) syNew = Math.max(0.05, (H0 * start.sy - dy) / H0);
        if (opts.aspectLocked) {
          const fx = sxNew / start.sx;
          const fy = syNew / start.sy;
          const dom = Math.abs(fx - 1) > Math.abs(fy - 1) ? fx : fy;
          sxNew = start.sx * dom;
          syNew = start.sy * dom;
        }

        // Translate adjustment to keep the anchor pinned in screen space.
        const txNew = start.tx + ax * (start.sx - sxNew);
        const tyNew = start.ty + ay * (start.sy - syNew);

        opts.onResize({ tx: txNew, ty: tyNew, sx: sxNew, sy: syNew });
      });
      const onUp = () => {
        activeDocument.removeEventListener("mousemove", onMove);
        activeDocument.removeEventListener("mouseup", onUp);
        stop();
        opts.onDragEnd?.();
      };
      activeDocument.addEventListener("mousemove", onMove);
      activeDocument.addEventListener("mouseup", onUp);
    });
  }
}
