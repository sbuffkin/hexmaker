/**
 * The Biome painter's palette (owner round 5): every biome the overworld can
 * paint, as tiles like the terrain painter's. Picking one arms the painter;
 * the hexes are then painted on the map, no modal per hex. "Custom (blank)"
 * (and any biome marked blank) is offered too.
 */

import { App } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import { createIconEl, getIconUrl } from "../utils";
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
    const grid = contentEl.createDiv({ cls: "duckmage-terrain-picker duckmage-terrain-picker-full duckmage-biome-palette" });
    if (!biomes.length) grid.createEl("p", { cls: "setting-item-description", text: "This overworld's palette has no terrain that stands for a biome." });
    for (const b of biomes) {
      const tile = grid.createDiv({
        cls: `duckmage-terrain-option${b.id === this.current ? " is-selected" : ""}`,
        attr: { title: biomeTileTitle(b), "data-biome": b.id, role: "button", tabindex: "0" },
      });
      const preview = tile.createDiv({ cls: "duckmage-terrain-preview" + (b.terrain ? "" : " duckmage-biome-blank-preview") });
      preview.setCssProps({ "--duckmage-bg": b.color });
      const entry = b.terrain ? palette.find((t) => t.name === b.terrain) : undefined;
      if (entry?.icon) createIconEl(preview, getIconUrl(this.plugin, entry.icon), b.label, entry.iconColor, "duckmage-terrain-preview-icon");
      tile.createSpan({ text: b.label, cls: "duckmage-terrain-option-name" });
      const pick = () => {
        this.close();
        this.onPick(b.id);
      };
      tile.addEventListener("click", pick);
      tile.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
      });
    }
    const row = contentEl.createDiv({ cls: "duckmage-token-modal-buttons" });
    row.createEl("button", { text: "Biomes…", attr: { title: "Add your own biomes, or edit these" } }).addEventListener("click", () => {
      this.close();
      new BiomeLibraryModal(this.app, this.plugin, this.overworld).open();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
