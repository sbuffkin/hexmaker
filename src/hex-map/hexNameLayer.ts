/**
 * Hex name labels on the map (N1): one label per named hex, in a layer over
 * the grid (beside the coordinate labels). Hidden by the "Hex names" layer
 * toggle through a viewport class, so toggling needs no re-render.
 *
 * Only named hexes get a label (usually a handful), so every one is built;
 * no visible-area culling like the coordinate labels need.
 */

export const HEX_NAMES_LAYER_CLASS = "duckmage-hex-names-layer";

/**
 * (Re)build the layer. `names` maps "x_y" → name. Follows the read-then-
 * write rule (CLAUDE.md): every hex's geometry is read into a plain array
 * before any label DOM is created, so a big map costs one layout flush.
 */
export function renderHexNameLayer(gridContainer: HTMLElement, names: ReadonlyMap<string, string>): void {
  gridContainer.querySelector(`.${HEX_NAMES_LAYER_CLASS}`)?.remove();
  if (names.size === 0) return;

  // ── reads ──
  const gw = gridContainer.offsetWidth || 1;
  const gh = gridContainer.offsetHeight || 1;
  const placements: { name: string; ox: number; oy: number }[] = [];
  for (const [key, name] of names) {
    const [x, y] = key.split("_");
    const hexEl = gridContainer.querySelector<HTMLElement>(`.duckmage-hex[data-x="${x}"][data-y="${y}"]`);
    if (!hexEl) continue;
    let ox = hexEl.offsetWidth / 2;
    let oy = hexEl.offsetHeight / 2;
    let cur: HTMLElement | null = hexEl;
    while (cur && cur !== gridContainer) {
      ox += cur.offsetLeft;
      oy += cur.offsetTop;
      cur = cur.offsetParent as HTMLElement | null;
    }
    placements.push({ name, ox, oy });
  }
  if (!placements.length) return;

  // ── writes ──
  const layer = gridContainer.createDiv({ cls: HEX_NAMES_LAYER_CLASS });
  for (const p of placements) {
    const label = layer.createDiv({ cls: "duckmage-hex-name-label", text: p.name });
    // % of the grid, like coordinate labels: tracks zoom bakes without a rebuild.
    label.setCssProps({
      "--duckmage-name-x": `${((p.ox / gw) * 100).toFixed(3)}%`,
      "--duckmage-name-y": `${((p.oy / gh) * 100).toFixed(3)}%`,
    });
  }
}
