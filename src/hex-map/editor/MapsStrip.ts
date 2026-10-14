/**
 * The hex editor's "Maps" strip: the hex's region chip, a chip per
 * location, and "+" (new map, link existing, manage locations).
 */

import { getHexMapsFromFile } from "../../frontmatter";
import { newMapItemTitle } from "../../maps/submaps";
import { workModeOf } from "../../workMode";
import { ModeMenu, type ModeMenuOptions } from "../modeMenu";
import { EditorPart, type EditorHexHost } from "./host";

export interface MapsStripHost extends EditorHexHost {
  close(): void;
  /** Draw the editor again (after the work mode changed). */
  rerender(): void;
}

export class MapsStrip extends EditorPart<MapsStripHost> {
  private close(): void {
    this.host.close();
  }

  /** Menus here: debug mode, and the God offer on God-only items. */
  private modeMenuOptions(): ModeMenuOptions {
    return { store: this.app, onGod: () => { this.plugin.setMapWorkMode(this.mapName, "god"); this.host.rerender(); } };
  }

  /**
   * "Maps" strip: the hex's region chip first (accent outline), then a
   * chip per location (scrolls sideways), then "+" (new map, link existing,
   * manage locations). Hidden when the hex has no maps and the host can't
   * make any.
   */
  renderMapsStrip(container: HTMLElement): void {
    const { regionMap, locations } = getHexMapsFromFile(this.app, this.plugin.hexPath(this.x, this.y, this.mapName));
    const locs = locations.filter((l) => l !== regionMap);
    if (!regionMap && !locs.length && !this.options.onNewChildMap) return;
    const strip = container.createDiv({ cls: "duckmage-maps-strip" });
    strip.createSpan({ cls: "duckmage-maps-strip-label", text: "Maps" });
    const chips = strip.createDiv({ cls: "duckmage-maps-strip-chips" });
    const chip = (name: string, kind: "region" | "location") => {
      const exists = !!this.plugin.getMap(name);
      const label = this.plugin.mapLabel(name);
      const c = chips.createEl("button", {
        cls: `duckmage-maps-chip duckmage-maps-chip--${kind}${exists ? "" : " is-missing"}`,
        text: label,
        attr: { title: exists ? `${kind === "region" ? "Region" : "Location"}: ${label}` : `No map named ${name}` },
      });
      c.disabled = !exists;
      c.addEventListener("click", () => {
        this.close();
        this.options.onSwitchMap?.(name);
      });
    };
    if (regionMap) chip(regionMap, "region");
    for (const l of locs) chip(l, "location");
    if (!regionMap && !locs.length) chips.createSpan({ cls: "duckmage-maps-strip-empty", text: "None yet" });
    if (!this.options.onNewChildMap) return;
    const add = strip.createEl("button", { cls: "duckmage-maps-chip-add", text: "+", attr: { "aria-label": "Add a map to this hex", title: "New map from this hex, link one, or manage locations" } });
    add.addEventListener("click", (e) => {
      const { x, y } = this;
      const menu = new ModeMenu(workModeOf(this.plugin.getMap(this.mapName)), this.modeMenuOptions());
      menu.add("editor.new-map", newMapItemTitle({ regionMap, locations: locs }), "plus", () => { this.close(); this.options.onNewChildMap?.(x, y); });
      if (this.options.onLinkExistingMap) {
        menu.add("editor.link-map", "Link existing map…", "link", () => { this.close(); this.options.onLinkExistingMap?.(x, y); });
      }
      if (locs.length && this.options.onManageLocations) {
        menu.add("editor.manage-locations", `Manage locations (${locs.length})…`, "list", () => { this.close(); this.options.onManageLocations?.(x, y); });
      }
      menu.showAtMouseEvent(e);
    });
  }
}
