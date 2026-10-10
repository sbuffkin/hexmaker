/**
 * Hex name labels on the map (N1): one label per named hex, in a layer over
 * the grid (beside the coordinate labels). Hidden by the "Hex names" layer
 * toggle through a viewport class, so toggling needs no re-render.
 *
 * Only named hexes get a label (usually a handful), so every one is built;
 * no visible-area culling like the coordinate labels need.
 */

import { parseColor, relativeLuminance } from "../coordStyle";

export const HEX_NAMES_LAYER_CLASS = "duckmage-hex-names-layer";

/** Label font sizes (em of the grid), one line and the smaller two-line size. */
export const NAME_FONT_EM = 0.95;
export const NAME_LONG_FONT_EM = 0.8;
/** Share of the hex's width a name may use before it wraps. */
const NAME_WIDTH_SHARE = 0.92;
/** Rough width of one bold character, in em (no layout read needed). */
const CHAR_EM = 0.58;

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

/**
 * How a name fits a hex `hexWidthEm` wide (grid em). Short names stay on
 * one line; longer ones drop to a smaller font and wrap onto two lines
 * within the hex (round 6 U5: "Hermit's Hut" ran into both neighbours'
 * coordinates). `maxWidthEm` is in the label's own em. Names too long even
 * for two lines are cut with an ellipsis (the hex's hover shows them whole).
 */
export function hexNameFit(name: string, hexWidthEm: number): { long: boolean; maxWidthEm: number } {
  const room = Math.max(1, hexWidthEm * NAME_WIDTH_SHARE);
  const long = name.trim().length * CHAR_EM * NAME_FONT_EM > room;
  const font = long ? NAME_LONG_FONT_EM : NAME_FONT_EM;
  return { long, maxWidthEm: Number((room / font).toFixed(3)) };
}

/**
 * (Re)build the layer. `names` maps "x_y" → name. Follows the read-then-
 * write rule (CLAUDE.md): every hex's geometry is read into a plain array
 * before any label DOM is created, so a big map costs one layout flush.
 */
export function renderHexNameLayer(
  gridContainer: HTMLElement,
  names: ReadonlyMap<string, string>,
  fills: ReadonlyMap<string, string> = new Map(),
): void {
  gridContainer.querySelector(`.${HEX_NAMES_LAYER_CLASS}`)?.remove();
  if (names.size === 0) return;

  // ── reads ──
  const gw = gridContainer.offsetWidth || 1;
  const gh = gridContainer.offsetHeight || 1;
  const gridFont = parseFloat(getComputedStyle(gridContainer).fontSize) || 16;
  let hexWidthEm = 0;
  const placements: { name: string; ox: number; oy: number; key: string }[] = [];
  for (const [key, name] of names) {
    const [x, y] = key.split("_");
    const hexEl = gridContainer.querySelector<HTMLElement>(`.duckmage-hex[data-x="${x}"][data-y="${y}"]`);
    if (!hexEl) continue;
    if (!hexWidthEm) hexWidthEm = hexEl.offsetWidth / gridFont;
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

  // ── writes ──
  const layer = gridContainer.createDiv({ cls: HEX_NAMES_LAYER_CLASS });
  for (const p of placements) {
    const fit = hexNameFit(p.name, hexWidthEm || 4);
    const tone = hexNameTone(fills.get(p.key));
    const label = layer.createDiv({
      cls: "duckmage-hex-name-label"
        + (fit.long ? " is-long" : "")
        + (tone ? ` is-on-${tone === "dark" ? "light" : "dark"}` : ""),
      text: p.name,
    });
    // % of the grid, like coordinate labels: tracks zoom bakes without a rebuild.
    // Widths are in em, so they follow the zoom too.
    label.setCssProps({
      "--duckmage-name-x": `${((p.ox / gw) * 100).toFixed(3)}%`,
      "--duckmage-name-y": `${((p.oy / gh) * 100).toFixed(3)}%`,
      "--duckmage-name-max-w": `${fit.maxWidthEm}em`,
    });
  }
}
