/**
 * Hex fields worked out when a hex gets terrain (plan-custom-hex-fields
 * phase 1). MapStore.set / setMany call fillFields on every hex they
 * write; the fields service binds the filler (ports.ts). A hex that gets
 * terrain (it had none) has its blank fields worked out in the same write,
 * so they share that write's work-mode gate (exploring's fills are
 * `discover`, painting is Build) and its undo. A write that brings its own
 * `extra` (undo, redo, an edit of the fields) is left as it is.
 *
 * Pure: no Obsidian imports.
 */
import type { HexData } from "./mapNote";

export type FieldFiller = (map: string, key: string, h: HexData) => Record<string, string> | undefined;

let filler: FieldFiller | null = null;

/** Bound by ports.ts (bindPorts) to the plugin's FieldsService. */
export function setFieldFiller(fn: FieldFiller | null): void {
  filler = fn;
}

/** `h` (the hex as it will be written) given its worked-out fields when it just got terrain. */
export function fillFields(map: string, key: string, before: HexData | undefined, h: HexData, patch: object): void {
  if (!filler || "extra" in patch || !h.terrain || before?.terrain) return;
  const extra = filler(map, key, h);
  if (extra && Object.keys(extra).length) h.extra = extra;
  else if (extra) delete h.extra;
}
