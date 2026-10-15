import { App } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import { PALETTE_PRESETS, uniquePaletteName } from "./presets";
import { isKindEnabled } from "../mapKinds";

/**
 * "Add palette" chooser: install a built-in preset, copy an existing
 * palette, or start empty. The palette note is written by the settings sync.
 */
export class AddPaletteModal extends HexmakerModal {
  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private onAdded: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Add palette");
    this.makeDraggable();
    const { contentEl } = this;
    contentEl.addClass("duckmage-add-palette-modal");

    contentEl.createEl("h4", { text: "Presets" });
    const presetList = contentEl.createDiv({ cls: "duckmage-add-palette-list" });
    for (const preset of PALETTE_PRESETS.filter((p) => isKindEnabled(this.plugin.settings, p.kind))) {
      const installed = this.plugin.getPaletteByName(preset.name) !== undefined;
      this.option(
        presetList,
        installed ? `${preset.name} (another copy)` : preset.name,
        `${preset.terrains.length} terrains · ${preset.description}`,
        preset.terrains.map((t) => t.color),
        async () => {
          await this.plugin.installPalettePreset(preset.name);
        },
      );
    }

    const palettes = this.plugin.settings.terrainPalettes;
    if (palettes.length > 0) {
      contentEl.createEl("h4", { text: "Copy an existing palette" });
      const copyList = contentEl.createDiv({ cls: "duckmage-add-palette-list" });
      for (const pal of palettes) {
        this.option(
          copyList,
          `Copy of ${pal.name}`,
          `${pal.terrains.length} terrains`,
          pal.terrains.map((t) => t.color),
          async () => {
            palettes.push({
              name: uniquePaletteName(`${pal.name} copy`, palettes.map((p) => p.name)),
              terrains: pal.terrains.map((t) => ({ ...t })),
            });
            await this.plugin.saveSettings();
          },
        );
      }
    }

    contentEl.createEl("h4", { text: "Start from scratch" });
    const emptyList = contentEl.createDiv({ cls: "duckmage-add-palette-list" });
    this.option(emptyList, "Empty palette", "No terrains — add them from the terrain tool or the palette note.", [], async () => {
      palettes.push({ name: uniquePaletteName("New palette", palettes.map((p) => p.name)), terrains: [] });
      await this.plugin.saveSettings();
    });
  }

  private option(
    parent: HTMLElement,
    title: string,
    desc: string,
    swatches: string[],
    action: () => Promise<void>,
  ): void {
    const btn = parent.createEl("button", { cls: "duckmage-add-palette-option" });
    const text = btn.createDiv({ cls: "duckmage-add-palette-text" });
    text.createDiv({ text: title, cls: "duckmage-add-palette-title" });
    text.createDiv({ text: desc, cls: "duckmage-add-palette-desc" });
    if (swatches.length > 0) {
      const strip = btn.createDiv({ cls: "duckmage-add-palette-swatches" });
      for (const color of swatches.slice(0, 16)) {
        strip.createSpan({ cls: "duckmage-add-palette-swatch" }).setCssProps({ "--duckmage-bg": color });
      }
    }
    btn.addEventListener("click", () => {
      btn.disabled = true;
      void action().then(() => {
        this.close();
        this.onAdded();
      });
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
