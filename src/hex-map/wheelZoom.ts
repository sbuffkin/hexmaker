/**
 * Wheel → map zoom maths, kept free of Obsidian imports for unit tests.
 * HexMapView sums these log-zoom steps per animation frame.
 */

/** Log-zoom per pixel of wheel travel. A mouse notch (~100px) zooms
 *  ~1.16×; it was 0.0028 (~1.32× a notch), which round-3 testers found
 *  jumped "from tiny to large" in a notch or two. */
export const ZOOM_PER_PX = 0.0015;

/** Most wheel travel one event may count. Fast flicks and some drivers send
 *  a single event worth several notches; uncapped, one event could zoom 5×. */
export const MAX_ZOOM_PX_PER_EVENT = 100;

const PX_PER_LINE = 33;
const PX_PER_PAGE = 400;

/** Log-zoom change for one wheel event (positive = zoom in). */
export function wheelZoomLog(deltaY: number, deltaMode: number): number {
  const px = deltaMode === 1 ? deltaY * PX_PER_LINE : deltaMode === 2 ? deltaY * PX_PER_PAGE : deltaY;
  const capped = Math.max(-MAX_ZOOM_PX_PER_EVENT, Math.min(MAX_ZOOM_PX_PER_EVENT, px));
  return capped === 0 ? 0 : -capped * ZOOM_PER_PX;
}

/**
 * Should a wheel event that reached the map view zoom the map? Only when it
 * is over the map itself: never while a modal is open (the wheel belongs to
 * the modal), and not over the view's own panels and menus (they scroll).
 */
export function wheelZoomsMap(overMap: boolean, modalOpen: boolean): boolean {
  return overMap && !modalOpen;
}
