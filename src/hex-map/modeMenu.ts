/**
 * The map view's menus, through the work-mode table (src/workMode.ts).
 * Every item names its MENU_ACTIONS id; an item the map's mode locks is
 * left out, and the menu ends with ONE disabled line saying which mode
 * unlocks them ("Switch to Build to paint terrain."), never a wall of
 * greyed-out items. When that mode is God, the line is an offer instead:
 * "Switch to God for this map to swap hexes" switches the map (onGod).
 * tests/workModeCoverage.test.ts checks that the map view builds its
 * menus only through here.
 *
 * Placement (src/ui/placement.ts): an item given a placement id that's
 * Advanced goes into an "Advanced ▸" submenu at the end, Debug into a
 * "Debug ▸" one (debug mode only), hidden is left out (placedMenu.ts).
 */
import { Menu } from "obsidian";
import { allows, godOfferText, lockedSummary, MENU_ACTIONS, type MenuActionId, type ModeAction, type WorkMode } from "../workMode";
import { isDebugMode, type LocalStore } from "../ui/debugMode";
import { addSubmenus, placedRows, type PlacedRow } from "./placedMenu";

export interface ModeMenuOptions {
  /** Local storage, for debug mode (no store: Debug items are left out). */
  store?: LocalStore;
  /** Switch this map to God: turns a God hint into an offer. */
  onGod?: () => void;
}

export class ModeMenu {
  readonly menu = new Menu();
  private locked: ModeAction[] = [];
  /** Items with a placement id that isn't main: sorted into submenus at the end. */
  private placed: PlacedRow[] = [];
  private at = { x: 0, y: 0 };

  constructor(private mode: WorkMode, private opts: ModeMenuOptions = {}) {}

  /** Is the item allowed in this mode? */
  allows(id: MenuActionId): boolean {
    return allows(this.mode, MENU_ACTIONS[id]);
  }

  /**
   * Add an item (when the mode allows it). `opts.disabled` (with its own
   * reason in the title) is for other reasons an item can't run now;
   * `opts.place` is its placement id (Advanced items go in Advanced ▸).
   */
  add(id: MenuActionId, title: string, icon: string | null, onClick: () => void, opts: { disabled?: boolean; checked?: boolean; place?: string } = {}): void {
    const action = MENU_ACTIONS[id];
    if (!allows(this.mode, action)) {
      this.locked.push(action);
      return;
    }
    if (opts.place) {
      const split = placedRows([{ id: opts.place, label: title, onClick, icon, checked: opts.checked }], true);
      if (!split.shown.length) {
        // Advanced or Debug: listed in its submenu at the end (hidden: nowhere).
        this.placed.push(...split.advanced, ...split.debug);
        return;
      }
    }
    this.menu.addItem((item) => {
      item.setTitle(title).setDisabled(!!opts.disabled);
      if (icon) item.setIcon(icon);
      if (opts.checked !== undefined) item.setChecked(opts.checked);
      if (!opts.disabled) item.onClick(onClick);
    });
  }

  addSeparator(): void {
    this.menu.addSeparator();
  }

  /** A greyed heading line for the items that follow (not an action). */
  addLabel(text: string): void {
    this.menu.addItem((item) => item.setTitle(text).setIcon("hexagon").setDisabled(true));
  }

  /** The one-line hint for what was left out (null when nothing was). */
  hint(): string | null {
    return lockedSummary(this.locked);
  }

  /** The hint as an offer to switch to God (null unless God unlocks it and onGod is set). */
  godOffer(): string | null {
    return this.opts.onGod ? godOfferText(this.hint()) : null;
  }

  private finish(): void {
    const debug = this.opts.store ? isDebugMode(this.opts.store) : false;
    const split = placedRows(this.placed, debug);
    addSubmenus(this.menu, split, () => this.at);
    this.placed = [];
    const hint = this.hint();
    if (!hint) return;
    this.menu.addSeparator();
    const offer = this.godOffer();
    const onGod = this.opts.onGod;
    if (offer && onGod) this.menu.addItem((item) => item.setTitle(`${offer}?`).setIcon("unlock").onClick(onGod));
    else this.menu.addItem((item) => item.setTitle(hint).setIcon("lock").setDisabled(true));
    this.locked = [];
  }

  showAtMouseEvent(evt: MouseEvent): void {
    this.at = { x: evt.clientX, y: evt.clientY };
    this.finish();
    this.menu.showAtMouseEvent(evt);
  }

  showAtPosition(at: { x: number; y: number }): void {
    this.at = at;
    this.finish();
    this.menu.showAtPosition(at);
  }
}
