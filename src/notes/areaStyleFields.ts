/**
 * The frontmatter keys of a painted area note's colour and overlay style
 * (faction notes: `faction-*`, area notes: `region-*`), read from and
 * written to an already-fetched frontmatter object. Pure (no obsidian):
 * tests/fixtures/pureFiles.json. The vault side is notes/areaStyle.ts.
 */
import type { Frontmatter } from "./frontmatterText";
import {
  type OverlayPatternKey,
  DEFAULT_OVERLAY_PATTERN_KEY,
  DEFAULT_OVERLAY_PATTERN_SCALE,
  DEFAULT_OVERLAY_PATTERN_OPACITY,
  DEFAULT_OVERLAY_OUTLINE_WIDTH,
  normalizeOverlayPatternKey,
  normalizeOverlayPatternScale,
  normalizeOverlayPatternOpacity,
  normalizeOverlayOutlineWidth,
} from "../overlayPatterns";

export interface OverlayStyle {
  pattern: OverlayPatternKey;
  scale: number;
  opacity: number;
  outlineWidth: number;
}

/** Which kind of area note: its frontmatter keys start with `<kind>-`. */
export type AreaKind = "faction" | "region";

/** A frontmatter object as read (cache) or as being written (processFrontMatter). */
type FmRecord = Frontmatter | Record<string, unknown>;

export function areaColorFromFm(kind: AreaKind, fm: FmRecord | null | undefined): string | null {
  const color = fm?.[`${kind}-color`];
  return typeof color === "string" ? color : null;
}

export function areaStyleFromFm(kind: AreaKind, fm: FmRecord | null | undefined): OverlayStyle {
  return {
    pattern: normalizeOverlayPatternKey(fm?.[`${kind}-pattern`]),
    scale: normalizeOverlayPatternScale(fm?.[`${kind}-pattern-scale`]),
    opacity: normalizeOverlayPatternOpacity(fm?.[`${kind}-pattern-opacity`]),
    outlineWidth: normalizeOverlayOutlineWidth(fm?.[`${kind}-outline-width`]),
  };
}

/** Set (or, for null, remove) the colour key in `fm`. */
export function writeAreaColor(fm: Record<string, unknown>, kind: AreaKind, color: string | null): void {
  if (color === null) delete fm[`${kind}-color`];
  else fm[`${kind}-color`] = color;
}

/** Write the given style fields to `fm`; a default value removes its key. */
export function writeAreaStyle(fm: Record<string, unknown>, kind: AreaKind, style: Partial<OverlayStyle>): void {
  if (style.pattern !== undefined) {
    if (style.pattern === DEFAULT_OVERLAY_PATTERN_KEY) delete fm[`${kind}-pattern`];
    else fm[`${kind}-pattern`] = style.pattern;
  }
  if (style.scale !== undefined) {
    if (style.scale === DEFAULT_OVERLAY_PATTERN_SCALE) delete fm[`${kind}-pattern-scale`];
    else fm[`${kind}-pattern-scale`] = String(style.scale);
  }
  if (style.opacity !== undefined) {
    if (style.opacity === DEFAULT_OVERLAY_PATTERN_OPACITY) delete fm[`${kind}-pattern-opacity`];
    else fm[`${kind}-pattern-opacity`] = String(style.opacity);
  }
  if (style.outlineWidth !== undefined) {
    if (style.outlineWidth === DEFAULT_OVERLAY_OUTLINE_WIDTH) delete fm[`${kind}-outline-width`];
    else fm[`${kind}-outline-width`] = String(style.outlineWidth);
  }
}
