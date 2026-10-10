/**
 * Hex name labels on the map (N1): one label per named hex, in a layer over
 * the grid (beside the coordinate labels). Hidden by the "Hex names" layer
 * toggle through a viewport class, so toggling needs no re-render.
 *
 * Only named hexes get a label (usually a handful), so every one is built;
 * no visible-area culling like the coordinate labels need.
 *
 * Line breaks are worked out here, not by CSS (round 7 R7: CSS wrapping in a
 * box sized from a guessed character width broke words mid-letter, "The /
 * Drowne"). `layoutHexName` wraps only at spaces, shrinks the font until the
 * name fits inside the hex, and ellipsizes only when the smallest size still
 * doesn't fit. Everything is in em, so the labels scale with the map's zoom.
 */

import { parseColor, relativeLuminance } from "../coordStyle";

export const HEX_NAMES_LAYER_CLASS = "duckmage-hex-names-layer";

/** Largest and smallest label font (em of the grid) and the step between. */
export const NAME_MAX_FONT_EM = 0.95;
export const NAME_MIN_FONT_EM = 0.5;
const NAME_FONT_STEP = 0.05;
/** Line height, as a multiple of the label's font size (matches the CSS). */
export const NAME_LINE_HEIGHT = 1.1;
/** Share of the hex's width (at the label's height) a line may use. */
export const NAME_WIDTH_SHARE = 0.96;
/** How far (grid em) a name may reach past the hex centre toward the coordinates. */
const NAME_CROSS_EM = 0.35;
/** With the coordinates in the middle, the gap (grid em) kept clear of the centre. */
const NAME_MIDDLE_CLEAR_EM = 0.5;
const ELLIPSIS = "…";

/**
 * Text tone for a name on a hex of fill colour `fill` (round 6 S4: a white
 * name on a white snow hex was unreadable). "dark" = dark text with a light
 * halo, for light terrain; "light" = the reverse. null (no or unknown fill)
 * keeps the theme's colours.
 */
export function hexNameTone(fill: string | null | undefined): "dark" | "light" | null {
  const rgb = fill ? parseColor(fill) : null;
  if (!rgb) return null;
  return relativeLuminance(rgb) > 0.4 ? "dark" : "light";
}

export interface HexNameLayoutOptions {
  /** Width of `text` set in the label's (bold) font at 1em, in em. */
  measure: (text: string) => number;
  /** The hex's box, in grid em. */
  hexW: number;
  hexH: number;
  flat: boolean;
  /** Where the coordinate labels sit; the name keeps to the other side. */
  coords?: "top" | "middle" | "bottom";
  /** How far right of the centre (grid em) the name may reach: the left
   *  edge of the hex's link badges (badgeNameLimit). Default: no limit. */
  rightLimit?: number;
}

export interface HexNameLayout {
  /** One or two lines, broken only at spaces. */
  lines: string[];
  /** Font size, grid em. */
  fontEm: number;
  /** Vertical offset of the label's centre from the hex centre, grid em
   *  (negative = up). */
  dyEm: number;
  /** Horizontal offset of the label's centre, grid em (negative = left,
   *  clear of the badges). */
  dxEm: number;
  /** True when an ellipsis cut the name (the hover shows it whole). */
  cut: boolean;
}

/** Half the hex's width at `dy` (grid em) from its centre. */
export function hexHalfWidthAt(dy: number, hexW: number, hexH: number, flat: boolean): number {
  const d = Math.abs(dy);
  if (flat) return Math.max(0, (hexW / 2) * (1 - d / hexH));
  if (d <= hexH / 4) return hexW / 2;
  return Math.max(0, (hexW / 2) * ((hexH / 2 - d) / (hexH / 4)));
}

/** Cut `text` to fit `room` (em at 1em), ending in an ellipsis. */
export function ellipsize(text: string, room: number, measure: (t: string) => number): string {
  if (measure(text) <= room) return text;
  let t = text;
  while (t.length > 1 && measure(t.trimEnd() + ELLIPSIS) > room) t = t.slice(0, -1);
  return t.trimEnd() + ELLIPSIS;
}

/**
 * The split of `words` into `lines` lines (at spaces) whose widest line is
 * narrowest. Names are a few words, so every split is tried.
 */
export function balancedLines(words: readonly string[], lines: number, measure: (t: string) => number): string[] {
  if (lines <= 1 || words.length <= 1) return [words.join(" ")];
  let best: string[] = [];
  let bestW = Infinity;
  for (let i = 1; i <= words.length - lines + 1; i++) {
    const head = words.slice(0, i).join(" ");
    const rest = balancedLines(words.slice(i), lines - 1, measure);
    const w = Math.max(measure(head), ...rest.map(measure));
    if (w < bestW) { bestW = w; best = [head, ...rest]; }
  }
  return best;
}

/** At most this many lines; a longer name is cut with an ellipsis. */
export const NAME_MAX_LINES = 3;

/**
 * Lay a name out inside its hex: the biggest font (from NAME_MAX_FONT_EM
 * down to NAME_MIN_FONT_EM) at which it fits on one line, or on two or
 * three lines broken at spaces. Words are never broken; a word too wide
 * even at the smallest size is cut with an ellipsis, and so is a name that
 * needs more lines. The label sits on the side of the hex away from the
 * coordinates, clear of the hex's link badges, and its width is checked
 * against the hex's real outline at the label's height, so it stays inside
 * the hex.
 */
export function layoutHexName(name: string, opts: HexNameLayoutOptions): HexNameLayout {
  const { measure, hexW, hexH, flat } = opts;
  const coords = opts.coords ?? "bottom";
  // Positive = away from the coordinates; turned into up/down at the end.
  const dir = coords === "bottom" ? -1 : 1;
  const nearMin = coords === "middle" ? NAME_MIDDLE_CLEAR_EM : -NAME_CROSS_EM;
  const limit = opts.rightLimit ?? Infinity;
  const place = (lines: number, f: number) => {
    const h = lines * NAME_LINE_HEIGHT * f;
    const centre = Math.max(0, h / 2 + nearMin);
    const far = centre + h / 2;
    const half = hexHalfWidthAt(far, hexW, hexH, flat) * NAME_WIDTH_SHARE;
    // Badges cut the right side short: the label shifts left to use what's
    // left of the hex.
    const right = Math.max(-half, Math.min(half, limit));
    // Room in the label's own em (what `measure` returns).
    return { centre, room: (half + right) / f, dx: (right - half) / 2 };
  };
  const done = (lines: string[], f: number, cut = false): HexNameLayout => {
    const p = place(lines.length, f);
    return {
      lines,
      fontEm: Number(f.toFixed(3)),
      dyEm: Number((dir * p.centre).toFixed(3)) || 0,
      dxEm: Number(p.dx.toFixed(3)) || 0,
      cut,
    };
  };

  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { lines: [], fontEm: NAME_MAX_FONT_EM, dyEm: 0, dxEm: 0, cut: false };
  const maxLines = Math.min(NAME_MAX_LINES, words.length);
  const splits: string[][] = [];
  for (let n = 1; n <= maxLines; n++) splits.push(balancedLines(words, n, measure));
  const widest = (lines: readonly string[]) => Math.max(...lines.map(measure));

  const steps = Math.round((NAME_MAX_FONT_EM - NAME_MIN_FONT_EM) / NAME_FONT_STEP);
  for (let i = 0; i <= steps; i++) {
    const f = NAME_MAX_FONT_EM - i * NAME_FONT_STEP;
    for (const lines of splits) if (widest(lines) <= place(lines.length, f).room) return done(lines, f);
  }

  // Too long even at the smallest size: fill the lines with whole words and
  // cut the last with an ellipsis (a word wider than the room is cut too).
  const f = NAME_MIN_FONT_EM;
  const room = place(maxLines, f).room;
  const out: string[] = [];
  let w = 0;
  while (w < words.length && out.length < maxLines - 1) {
    let n = 1;
    while (w + n < words.length && measure(words.slice(w, w + n + 1).join(" ")) <= room) n++;
    out.push(ellipsize(words.slice(w, w + n).join(" "), room, measure));
    w += n;
  }
  if (w < words.length) out.push(ellipsize(words.slice(w).join(" "), room, measure));
  const cut = out.join(" ") !== words.join(" ");
  return done(out, f, cut);
}

/**
 * A text measurer for the label font: canvas measureText (no DOM layout),
 * in em at 1em, cached per string.
 */
export function canvasMeasure(fontFamily: string, weight = 700): (text: string) => number {
  const ctx = typeof OffscreenCanvas === "undefined" ? null : new OffscreenCanvas(1, 1).getContext("2d");
  const cache = new Map<string, number>();
  if (ctx) ctx.font = `${weight} 100px ${fontFamily || "sans-serif"}`;
  return (text: string) => {
    let w = cache.get(text);
    if (w === undefined) {
      // No canvas: a generous estimate, so names err on the small side.
      w = ctx ? ctx.measureText(text).width / 100 : text.length * 0.62;
      cache.set(text, w);
    }
    return w;
  };
}

/**
 * (Re)build the layer. `names` maps "x_y" → name. Follows the read-then-
 * write rule (CLAUDE.md): every hex's geometry and the font are read before
 * any label DOM is created, so a big map costs one layout flush.
 */
export function renderHexNameLayer(
  gridContainer: HTMLElement,
  names: ReadonlyMap<string, string>,
  fills: ReadonlyMap<string, string> = new Map(),
  coords: "top" | "middle" | "bottom" = "bottom",
  /** Per hex ("x_y"): how far right its name may reach (badgeNameLimit). */
  rightLimits: ReadonlyMap<string, number> = new Map(),
): void {
  gridContainer.querySelector(`.${HEX_NAMES_LAYER_CLASS}`)?.remove();
  if (names.size === 0) return;

  // ── reads ──
  const gw = gridContainer.offsetWidth || 1;
  const gh = gridContainer.offsetHeight || 1;
  const style = getComputedStyle(gridContainer);
  const gridFont = parseFloat(style.fontSize) || 16;
  const flat = gridContainer.hasClass("duckmage-grid-flat");
  let hexW = 0;
  let hexH = 0;
  const placements: { name: string; ox: number; oy: number; key: string }[] = [];
  for (const [key, name] of names) {
    const [x, y] = key.split("_");
    const hexEl = gridContainer.querySelector<HTMLElement>(`.duckmage-hex[data-x="${x}"][data-y="${y}"]`);
    if (!hexEl) continue;
    if (!hexW) {
      hexW = hexEl.offsetWidth / gridFont;
      hexH = hexEl.offsetHeight / gridFont;
    }
    let ox = hexEl.offsetWidth / 2;
    let oy = hexEl.offsetHeight / 2;
    let cur: HTMLElement | null = hexEl;
    while (cur && cur !== gridContainer) {
      ox += cur.offsetLeft;
      oy += cur.offsetTop;
      cur = cur.offsetParent as HTMLElement | null;
    }
    placements.push({ name, ox, oy, key });
  }
  if (!placements.length) return;
  const measure = canvasMeasure(style.fontFamily);

  // ── writes ──
  const layer = gridContainer.createDiv({ cls: HEX_NAMES_LAYER_CLASS });
  for (const p of placements) {
    const fit = layoutHexName(p.name, {
      measure,
      hexW: hexW || (flat ? 4.4 : 3.81),
      hexH: hexH || (flat ? 3.81 : 4.4),
      flat,
      coords,
      rightLimit: rightLimits.get(p.key),
    });
    const tone = hexNameTone(fills.get(p.key));
    const label = layer.createDiv({
      cls: "duckmage-hex-name-label"
        + (fit.cut ? " is-cut" : "")
        + (tone ? ` is-on-${tone === "dark" ? "light" : "dark"}` : ""),
      text: fit.lines.join("\n"),
    });
    // % of the grid, like coordinate labels: tracks zoom bakes without a
    // rebuild. Font and offset are in em, so they follow the zoom too.
    label.setCssProps({
      "--duckmage-name-x": `${((p.ox / gw) * 100).toFixed(3)}%`,
      "--duckmage-name-y": `${((p.oy / gh) * 100).toFixed(3)}%`,
      "--duckmage-name-font": `${fit.fontEm}em`,
      "--duckmage-name-dx": `${(fit.dxEm / fit.fontEm).toFixed(3)}em`,
      // The offset is in the label's own em.
      "--duckmage-name-dy": `${(fit.dyEm / fit.fontEm).toFixed(3)}em`,
    });
  }
}
