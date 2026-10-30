import { App } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { HexmakerModal } from "../HexmakerModal";
import { paletteColors, pathColors, readMapTerrain } from "../worldgen/generators";
import { drawPreview } from "../worldgen/preview";
import { hexKey } from "../hexKey";

/**
 * "Go to <region>?" when stepping past a map's edge onto a neighbouring
 * region: a preview of that region with the hex you'd arrive at outlined.
 */
export class RegionNavigateModal extends HexmakerModal {
  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private target: { map: string; x: number; y: number },
    private onGo: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    const { map: name, x, y } = this.target;
    const label = this.plugin.mapLabel(name);
    this.titleEl.setText(`Go to ${label}?`);
    const map = this.plugin.getMap(name);
    const { contentEl } = this;
    contentEl.addClass("duckmage-region-nav");
    contentEl.createEl("p", { text: `Hex ${x}, ${y} is in the neighbouring region "${label}".`, cls: "duckmage-map-origin-desc" });
    if (map) {
      const canvas = contentEl.createEl("canvas", { cls: "duckmage-region-nav-preview" });
      drawPreview(
        canvas,
        readMapTerrain(this.plugin, name),
        { cols: map.gridSize.cols, rows: map.gridSize.rows, offset: map.gridOffset, stagger: map.staggerOffset ?? this.plugin.settings.staggerOffset ?? "odd" },
        this.plugin.settings.hexOrientation,
        paletteColors(this.plugin, map.paletteName),
        undefined,
        this.plugin.paths.resolvedPathChains(name).map((p) => ({ type: p.typeName, hexes: p.hexes })),
        pathColors(this.plugin, this.plugin.mapPaletteName(name)),
        360,
        12,
        undefined,
        { mark: hexKey(x, y) },
      );
    }
    const go = this.footer({
      primary: { text: `Go to ${label}`, onClick: () => { this.close(); this.onGo(); } },
      cancel: { text: "Stay", onClick: () => this.close() },
    }).primary!;
    this.scope.register([], "Enter", () => {
      this.close();
      this.onGo();
      return false;
    });
    window.setTimeout(() => go.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
