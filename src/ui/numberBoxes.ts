/**
 * Number boxes beside sliders (UI consistency Q13, owner confirmed on
 * worksheet r2): every slider gets a typed number box beside it, shown only
 * while debug mode is on. LabeledSlider asks here, so no surface decides on
 * its own.
 */

/** Is debug mode on? Set by the plugin on load (isDebugMode over its app); off until then (tests). */
let debugNow: () => boolean = () => false;

/** The plugin tells the sliders how to read debug mode (src/ui/debugMode.ts). */
export function setNumberBoxDebug(fn: () => boolean): void {
  debugNow = fn;
}

/** Whether a slider shows its number box now: only in debug mode. */
export function numberBoxShown(): boolean {
  return debugNow();
}
