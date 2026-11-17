/** The status-bar "Debug" item, while debug mode is on (clicking it turns debug mode off). */
import type { Plugin } from "obsidian";
import { setDebugMode } from "./debugMode";

const items = new WeakMap<Plugin, HTMLElement>();

export function syncDebugStatus(plugin: Plugin, on: boolean): void {
  const shown = items.get(plugin);
  if (on && !shown) {
    const el = plugin.addStatusBarItem();
    el.addClass("mod-clickable", "duckmage-debug-status");
    el.setText("Debug");
    el.setAttr("aria-label", "Hexmaker debug mode is on. Click to turn it off.");
    el.setAttr("data-tooltip-position", "top");
    el.addEventListener("click", () => setDebugMode(plugin.app, false));
    items.set(plugin, el);
  } else if (!on && shown) {
    shown.remove();
    items.delete(plugin);
  }
}
