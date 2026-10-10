/**
 * Pure decision logic for nested scroll areas inside a scrolling modal
 * (the hex editor's terrain and icon grids). Kept free of Obsidian imports
 * so it's unit-testable; HexmakerModal.chainWheelToModal wires it up.
 */

export interface ScrollBox {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** How long after the outer pane last scrolled a wheel step still counts as
 *  the same scroll gesture (so a grid sliding under the pointer mid-scroll
 *  doesn't steal it). */
export const WHEEL_CONTINUE_MS = 400;

/**
 * Should a wheel step of `deltaY` over the inner scroll area `inner` scroll
 * the outer pane instead?
 *
 * Yes when the user is mid-way through scrolling the outer pane
 * (`msSinceOuterScroll` < `continueMs`), when the inner area can't scroll at
 * all, or when it is already at its end in the wheel's direction (Chromium
 * "latches" a wheel gesture to the inner area, so without this the modal
 * wouldn't move until the user paused and started a new gesture).
 */
export function wheelGoesToOuter(
  inner: ScrollBox,
  deltaY: number,
  msSinceOuterScroll: number,
  continueMs = WHEEL_CONTINUE_MS,
): boolean {
  if (deltaY === 0) return false;
  if (msSinceOuterScroll < continueMs) return true;
  const max = inner.scrollHeight - inner.clientHeight;
  if (max <= 1) return true;
  if (deltaY > 0) return inner.scrollTop >= max - 1;
  return inner.scrollTop <= 0;
}

/** Wheel delta in pixels (WheelEvent.deltaMode: 0 px, 1 lines, 2 pages). */
export function wheelDeltaPx(deltaY: number, deltaMode: number, pageHeight: number): number {
  if (deltaMode === 1) return deltaY * 16;
  if (deltaMode === 2) return deltaY * pageHeight;
  return deltaY;
}
