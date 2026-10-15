/**
 * Placement for menus and toolbars: the menu version of a surface's
 * Advanced dropdown. The one helper every placed menu uses (Obsidian
 * menus, the painter tools' own menu, toolbar buttons).
 *
 * - main and more items stay where they are, in order.
 * - Advanced items go in an "Advanced ▸" row at the end; it opens them as a
 *   second menu where the first one was. Its title counts the ones that
 *   are on ("Advanced · 1 set ▸"), so nothing is in effect unseen.
 * - Debug items go in a "Debug ▸" row at the end of Advanced, only while
 *   debug mode is on (at the top level when nothing else is Advanced).
 * - Hidden items are left out.
 * - A menu with no main items shows its Advanced items directly, never a
 *   lone "Advanced ▸".
 *
 * Why a second menu and not MenuItem.setSubmenu: setSubmenu works at
 * runtime but isn't in Obsidian's typings (1.12 or the latest, 1.14), so
 * it would need a cast to an undocumented API, which the plugin review can
 * flag and a future Obsidian can break. Menu and showAtPosition are typed
 * and work in every version.
 *
 * Where each item goes comes from the placement map (src/ui/placement.ts).
 * `placedRows`, `submenuRows` and `advancedTitle` are pure (tests).
 */
import { Menu } from "obsidian";
import { partition, type Placement } from "./placement";
import { setLabel } from "./disclosure";

export { setLabel };

/** A menu row tagged with its UI inventory id (untagged rows are main). */
export interface PlacedRow {
  /** Placement id, e.g. "PathMenu.reverse". */
  id?: string;
  label: string;
  onClick: () => void;
  icon?: string | null;
  checked?: boolean;
  disabled?: boolean;
  /**
   * Is it on (a non-default or active value)? Counted in the Advanced
   * row's title. Defaults to `checked`.
   */
  isSet?: boolean;
}

export type Pos = { x: number; y: number };

export const ADVANCED_TITLE = "Advanced";
export const DEBUG_TITLE = "Debug";
/** The Advanced row's title when nothing in it is set. */
export const ADVANCED_SUBMENU = `${ADVANCED_TITLE} ▸`;
export const DEBUG_SUBMENU = `${DEBUG_TITLE} ▸`;

/** Is the row on? */
export function rowIsSet(row: PlacedRow): boolean {
  return row.isSet ?? row.checked === true;
}

/** The Advanced row's title for these rows: "Advanced ▸" or "Advanced · N set ▸". */
export function advancedTitle(rows: readonly PlacedRow[]): string {
  return `${setLabel(ADVANCED_TITLE, rows.filter(rowIsSet).length)} ▸`;
}

export interface MenuSplit<T> {
  /** Shown in the menu itself (main, then more; or Advanced, when there's nothing else). */
  shown: T[];
  /** Under "Advanced ▸". */
  advanced: T[];
  /** Under "Debug ▸" (empty while debug mode is off). */
  debug: T[];
}

/**
 * Split rows into what the menu shows directly and its Advanced ▸ and
 * Debug ▸ submenus. `othersShown` counts items the menu shows that aren't
 * in `rows`: with none at all, the Advanced rows are shown directly.
 */
export function placedRows<T extends PlacedRow>(
  rows: readonly T[],
  debugMode: boolean,
  othersShown = 0,
  map?: Readonly<Record<string, Placement>>,
  singleInline = true,
): MenuSplit<T> {
  const p = partition(rows.map((r) => ({ id: r.id ?? "", item: r })), debugMode, map);
  const shown = [...p.main, ...p.more];
  if (!shown.length && !othersShown) return { shown: p.advanced, advanced: [], debug: p.debug };
  // One Advanced item isn't worth a submenu (owner, round 10): show it inline.
  if (singleInline && p.advanced.length === 1) return { shown: [...shown, ...p.advanced], advanced: [], debug: p.debug };
  return { shown, advanced: p.advanced, debug: p.debug };
}

/**
 * The rows that open a split's submenus (what goes at the end of the
 * menu): "Advanced ▸" (with "Debug ▸" as its last row), or "Debug ▸" alone
 * when nothing is Advanced. `open(rows)` shows a submenu's rows.
 */
export function submenuRows<T extends PlacedRow>(split: Pick<MenuSplit<T>, "advanced" | "debug">, open: (rows: PlacedRow[]) => void): PlacedRow[] {
  const debugRow: PlacedRow[] = split.debug.length
    ? [{ label: DEBUG_SUBMENU, icon: "bug", onClick: () => open(split.debug), isSet: false }]
    : [];
  if (!split.advanced.length) return debugRow;
  const inside: PlacedRow[] = [...split.advanced, ...debugRow];
  return [{ label: advancedTitle(split.advanced), icon: "settings-2", onClick: () => open(inside), isSet: false }];
}

/** The part of Obsidian's Menu used here (tests pass a fake). */
export type MenuLike = Pick<Menu, "addItem" | "addSeparator">;

/** Add rows to an Obsidian menu. */
export function addRows(menu: MenuLike, rows: readonly PlacedRow[]): void {
  for (const r of rows) {
    menu.addItem((item) => {
      item.setTitle(r.label).setDisabled(!!r.disabled);
      if (r.icon) item.setIcon(r.icon);
      if (r.checked !== undefined) item.setChecked(r.checked);
      if (!r.disabled) item.onClick(r.onClick);
    });
  }
}

/** Show rows as an Obsidian menu at a screen position (a submenu opens where its menu was). */
export function showRowsMenu(rows: readonly PlacedRow[], at: Pos): void {
  const menu = new Menu();
  addRows(menu, rows);
  menu.showAtPosition(at);
}

/** Add a split's Advanced ▸ / Debug ▸ rows to a menu (after a separator when `separate`). */
export function addSubmenus(menu: MenuLike, split: Pick<MenuSplit<PlacedRow>, "advanced" | "debug">, at: () => Pos, separate = false): void {
  const rows = submenuRows(split, (sub) => showRowsMenu(sub, at()));
  if (!rows.length) return;
  if (separate) menu.addSeparator();
  addRows(menu, rows);
}

/**
 * A toolbar's "Advanced ▸" (or, with nothing Advanced, "Debug ▸") button
 * at the end of `bar`: a click opens a menu of the rows under it.
 */
export function addSubmenuButtons(bar: HTMLElement, split: Pick<MenuSplit<PlacedRow>, "advanced" | "debug">, cls: string): void {
  // Menus open under the button that was clicked (Debug ▸ inside Advanced too).
  let at: Pos = { x: 0, y: 0 };
  for (const row of submenuRows(split, (sub) => showRowsMenu(sub, at))) {
    const btn = bar.createEl("button", { cls, text: row.label, attr: { "aria-haspopup": "menu" } });
    btn.addEventListener("click", () => {
      const r = btn.getBoundingClientRect();
      at = { x: r.left, y: r.bottom };
      row.onClick();
    });
  }
}

/**
 * Build an Obsidian menu with placed items: `add(id, row)` puts each where
 * the placement map says (now, in Advanced ▸ / Debug ▸ at the end, or
 * nowhere); `addItem` / `addSeparator` add unplaced (main) items; `finish`
 * adds the submenu rows before the menu is shown.
 *
 *   const pm = new PlacedMenu(menu, isDebugMode(app));
 *   pm.add("RTView.fileMenuEncounters", { label: …, onClick: … });
 *   pm.finish(() => at);
 *   menu.showAtPosition(at);
 */
export class PlacedMenu {
  private held: PlacedRow[] = [];
  private shownCount = 0;

  constructor(
    readonly menu: MenuLike,
    private debugMode: boolean,
    private map?: Readonly<Record<string, Placement>>,
  ) {}

  /** Add placed row `id`. */
  add(id: string | undefined, row: Omit<PlacedRow, "id">): void {
    const r: PlacedRow = { ...row, id };
    // One row at a time: whether a lone Advanced row goes inline is decided in finish().
    const split = placedRows([r], this.debugMode, 1, this.map, false);
    if (split.shown.length) {
      addRows(this.menu, split.shown);
      this.shownCount++;
    } else this.held.push(r);
  }

  /** Add an unplaced item (main). */
  addItem(build: Parameters<MenuLike["addItem"]>[0]): void {
    this.menu.addItem(build);
    this.shownCount++;
  }

  addSeparator(): void {
    this.menu.addSeparator();
  }

  /** Count items added to the menu some other way (they make it non-empty). */
  noteShown(n = 1): void {
    this.shownCount += n;
  }

  /**
   * Add what was held: the Advanced ▸ / Debug ▸ rows after a separator, or
   * the Advanced items themselves when the menu has nothing else. `at` is
   * where the menu is shown (submenus open there).
   */
  finish(at: () => Pos): void {
    const split = placedRows(this.held, this.debugMode, this.shownCount, this.map);
    this.held = [];
    if (split.shown.length) {
      addRows(this.menu, split.shown);
      this.shownCount += split.shown.length;
      addSubmenus(this.menu, split, at, true);
      return;
    }
    addSubmenus(this.menu, split, at, this.shownCount > 0);
  }
}

/** Where a menu item was chosen: the pointer, or (from the keyboard) the focused element, else the window's middle. */
export function eventPos(evt: MouseEvent | KeyboardEvent | undefined, win: { innerWidth: number; innerHeight: number }): Pos {
  if (evt && "clientX" in evt && (evt.clientX || evt.clientY)) return { x: evt.clientX, y: evt.clientY };
  const target = evt?.target;
  if (target && typeof (target as Partial<HTMLElement>).getBoundingClientRect === "function") {
    const r = (target as HTMLElement).getBoundingClientRect();
    if (r.width || r.height) return { x: r.left, y: r.bottom };
  }
  return { x: win.innerWidth / 2, y: win.innerHeight / 3 };
}
