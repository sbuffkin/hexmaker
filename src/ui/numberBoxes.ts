/**
 * Number boxes beside sliders (UI consistency Q13): ONE switch decides
 * where a slider gets a typed number box next to it.
 *
 * Owner 2026-10-13 picked "only on Debug tuning rows", with the note
 * "could be shown only on debug in general for slider rows?". Adopted
 * pending confirmation (worksheet r2): a box beside EVERY slider, shown
 * only in debug mode. To switch to the alternative, change the one line
 * `NUMBER_BOX_RULE` below to "debug-tuning-only".
 *
 * Every slider asks through `numberBoxShown(kind)` (LabeledSlider does it
 * itself), so no surface decides on its own.
 */

export type NumberBoxRule =
  /** Debug mode on: a box beside every single-value slider. Off: none. */
  | "debug-every-slider"
  /** Debug mode on: a box only on Debug tuning rows. Off: none. */
  | "debug-tuning-only";

/** THE switch (the owner's call on worksheet r2). */
export const NUMBER_BOX_RULE: NumberBoxRule = "debug-every-slider";

/** What kind of slider asks: an ordinary one, or a Debug tuning row. */
export type SliderKind = "slider" | "tuning";

/** Whether a slider of `kind` gets a number box, under `rule`, with debug mode on or off. Pure. */
export function showNumberBox(rule: NumberBoxRule, kind: SliderKind, debug: boolean): boolean {
  if (!debug) return false;
  return rule === "debug-every-slider" || kind === "tuning";
}

/** Is debug mode on? Set by the plugin on load (isDebugMode over its app); off until then (tests). */
let debugNow: () => boolean = () => false;

/** The plugin tells the sliders how to read debug mode (src/ui/debugMode.ts). */
export function setNumberBoxDebug(fn: () => boolean): void {
  debugNow = fn;
}

/** Whether a slider of `kind` shows its number box now. */
export function numberBoxShown(kind: SliderKind = "slider"): boolean {
  return showNumberBox(NUMBER_BOX_RULE, kind, debugNow());
}
