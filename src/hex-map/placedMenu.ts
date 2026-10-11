/**
 * Placement for menus and toolbars (no dropdown to put things in): items
 * the placement map (src/ui/placement.ts) puts in Advanced go into an
 * "Advanced ▸" submenu at the end of the menu, Debug ones into a
 * "Debug ▸" submenu that exists only while debug mode is on, and hidden
 * ones are left out. Main and more items stay where they are, in order.
 *
 * `placedRows` is pure (tests); the rest builds Obsidian menus.
 */
import { Menu } from "obsidian";
import { partition } from "../ui/placement";

/** A menu row tagged with its UI inventory id (untagged rows are main). */
export interface PlacedRow {
  /** Placement id, e.g. "PathMenu.reverse". */
  id?: string;
  label: string;
  onClick: () => void;
  icon?: string | null;
  checked?: boolean;
}

export const ADVANCED_SUBMENU = "Advanced ▸";
export const DEBUG_SUBMENU = "Debug ▸";

/**
 * Split rows into what the menu shows directly (main, then more) and its
 * Advanced ▸ and Debug ▸ submenus. Debug is empty while debug mode is off.
 */
export function placedRows<T extends PlacedRow>(rows: readonly T[], debugMode: boolean): { shown: T[]; advanced: T[]; debug: T[] } {
  const p = partition(rows.map((r) => ({ id: r.id ?? "", item: r })), debugMode);
  return { shown: [...p.main, ...p.more], advanced: p.advanced, debug: p.debug };
}

/**
 * The submenu rows for a split (what goes at the end of the menu): one
 * "Advanced ▸" row and one "Debug ▸" row, each only when it has items.
 * `open(rows)` shows a submenu's rows.
 */
export function submenuRows<T extends PlacedRow>(split: { advanced: T[]; debug: T[] }, open: (rows: T[]) => void): PlacedRow[] {
  const out: PlacedRow[] = [];
  if (split.advanced.length) out.push({ label: ADVANCED_SUBMENU, onClick: () => open(split.advanced) });
  if (split.debug.length) out.push({ label: DEBUG_SUBMENU, onClick: () => open(split.debug) });
  return out;
}

/** Show rows as an Obsidian menu at a screen position. */
export function showRowsMenu(rows: readonly PlacedRow[], at: { x: number; y: number }): void {
  const menu = new Menu();
  for (const r of rows) {
    menu.addItem((item) => {
      item.setTitle(r.label).onClick(r.onClick);
      if (r.icon) item.setIcon(r.icon);
      if (r.checked !== undefined) item.setChecked(r.checked);
    });
  }
  menu.showAtPosition(at);
}

/**
 * Add the Advanced ▸ / Debug ▸ submenus of a split to an Obsidian menu.
 * Each opens its own menu where the first one was (`at`).
 */
export function addSubmenus(menu: Menu, split: { advanced: PlacedRow[]; debug: PlacedRow[] }, at: () => { x: number; y: number }): void {
  for (const row of submenuRows(split, (rows) => showRowsMenu(rows, at()))) {
    menu.addItem((item) => item.setTitle(row.label).setIcon(row.label === DEBUG_SUBMENU ? "bug" : "chevrons-right").onClick(row.onClick));
  }
}

/**
 * A toolbar's "Advanced ▸" (and, in debug mode, "Debug ▸") button at the
 * end of `bar`: a click opens a menu of the rows under it. Returns nothing
 * built when there are no rows.
 */
export function addSubmenuButtons(bar: HTMLElement, split: { advanced: PlacedRow[]; debug: PlacedRow[] }, cls: string): void {
  for (const [label, rows] of [[ADVANCED_SUBMENU, split.advanced], [DEBUG_SUBMENU, split.debug]] as const) {
    if (!rows.length) continue;
    const btn = bar.createEl("button", { cls, text: label, attr: { "aria-haspopup": "menu" } });
    btn.addEventListener("click", () => {
      const r = btn.getBoundingClientRect();
      showRowsMenu(rows, { x: r.left, y: r.bottom });
    });
  }
}
