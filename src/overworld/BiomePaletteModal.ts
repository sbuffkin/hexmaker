/**
 * The Biome painter's palette (owner round 5): every biome the overworld can
 * paint, as tiles like the terrain painter's. Picking one arms the painter;
 * the hexes are then painted on the map, no modal per hex. "Custom (blank)"
 * (and any biome marked blank) is offered too.
 */

import { App } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import { renderBiomeTiles } from "./biomeChooser";
import { biomeTileTitle, paintableBiomes } from "./BiomeModals";
import { BiomeLibraryModal } from "./BiomeLibraryModal";

/** The palette's one line of help (God is the work mode's name). */
const PAINT_HELP = "Click or drag over overworld hexes. A hex with no region gets this biome and its region. Changing a placed region's biome needs God, and only happens where the biome differs.";

export class BiomePaletteModal extends HexmakerModal {
  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private overworld: string,
    private current: string | null,
    private onPick: (biome: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    const { contentEl } = this;
    contentEl.addClass("duckmage-hex-editor");
    this.titleEl.setText("Paint biome");
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: PAINT_HELP,
    });
    const palette = this.plugin.getMapPalette(this.overworld);
    const biomes = paintableBiomes(this.plugin, this.overworld);
    if (!biomes.length) contentEl.createEl("p", { cls: "setting-item-description", text: "This overworld's palette has no terrain that stands for a biome." });
    // Grouped (Surface, Mountains, Water, Underground, Blank), with a filter box when long.
    renderBiomeTiles(contentEl, this.plugin, palette, biomes, {
      cls: "duckmage-terrain-picker duckmage-terrain-picker-full duckmage-biome-palette",
      isSelected: (id) => id === this.current,
      title: biomeTileTitle,
      onPick: (b) => {
        this.close();
        this.onPick(b.id);
      },
    });
    this.footer({
      secondary: [{ text: "Biomes…", title: "Add your own biomes, or edit these", onClick: () => {
        this.close();
        new BiomeLibraryModal(this.app, this.plugin, this.overworld).open();
      } }],
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
