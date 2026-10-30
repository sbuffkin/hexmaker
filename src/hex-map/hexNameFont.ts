/**
 * Font options for hex names on the map and in the PNG export (NM3): font
 * family, size and style, per map (map note keys `name-font`, `name-size`,
 * `name-style`) with a plugin-wide default. Values are plain words so the
 * map note stays readable; reading is forgiving (`Serif`, `120%`, `1.2`,
 * `bold italic`, `script` …), and anything unreadable falls back to the
 * default rather than breaking the map.
 *
 * No fonts are bundled: each family is a stack of fonts most systems have.
 */

export type HexNameFamily = "theme" | "serif" | "sans" | "handwritten";
export type HexNameSize = "small" | "medium" | "large" | "huge";
export type HexNameStyle = "bold" | "bold italic" | "regular" | "italic";

export const NAME_FAMILIES: { id: HexNameFamily; label: string }[] = [
  { id: "theme", label: "Theme" },
  { id: "serif", label: "Serif" },
  { id: "sans", label: "Sans" },
  { id: "handwritten", label: "Handwritten" },
];

export const NAME_SIZES: { id: HexNameSize; label: string; scale: number }[] = [
  { id: "small", label: "S", scale: 0.85 },
  { id: "medium", label: "M", scale: 1 },
  { id: "large", label: "L", scale: 1.25 },
  { id: "huge", label: "XL", scale: 1.5 },
];

export const NAME_STYLES: { id: HexNameStyle; label: string }[] = [
  { id: "bold", label: "Bold" },
  { id: "bold italic", label: "Bold italic" },
  { id: "regular", label: "Regular" },
  { id: "italic", label: "Italic" },
];

/** Font stacks; "theme" uses the theme's interface font. */
export const NAME_FONT_STACKS: Record<Exclude<HexNameFamily, "theme">, string> = {
  serif: `"Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Times New Roman", serif`,
  sans: `"Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif`,
  handwritten: `"Segoe Print", "Bradley Hand", "Comic Sans MS", "Chalkboard SE", cursive`,
};

/**
 * Smallest on-screen size of a hex name, px (NM3: names are map locales and
 * stay readable at any zoom; a long one may spill past its hex).
 */
export const MIN_NAME_SCREEN_PX = 11;

export const DEFAULT_NAME_FONT: ResolvedNameFont = { family: "theme", size: "medium", scale: 1, bold: true, italic: false };

export interface ResolvedNameFont {
  family: HexNameFamily;
  size: HexNameSize | null;
  /** Size multiplier (1 = the usual size). */
  scale: number;
  bold: boolean;
  italic: boolean;
}

/** Name-font settings as stored (map data or plugin settings). */
export interface NameFontSettings {
  hexNameFont?: string;
  hexNameSize?: string;
  hexNameStyle?: string;
}

/** A family from what's written; undefined when it can't be read. */
export function parseNameFamily(raw: unknown): HexNameFamily | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim().toLowerCase();
  if (!t) return undefined;
  if (/^(theme|default|interface|auto)/.test(t)) return "theme";
  if (/hand|script|cursive|written/.test(t)) return "handwritten";
  if (/sans/.test(t)) return "sans";
  if (/serif/.test(t)) return "serif";
  return undefined;
}

/** A size multiplier from what's written ("large", "XL", "120%", "1.2"). */
export function parseNameSize(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? clampScale(raw) : undefined;
  if (typeof raw !== "string") return undefined;
  const t = raw.trim().toLowerCase();
  if (!t) return undefined;
  const byWord = NAME_SIZES.find((s) => s.id === t || s.label.toLowerCase() === t);
  if (byWord) return byWord.scale;
  if (/^(x-?large|extra large)$/.test(t)) return 1.5;
  if (t === "normal" || t === "default") return 1;
  const m = /^(\d+(?:\.\d+)?|\.\d+)\s*(%)?$/.exec(t);
  if (!m) return undefined;
  const n = Number(m[1]) / (m[2] ? 100 : 1);
  return n > 0 ? clampScale(n) : undefined;
}

const clampScale = (n: number) => Math.min(3, Math.max(0.5, n));

/** Bold / italic from what's written ("bold italic", "regular", "italic"). */
export function parseNameStyle(raw: unknown): { bold: boolean; italic: boolean } | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim().toLowerCase();
  if (!t) return undefined;
  const italic = /italic|oblique/.test(t);
  const bold = /bold|heavy|black/.test(t);
  const plain = /regular|normal|plain|light/.test(t);
  if (!italic && !bold && !plain) return undefined;
  return { bold, italic };
}

/** The size word for a multiplier, or null for one between the steps. */
export function nameSizeId(scale: number): HexNameSize | null {
  return NAME_SIZES.find((s) => Math.abs(s.scale - scale) < 1e-6)?.id ?? null;
}

/** The style word for bold / italic. */
export function nameStyleId(bold: boolean, italic: boolean): HexNameStyle {
  return bold ? (italic ? "bold italic" : "bold") : italic ? "italic" : "regular";
}

/**
 * The font a map's hex names use: each of the map's own settings when it
 * has a readable one, else the plugin-wide default's, else the built-in
 * default (bold, theme font, usual size).
 */
export function resolveNameFont(map: NameFontSettings | undefined, global: NameFontSettings | undefined): ResolvedNameFont {
  const family = parseNameFamily(map?.hexNameFont) ?? parseNameFamily(global?.hexNameFont) ?? DEFAULT_NAME_FONT.family;
  const scale = parseNameSize(map?.hexNameSize) ?? parseNameSize(global?.hexNameSize) ?? DEFAULT_NAME_FONT.scale;
  const style = parseNameStyle(map?.hexNameStyle) ?? parseNameStyle(global?.hexNameStyle) ?? DEFAULT_NAME_FONT;
  return { family, size: nameSizeId(scale), scale, bold: style.bold, italic: style.italic };
}

/** The CSS font-family for a family; "theme" → `themeFamily` (the map's own font). */
export function nameFontFamily(family: HexNameFamily, themeFamily: string): string {
  return family === "theme" ? themeFamily || "sans-serif" : NAME_FONT_STACKS[family];
}

/** A canvas / CSS `font` shorthand for a name at `px`. */
export function nameFontShorthand(font: ResolvedNameFont, px: number, themeFamily: string): string {
  return `${font.italic ? "italic " : ""}${font.bold ? 700 : 400} ${px}px ${nameFontFamily(font.family, themeFamily)}`;
}

/**
 * The smallest font (grid em) at which a name still reads: MIN_NAME_SCREEN_PX
 * over the on-screen size of one grid em (its font px × the view's zoom).
 */
export function readableFloorEm(gridFontPx: number, zoom: number, minPx = MIN_NAME_SCREEN_PX): number {
  const screen = gridFontPx * zoom;
  return screen > 0 ? minPx / screen : 0;
}
