/**
 * Commands and menu items, placed by the same map as every other control
 * (src/ui/placement.ts), by their `Plugin.cmd.<name>` / `Plugin.<item>` id:
 *
 * - main / more / advanced: registered as written. A command palette entry
 *   is only seen by someone searching for it, so it is already "pulled"
 *   discovery; Advanced changes nothing there.
 * - debug: only offered while debug mode is on (its check fails otherwise,
 *   so the palette leaves it out and a hotkey does nothing).
 * - hidden: not registered.
 *
 * Right-click menus: `advanced` items go in one submenu (menuSubmenu) rather
 * than at the top level of every menu.
 */

import type { Command, Menu } from "obsidian";
import { layerOf } from "./placement";

/**
 * `cmd` as its placement says: unchanged, gated on debug mode, or null
 * (don't register it). A gated command keeps its own checks.
 */
export function placeCommand(id: string, cmd: Command, debugMode: () => boolean): Command | null {
  const layer = layerOf(id);
  if (layer === "hidden") return null;
  if (layer !== "debug") return cmd;
  const { callback, checkCallback, editorCallback, editorCheckCallback, ...rest } = cmd;
  const out: Command = { ...rest };
  if (editorCallback || editorCheckCallback) {
    out.editorCheckCallback = (checking, editor, ctx) => {
      if (!debugMode()) return false;
      if (editorCheckCallback) return editorCheckCallback(checking, editor, ctx);
      if (!checking) void editorCallback!(editor, ctx);
      return true;
    };
    return out;
  }
  out.checkCallback = (checking) => {
    if (!debugMode()) return false;
    if (checkCallback) return checkCallback(checking);
    if (!checking) void callback?.();
    return true;
  };
  return out;
}

/** Is menu item `id` at the top level of its menu (not hidden, not Debug without debug mode, not in the Advanced submenu)? */
export function menuItemAtTop(id: string, debugMode: boolean): boolean {
  const layer = layerOf(id);
  return layer === "main" || layer === "more" || (layer === "debug" && debugMode);
}

/** Is menu item `id` in its menu's Advanced submenu? */
export function menuItemInSubmenu(id: string): boolean {
  return layerOf(id) === "advanced";
}

/** A placed right-click menu item. */
export interface PlacedMenuItem {
  id: string;
  /** Title at the top level of the menu. */
  title: string;
  /** Title inside the submenu (the submenu's own title says the rest). */
  short: string;
  icon: string;
  run: () => void;
}

/**
 * Add `items` to `menu` as placed: main ones (and Debug ones in debug mode)
 * at the top level, Advanced ones in one submenu titled `submenuTitle`.
 * Without submenus (an Obsidian too old for them) the Advanced ones go at
 * the top level instead, so nothing is lost.
 */
export function addPlacedMenuItems(menu: Menu, submenuTitle: string, submenuIcon: string, items: PlacedMenuItem[], debugMode: boolean): void {
  const top = items.filter((i) => menuItemAtTop(i.id, debugMode));
  const tucked = items.filter((i) => menuItemInSubmenu(i.id));
  const addTop = (i: PlacedMenuItem) =>
    menu.addItem((item) => item.setTitle(i.title).setIcon(i.icon).setSection("action").onClick(i.run));
  for (const i of top) addTop(i);
  if (!tucked.length) return;
  let flat = false;
  menu.addItem((item) => {
    item.setTitle(submenuTitle).setIcon(submenuIcon).setSection("action");
    // setSubmenu isn't in the 1.12 typings; it's been in Obsidian since 1.4.
    const sub = (item as unknown as { setSubmenu?: () => Menu }).setSubmenu?.();
    if (!sub) {
      flat = true;
      item.setTitle(tucked[0].title).setIcon(tucked[0].icon).onClick(tucked[0].run);
      return;
    }
    for (const i of tucked) sub.addItem((s) => s.setTitle(i.short).setIcon(i.icon).onClick(i.run));
  });
  if (flat) for (const i of tucked.slice(1)) addTop(i);
}
