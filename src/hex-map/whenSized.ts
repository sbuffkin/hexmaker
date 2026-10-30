/**
 * Run work that measures the hex grid only once the grid has a layout size.
 *
 * A map that renders while its tab isn't laid out (plugin reload with the
 * map in a background tab) reads 0 for every offsetWidth/offsetLeft, so
 * coordinate labels, hex names, link badges and overlays computed then all
 * land at 0,0 (or get culled) until the next full redraw. This runs `draw`
 * right away when the element has a size, else once a ResizeObserver sees
 * it get one. One layout read; callers keep their own read-then-write
 * batching inside `draw`.
 */

/** Minimal element shape (so tests can pass a stub). */
export interface SizedElement {
  readonly offsetWidth: number;
  readonly offsetHeight: number;
  readonly ownerDocument: { defaultView: { ResizeObserver: typeof ResizeObserver } | null } | Document;
}

export function hasLayoutSize(el: Pick<SizedElement, "offsetWidth" | "offsetHeight">): boolean {
  return el.offsetWidth > 0 && el.offsetHeight > 0;
}

/**
 * Call `draw` now if `el` is laid out, else on its first non-zero size.
 * Returns a cancel function (no-op once `draw` has run).
 */
export function whenSized(el: SizedElement, draw: () => void): () => void {
  if (hasLayoutSize(el)) {
    draw();
    return () => {};
  }
  const win = (el.ownerDocument as { defaultView: { ResizeObserver: typeof ResizeObserver } | null }).defaultView;
  if (!win?.ResizeObserver) {
    // No observer to wait with: draw anyway rather than never.
    draw();
    return () => {};
  }
  let done = false;
  const observer = new win.ResizeObserver(() => {
    if (done || !hasLayoutSize(el)) return;
    done = true;
    observer.disconnect();
    draw();
  });
  observer.observe(el as unknown as Element);
  return () => {
    done = true;
    observer.disconnect();
  };
}
