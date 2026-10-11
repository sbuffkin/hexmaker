/**
 * The uncharted marker: a small "?" on every hex whose On arrival cell is
 * still waiting to be rolled (plan-tables-everywhere §2.6). A layer of its
 * own, shown or hidden from the layers menu (Labels → Uncharted; on by
 * default) by a class on the viewport.
 *
 * No layout reads here (CLAUDE.md read-then-write rule): hex centres come
 * from the placements the coordinate layer already measured, so this only
 * writes.
 */

import type { HexData } from "../maps/mapNote";

export const UNCHARTED_LAYER_CLASS = "duckmage-uncharted-layer";

/** Keys ("x_y") of hexes with an On arrival roll still to make. */
export function unchartedKeys(hexes: ReadonlyMap<string, Pick<HexData, "onArrival">>): Set<string> {
  const out = new Set<string>();
  for (const [k, h] of hexes) if (h.onArrival?.trim()) out.add(k);
  return out;
}

/**
 * (Re)draw the marker layer over `grid`. `placements` are hex centres in
 * grid pixels, keyed "x,y" (the coordinate layer's); `gridSize` the grid's
 * measured size. No layer when nothing is uncharted.
 */
export function renderUnchartedLayer(
  grid: HTMLElement,
  placements: readonly { key: string; ox: number; oy: number }[],
  gridSize: { w: number; h: number },
  uncharted: ReadonlySet<string>,
): void {
  grid.querySelector(`.${UNCHARTED_LAYER_CLASS}`)?.remove();
  if (uncharted.size === 0) return;
  const gw = gridSize.w || 1;
  const gh = gridSize.h || 1;
  const layer = grid.createDiv({ cls: UNCHARTED_LAYER_CLASS });
  for (const p of placements) {
    if (!uncharted.has(p.key.replace(",", "_"))) continue;
    const mark = layer.createSpan({ cls: "duckmage-uncharted-mark", text: "?", attr: { "aria-label": "Uncharted: rolled when someone arrives" } });
    mark.setCssProps({
      "--duckmage-uncharted-x": `${((p.ox / gw) * 100).toFixed(3)}%`,
      "--duckmage-uncharted-y": `${((p.oy / gh) * 100).toFixed(3)}%`,
    });
  }
}
