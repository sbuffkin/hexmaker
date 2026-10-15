/**
 * How hex coordinate labels look, on the map and in the PNG export. Round 4:
 * labels were unreadable on light terrain (white text on white ice, pale
 * yellow hills) and tiny and grey in the PNG. Labels now get a halo in the
 * colour opposite to the text (dark halo behind light text and vice versa),
 * and the PNG follows the coordinate settings (colour, font, size,
 * placement) with a minimum readable size. Pure, so it's unit-testable.
 */

export type CoordFontFamily = "interface" | "monospace" | "serif";
export type CoordPlacement = "top" | "middle" | "bottom";

/** The default coordinate font size setting (em). */
export const DEFAULT_COORD_FONT_SIZE = 0.8;
/** Smallest coordinate label the PNG export draws, in pixels. */
export const MIN_PNG_COORD_PX = 12;

/** [r, g, b] (0-255) for "#rgb", "#rrggbb", "#rrggbbaa" or "rgb(a)(…)". */
export function parseColor(color: string): [number, number, number] | null {
  const c = color.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4})$/.exec(c);
  if (m) {
    const [r, g, b] = m[1].split("").map((h) => parseInt(h + h, 16));
    return [r, g, b];
  }
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(c);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(c);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Halo behind a coordinate label: dark for light text, light for dark
 *  text, so the label reads on any terrain. Unparseable colours get the
 *  dark halo (the default label colour is white). */
export function coordHaloColor(textColor: string): string {
  const rgb = parseColor(textColor);
  const light = rgb ? relativeLuminance(rgb) > 0.35 : true;
  return light ? "rgba(0, 0, 0, 0.85)" : "rgba(255, 255, 255, 0.9)";
}

/** PNG label size: scales with the hex and the coordinate size setting,
 *  capped at 0.6R so it fits the hex, but never below MIN_PNG_COORD_PX
 *  (the old 11 px grey labels were too small to read). */
export function pngCoordFontPx(hexRadius: number, coordFontSize = DEFAULT_COORD_FONT_SIZE): number {
  const scale = coordFontSize > 0 ? coordFontSize / DEFAULT_COORD_FONT_SIZE : 1;
  const px = Math.round(hexRadius * 0.3 * scale);
  return Math.max(MIN_PNG_COORD_PX, Math.min(px, Math.round(hexRadius * 0.6)));
}

/** Canvas font family for the coordinate font setting. */
export function pngCoordFontFamily(family: CoordFontFamily | undefined): string {
  if (family === "monospace") return "monospace";
  if (family === "serif") return 'Georgia, Cambria, "Times New Roman", serif';
  return "sans-serif";
}

/** Vertical centre of the label (textBaseline "middle") inside a hex of
 *  radius R centred at cy, by the coordinate placement setting. Stays
 *  inside both flat-top (±0.87R) and pointy-top (±R) hexes. */
export function pngCoordY(placement: CoordPlacement | undefined, cy: number, hexRadius: number): number {
  if (placement === "top") return cy - hexRadius * 0.55;
  if (placement === "middle") return cy;
  return cy + hexRadius * 0.58;
}
