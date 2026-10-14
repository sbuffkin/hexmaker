/**
 * Drawing a hex flower: 19 flat-topped cells placed by CSS custom
 * properties (no inline styles), each with its number and result, the
 * terrain's colour when the result is a palette terrain. Used by the note's
 * code block (read only) and the generator page's editor (clickable).
 */

import { CELL_COORDS, CELL_COUNT, isBlocked, type Flower } from "./flower";

export interface FlowerDrawOptions {
  /** Terrain name (any case) → colour. */
  colors?: ReadonlyMap<string, string>;
  /** The cell to mark as where a walk stands. */
  current?: number;
  /** A small line under each cell (landing odds). */
  under?: (cell: number) => string | undefined;
  /** Clickable cells: left and right click. */
  onClick?: (cell: number, e: MouseEvent) => void;
  onContext?: (cell: number, e: MouseEvent) => void;
  /** Extra class on the box. */
  cls?: string;
}

/** Where a cell sits in the box (its top-left corner, % of the box). */
export function cellPlace(cell: number): { left: number; top: number } {
  const [q, r] = CELL_COORDS[cell - 1];
  return { left: (0.75 * q + 1.5) * 25, top: ((r + q / 2 + 2) / 5) * 100 };
}

/** Draw `flower` into `parent`; returns the box. */
export function drawFlower(parent: HTMLElement, flower: Flower, o: FlowerDrawOptions = {}): HTMLElement {
  const box = parent.createDiv({ cls: `duckmage-flower${o.cls ? ` ${o.cls}` : ""}${o.onClick ? " is-editable" : ""}` });
  for (let n = 1; n <= CELL_COUNT; n++) {
    const c = flower.cells[n - 1];
    const result = c?.result ?? "";
    const blocked = isBlocked(result);
    const color = o.colors?.get(result.trim().toLowerCase());
    const cls = ["duckmage-flower-cell"];
    if (blocked) cls.push("is-blocked");
    if (n === flower.start) cls.push("is-start");
    if (n === o.current) cls.push("is-current");
    if (color) cls.push("has-color");
    const el = box.createDiv({ cls: cls.join(" "), attr: { "data-cell": String(n), title: `${n}: ${result}${c?.notes ? `\n${c.notes}` : ""}` } });
    const { left, top } = cellPlace(n);
    el.setCssProps({
      "--duckmage-flower-left": `${left}%`,
      "--duckmage-flower-top": `${top}%`,
      ...(color ? { "--duckmage-flower-color": color } : {}),
    });
    el.createSpan({ cls: "duckmage-flower-num", text: String(n) });
    el.createSpan({ cls: "duckmage-flower-result", text: blocked ? "blocked" : result.replace(/^\(|\)$/g, "") });
    const under = o.under?.(n);
    if (under) el.createSpan({ cls: "duckmage-flower-under", text: under });
    if (o.onClick) el.addEventListener("click", (e) => o.onClick!(n, e));
    if (o.onContext) el.addEventListener("contextmenu", (e) => { e.preventDefault(); o.onContext!(n, e); });
  }
  return box;
}
