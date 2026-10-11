/**
 * Placement for right-click menus: the menu version of a surface's
 * Advanced dropdown. Main items go in the menu as they're added; Advanced
 * ones are kept and added at the end under an "Advanced ▸" submenu, with
 * Debug ones in a "Debug ▸" submenu inside it (debug mode only). Hidden
 * items are never added. Where each item goes comes from the placement map
 * (src/ui/placement.ts), like every other control.
 *
 * Use: `const layers = new MenuLayers(menu, isDebugMode(app));`, then
 * `layers.add(id, (item) => item.setTitle(…))` for each item, and
 * `layers.finish()` before showing the menu.
 */

import type { Menu, MenuItem } from "obsidian";
import { layerOf, type Layer } from "./placement";

/** The part of Obsidian's Menu used here (tests pass a fake). */
export type MenuLike = Pick<Menu, "addItem" | "addSeparator">;

type Build = (item: MenuItem) => unknown;

/** MenuItem.setSubmenu exists at runtime (Obsidian 1.4+) but isn't in the typings. */
type WithSubmenu = MenuItem & { setSubmenu?: () => Menu };

export const ADVANCED_MENU_TITLE = "Advanced";
export const DEBUG_MENU_TITLE = "Debug";

export class MenuLayers {
  private advanced: Build[] = [];
  private debug: Build[] = [];

  constructor(
    private menu: MenuLike,
    private debugMode: boolean,
    private map?: Readonly<Record<string, Layer>>,
  ) {}

  /** Add item `id` where the placement map says (now, later in a submenu, or not at all). */
  add(id: string, build: Build): void {
    const layer = layerOf(id, this.map);
    if (layer === "hidden" || (layer === "debug" && !this.debugMode)) return;
    if (layer === "advanced") this.advanced.push(build);
    else if (layer === "debug") this.debug.push(build);
    else this.menu.addItem(build);
  }

  /** Add the Advanced ▸ (and Debug ▸) submenus, if anything went in them. */
  finish(hasItemsAbove = true): void {
    if (!this.advanced.length && !this.debug.length) return;
    if (hasItemsAbove) this.menu.addSeparator();
    const adv = this.submenu(this.menu, ADVANCED_MENU_TITLE, "settings-2");
    for (const b of this.advanced) adv.addItem(b);
    if (!this.debug.length) return;
    const dbg = this.submenu(adv, DEBUG_MENU_TITLE, "bug");
    for (const b of this.debug) dbg.addItem(b);
  }

  /**
   * A titled submenu of `parent`. Without submenus (an old Obsidian, or a
   * test fake) the title is a label and the items follow it inline.
   */
  private submenu(parent: MenuLike, title: string, icon: string): MenuLike {
    let sub: MenuLike | null = null;
    parent.addItem((item) => {
      // Obsidian draws the ▸ on an item with a submenu.
      item.setTitle(title).setIcon(icon);
      const make = (item as WithSubmenu).setSubmenu;
      if (make) sub = make.call(item);
      else item.setIsLabel(true);
    });
    return sub ?? parent;
  }
}
