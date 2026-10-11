/**
 * The overworld minimap: the preview page's small overworld (biome colours,
 * labels, white outlines on transition hexes, the river) in a corner of the
 * map view, on an overworld (in its regions view) and on each of its
 * regions, with the region you're in outlined. Click a hex to go there:
 * into its region, else to that hex on the overworld.
 */

import { setIcon } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { MapData } from "../types";
import { regionMapAt } from "../maps/submaps";
import { biomeInfo } from "../overworld/biomes";
import { drawMiniOverworld, miniHexAt, miniLayout, type MiniHex } from "../overworld/overworldRender";
import { ecotoneHexes, overworldBiomes, parseBiomeRiver } from "../overworld/regionWorld";
import { overworldOf, overworldTerrain, regionHome } from "../overworld/regionsVault";
import { OverworldLayer } from "./overworldLayer";

const W = 220, H = 180;

export interface MinimapHost {
  navigateToMap(name: string): void;
  /** Redraw the map (the overworld view changed). */
  redraw(): void;
  centerOnHex(x: number, y: number): void;
  activeMapName: string;
}

export class OverworldMinimap {
  private el: HTMLElement | null = null;

  constructor(private plugin: HexmakerPlugin, private host: MinimapHost) {}

  /** The overworld this map shows a minimap of, and the hex to outline. */
  private target(map: MapData): { overworld: MapData; here?: string; isOverworld: boolean } | null {
    const home = regionHome(this.plugin, map.name);
    if (home) return { overworld: home.overworld, here: `${home.px}_${home.py}`, isOverworld: false };
    if (overworldOf(this.plugin, map.name)) return { overworld: map, isOverworld: true };
    return null;
  }

  render(container: HTMLElement, map: MapData): void {
    this.el?.remove();
    this.el = null;
    const t = this.target(map);
    if (!t) return;
    const view = t.isOverworld ? OverworldLayer.viewOf(this.plugin, map) : null;
    // On the overworld in its biomes view the map IS the minimap: only the view switch shows.
    const collapsed = map.showMinimap === false || view === "biomes";
    const box = container.createDiv({ cls: "duckmage-ow-minimap" + (collapsed ? " is-collapsed" : "") });
    this.el = box;
    if (t.isOverworld) {
      const sw = box.createDiv({ cls: "duckmage-ow-view-toggle", attr: { role: "group", "aria-label": "Overworld view" } });
      sw.createSpan({ cls: "duckmage-ow-view-label", text: "View:" });
      for (const [id, label, tip] of [
        ["regions", "Regions", "Every region's hexes, stitched together (blank bricks where there's none yet). Click to enter a region; the terrain tool paints its hexes."],
        ["biomes", "Biomes", "One biome per hex. Click a hex to enter its region, or to set the biome of one with none yet. Right-click → Edit region… changes a placed one (God mode)."],
      ] as const) {
        const on = view === id;
        const b = sw.createEl("button", { text: label, cls: on ? "is-active" : "", attr: { title: on ? `${tip} (showing now)` : tip, "aria-pressed": on ? "true" : "false" } });
        b.addEventListener("click", () => {
          if (view === id) return;
          map.overworldView = id;
          void this.plugin.saveSettings();
          this.host.redraw();
        });
      }
      if (view === "biomes") return;
    }
    const head = box.createDiv({ cls: "duckmage-ow-minimap-head" });
    head.createSpan({ cls: "duckmage-ow-minimap-title", text: this.plugin.mapLabel(t.overworld.name) });
    const toggle = head.createEl("button", {
      cls: "clickable-icon duckmage-ow-minimap-toggle",
      attr: { "aria-label": collapsed ? "Show the overworld map" : "Hide the overworld map" },
    });
    setIcon(toggle, collapsed ? "map" : "minus");
    toggle.addEventListener("click", () => {
      map.showMinimap = collapsed ? true : false;
      void this.plugin.saveSettings();
      this.render(container, map);
    });
    if (collapsed) return;

    const ow = overworldOf(this.plugin, t.overworld.name)!;
    const palette = this.plugin.getMapPalette(t.overworld.name);
    const colour = new Map(palette.map((p) => [p.name, p.color]));
    const terrain = overworldTerrain(this.plugin, t.overworld);
    const biomes = overworldBiomes(terrain, palette, ow.layout.orientation, ow.layout.parentStagger);
    const eco = ecotoneHexes(biomes, ow.layout.orientation, ow.layout.parentStagger);
    const hexes: MiniHex[] = [];
    for (const [k, terr] of terrain) {
      const [x, y] = k.split("_").map(Number);
      const b = biomes.get(k);
      hexes.push({ x, y, color: colour.get(terr) ?? "#333", label: b ? biomeInfo(b)?.label : undefined, ecotone: eco.has(k) });
    }
    if (!hexes.length) { box.remove(); this.el = null; return; }
    const canvas = box.createEl("canvas", { cls: "duckmage-ow-minimap-canvas" });
    const dpr = activeWindow.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const l = miniLayout(hexes, ow.layout.orientation, ow.layout.parentStagger, W, H);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      drawMiniOverworld(ctx, l, hexes, parseBiomeRiver(t.overworld.biomeRiver), t.here);
    }
    canvas.addEventListener("mousemove", (e) => {
      const r = canvas.getBoundingClientRect();
      const h = miniHexAt(l, hexes, ((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H);
      const region = h ? regionMapAt(this.plugin.settings.maps, t.overworld.name, `${h.x}_${h.y}`) : undefined;
      canvas.title = region ? `${this.plugin.mapLabel(region.name)}: click to go there` : h ? `Hex ${h.x}, ${h.y}: click to show it on the overworld` : "";
    });
    canvas.addEventListener("click", (e) => {
      const r = canvas.getBoundingClientRect();
      const h = miniHexAt(l, hexes, ((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H);
      if (!h) return;
      const region = regionMapAt(this.plugin.settings.maps, t.overworld.name, `${h.x}_${h.y}`);
      if (region) {
        if (region.name !== this.host.activeMapName) this.host.navigateToMap(region.name);
        return;
      }
      if (this.host.activeMapName !== t.overworld.name) this.host.navigateToMap(t.overworld.name);
      window.setTimeout(() => this.host.centerOnHex(h.x, h.y), 50);
    });
  }

  clear(): void {
    this.el?.remove();
    this.el = null;
  }
}
