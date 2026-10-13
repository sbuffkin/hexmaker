/**
 * Number inputs you can drag up/down or scroll over to change (like a DCC
 * "scrubber"). A plain click still focuses the input for typing.
 */

export interface ScrubOptions {
  min: number;
  max: number;
  step?: number;
  /** Pixels of drag per step. */
  pxPerStep?: number;
  /** Value to start from when the field is blank (e.g. a shown "auto" value). */
  initial?: () => number;
}

/** Value after dragging `dy` pixels (negative = up = bigger) from `start`. */
export function scrubValue(start: number, dy: number, { min, max, step = 1, pxPerStep = 6 }: ScrubOptions): number {
  const v = start + Math.round(-dy / pxPerStep) * step;
  return Math.max(min, Math.min(max, v));
}

/** Value after one wheel notch: scrolling up adds a step, down takes one away. */
export function wheelValue(start: number, deltaY: number, { min, max, step = 1 }: ScrubOptions): number {
  if (deltaY === 0) return start;
  return Math.max(min, Math.min(max, start + (deltaY < 0 ? step : -step)));
}

/** Movement before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD = 3;
/** Quiet time after the last wheel notch before "change" fires (one save per burst). */
const WHEEL_SETTLE_MS = 350;

/**
 * Make `input` scrubbable by dragging and by the mouse wheel while hovered.
 * Fires "input" on every step and "change" when the drag (or a burst of
 * wheel notches) ends, the same events typing would fire.
 */
export function makeScrubbable(input: HTMLInputElement, opts: ScrubOptions): void {
  input.addClass("duckmage-scrub");
  input.setAttr("title", "Drag up/down or scroll to change, or click to type");
  const current = () => (input.value === "" && opts.initial ? opts.initial() : Number(input.value) || 0);
  const set = (v: number) => {
    const next = String(v);
    if (next === input.value) return false;
    input.value = next;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  };

  let startY = 0;
  let startValue = 0;
  let dragging = false;
  let pressed = false;

  input.addEventListener("pointerdown", (e: PointerEvent) => {
    if (e.button !== 0 || input.ownerDocument.activeElement === input) return;
    pressed = true;
    dragging = false;
    startY = e.clientY;
    startValue = current();
    try {
      input.setPointerCapture(e.pointerId);
    } catch {
      // Not an active pointer (e.g. a synthetic event); dragging still works inside the input.
    }
    // Don't focus yet: a drag shouldn't leave a text cursor behind.
    e.preventDefault();
  });
  input.addEventListener("pointermove", (e: PointerEvent) => {
    if (!pressed) return;
    const dy = e.clientY - startY;
    if (!dragging && Math.abs(dy) < DRAG_THRESHOLD) return;
    dragging = true;
    input.addClass("is-scrubbing");
    set(scrubValue(startValue, dy, opts));
  });
  const end = (e: PointerEvent) => {
    if (!pressed) return;
    pressed = false;
    if (input.hasPointerCapture(e.pointerId)) input.releasePointerCapture(e.pointerId);
    input.removeClass("is-scrubbing");
    if (dragging) input.dispatchEvent(new Event("change", { bubbles: true }));
    else {
      input.focus();
      input.select();
    }
  };
  input.addEventListener("pointerup", end);
  input.addEventListener("pointercancel", end);

  // Wheel over the field: one step per notch. The page doesn't scroll while
  // the pointer is on the field; everywhere else it scrolls as usual.
  let settle: number | null = null;
  input.addEventListener(
    "wheel",
    (e: WheelEvent) => {
      e.preventDefault();
      input.addClass("is-scrubbing");
      set(wheelValue(current(), e.deltaY, opts));
      const win = input.ownerDocument.defaultView ?? activeWindow;
      if (settle !== null) win.clearTimeout(settle);
      settle = win.setTimeout(() => {
        settle = null;
        input.removeClass("is-scrubbing");
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, WHEEL_SETTLE_MS);
    },
    { passive: false },
  );
}
