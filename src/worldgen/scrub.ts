/**
 * Drag up or down on a number input to change it (like a DCC "scrubber").
 * A plain click still focuses the input for typing.
 */

export interface ScrubOptions {
  min: number;
  max: number;
  step?: number;
  /** Pixels of drag per step. */
  pxPerStep?: number;
}

/** Value after dragging `dy` pixels (negative = up = bigger) from `start`. */
export function scrubValue(start: number, dy: number, { min, max, step = 1, pxPerStep = 6 }: ScrubOptions): number {
  const v = start + Math.round(-dy / pxPerStep) * step;
  return Math.max(min, Math.min(max, v));
}

/** Movement before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD = 3;

/**
 * Make `input` scrubbable. Fires "input" on every step and "change" when the
 * drag ends, the same events typing would fire.
 */
export function makeScrubbable(input: HTMLInputElement, opts: ScrubOptions): void {
  input.addClass("duckmage-scrub");
  input.setAttr("title", "Drag up or down to change, or click to type");
  let startY = 0;
  let startValue = 0;
  let dragging = false;
  let pressed = false;

  input.addEventListener("pointerdown", (e: PointerEvent) => {
    if (e.button !== 0 || input.ownerDocument.activeElement === input) return;
    pressed = true;
    dragging = false;
    startY = e.clientY;
    startValue = Number(input.value) || 0;
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
    const next = String(scrubValue(startValue, dy, opts));
    if (next !== input.value) {
      input.value = next;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
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
}
