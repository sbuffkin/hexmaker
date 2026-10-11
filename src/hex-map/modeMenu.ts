/**
 * The map view's menus, through the work-mode table (src/workMode.ts).
 * Every item names its MENU_ACTIONS id; an item the map's mode locks is
 * left out, and the menu ends with ONE disabled line saying which mode
 * unlocks them ("Switch to Build to paint terrain."), never a wall of
 * greyed-out items. tests/workModeCoverage.test.ts checks that the map
 * view builds its menus only through here.
 */
import { Menu } from "obsidian";
import { allows, lockedSummary, MENU_ACTIONS, type MenuActionId, type ModeAction, type WorkMode } from "../workMode";

export class ModeMenu {
  readonly menu = new Menu();
  private locked: ModeAction[] = [];

  constructor(private mode: WorkMode) {}

  /** Is the item allowed in this mode? */
  allows(id: MenuActionId): boolean {
    return allows(this.mode, MENU_ACTIONS[id]);
  }

  /**
   * Add an item (when the mode allows it). `opts.disabled` (with its own
   * reason in the title) is for other reasons an item can't run now.
   */
  add(id: MenuActionId, title: string, icon: string | null, onClick: () => void, opts: { disabled?: boolean; checked?: boolean } = {}): void {
    const action = MENU_ACTIONS[id];
    if (!allows(this.mode, action)) {
      this.locked.push(action);
      return;
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

  private finish(): void {
    const hint = this.hint();
    if (!hint) return;
    this.menu.addSeparator();
    this.menu.addItem((item) => item.setTitle(hint).setIcon("lock").setDisabled(true));
    this.locked = [];
  }

  showAtMouseEvent(evt: MouseEvent): void {
    this.finish();
    this.menu.showAtMouseEvent(evt);
  }

  showAtPosition(at: { x: number; y: number }): void {
    this.finish();
    this.menu.showAtPosition(at);
  }
}
