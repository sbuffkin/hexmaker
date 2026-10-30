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

/** How long after a pane last scrolled a wheel step still counts as the
 *  same scroll gesture (so a grid sliding under the pointer mid-scroll
 *  doesn't steal it, and a grid being scrolled keeps the wheel). */
export const WHEEL_CONTINUE_MS = 400;

/** Can `box` scroll any further in the direction of `deltaY`? */
export function canScroll(box: ScrollBox, deltaY: number): boolean {
  const max = box.scrollHeight - box.clientHeight;
  if (max <= 1 || deltaY === 0) return false;
  return deltaY > 0 ? box.scrollTop < max - 1 : box.scrollTop > 0;
}

export interface WheelChainState {
  /** The nested grid under the pointer. */
  inner: ScrollBox;
  /** The modal's own scroll pane. */
  outer: ScrollBox;
  deltaY: number;
  msSinceOuterScroll: number;
  msSinceInnerScroll: number;
  /** The user clicked into the grid (or its filter) and hasn't left it:
   *  they are browsing it, so it owns the wheel. */
  innerEngaged: boolean;
}

/**
 * Which pane a wheel step over a nested grid should scroll.
 *
 * Outer first: round-3 testers parked the pointer over the big icon grids
 * (they fill most of the editor) and the first wheel scrolled the grid,
 * never the modal, so Notes/Linked notes stayed out of reach. The old rule
 * ("the grid scrolls until it hits its end") made every grid a wheel trap.
 * Now the modal scrolls unless the grid is clearly what the user means:
 *
 *  - the grid can't move that way → modal;
 *  - the modal can't move that way (scrolled to its end) → grid;
 *  - a gesture already in progress keeps its pane (whichever scrolled
 *    within `continueMs`, the most recent winning);
 *  - the user engaged the grid (clicked it) → grid;
 *  - otherwise → modal.
 */
export function wheelTarget(s: WheelChainState, continueMs = WHEEL_CONTINUE_MS): "inner" | "outer" | "none" {
  if (s.deltaY === 0) return "none";
  const innerCan = canScroll(s.inner, s.deltaY);
  const outerCan = canScroll(s.outer, s.deltaY);
  if (!innerCan) return outerCan ? "outer" : "none";
  if (!outerCan) return "inner";
  const innerRecent = s.msSinceInnerScroll < continueMs;
  const outerRecent = s.msSinceOuterScroll < continueMs;
  if (innerRecent && (!outerRecent || s.msSinceInnerScroll <= s.msSinceOuterScroll)) return "inner";
  if (outerRecent) return "outer";
  return s.innerEngaged ? "inner" : "outer";
}

/** Wheel delta in pixels (WheelEvent.deltaMode: 0 px, 1 lines, 2 pages). */
export function wheelDeltaPx(deltaY: number, deltaMode: number, pageHeight: number): number {
  if (deltaMode === 1) return deltaY * 16;
  if (deltaMode === 2) return deltaY * pageHeight;
  return deltaY;
}
