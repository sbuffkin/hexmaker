import { App } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { TerrainColor } from "../types";
import { getIconUrl, createIconEl } from "../utils";
import { TerrainEntryEditorModal } from "./TerrainEntryEditorModal";

export class TerrainPickerModal extends HexmakerModal {
  private editMode = false;
  private editChanged = false;
  private selectionMade = false;
  private currentBrushSize: 1 | 3 | 7;

  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private palette: TerrainColor[],
    private onSelect: (terrainName: string | null) => void,
    private onPickMode?: () => void,
    private onDismiss?: () => void,
    brushSize: 1 | 3 | 7 = 1,
    private onBrushSizeChange?: (size: 1 | 3 | 7) => void,
  ) {
    super(app);
    this.currentBrushSize = brushSize;
  }

  onOpen(): void {
    this.makeDraggable();
    this.render();
  }

  onClose(): void {
    if (this.editChanged) {
      this.plugin.refreshHexMap();
    }
    if (!this.selectionMade) {
      this.onDismiss?.();
    }
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("duckmage-hex-editor");

    const header = contentEl.createDiv({ cls: "duckmage-tpe-header" });
    header.createEl("h2", {
      text: this.editMode ? "Edit terrain palette" : "Paint terrain",
    });
    const toggleBtn = header.createEl("button", {
      cls: "duckmage-tpe-edit-btn",
      text: this.editMode ? "← Done" : "✏ Edit",
    });
    toggleBtn.addEventListener("click", () => {
      this.editMode = !this.editMode;
      this.render();
    });

    if (this.editMode) {
      this.renderEditMode();
    } else {
      this.renderPickMode();
    }
  }

  private renderPickMode(): void {
    const { contentEl } = this;

    // Brush size selector
    const brushRow = contentEl.createDiv({ cls: "duckmage-tpe-brush-row" });
    brushRow.createSpan({ text: "Brush:", cls: "duckmage-tpe-brush-label" });
    for (const size of [1, 3, 7] as const) {
      const label = size === 1 ? "1×" : size === 3 ? "3×" : "7×";
      const btn = brushRow.createEl("button", {
        text: label,
        cls: "duckmage-tpe-brush-btn",
      });
      btn.toggleClass("is-active", this.currentBrushSize === size);
      btn.addEventListener("click", () => {
        this.currentBrushSize = size;
        this.onBrushSizeChange?.(size);
        brushRow
          .querySelectorAll<HTMLElement>(".duckmage-tpe-brush-btn")
          .forEach((b) => b.toggleClass("is-active", b.textContent === label));
      });
    }

    const section = contentEl.createDiv({ cls: "duckmage-editor-section" });
    const grid = section.createDiv({
      cls: "duckmage-terrain-picker duckmage-terrain-picker-full",
    });

    const eyeBtn = grid.createDiv({
      cls: "duckmage-terrain-option duckmage-terrain-option-eyedropper",
    });
    eyeBtn
      .createDiv({
        cls: "duckmage-terrain-preview duckmage-terrain-preview-eyedropper",
      })
      .setText("⌖");
    eyeBtn.createSpan({ text: "Pick", cls: "duckmage-terrain-option-name" });
    eyeBtn.addEventListener("click", () => {
      this.selectionMade = true;
      this.onPickMode?.();
      this.close();
    });

    const clearBtn = grid.createDiv({
      cls: "duckmage-terrain-option duckmage-terrain-option-clear",
    });
    clearBtn.createDiv({
      cls: "duckmage-terrain-preview duckmage-terrain-preview-clear",
    });
    clearBtn.createSpan({ text: "Clear", cls: "duckmage-terrain-option-name" });
    clearBtn.addEventListener("click", () => {
      this.selectionMade = true;
      this.onSelect(null);
      this.close();
    });

    for (const entry of this.palette) {
      const btn = grid.createDiv({ cls: "duckmage-terrain-option" });
      const preview = btn.createDiv({ cls: "duckmage-terrain-preview" });
      preview.setCssProps({ 'background-color': entry.color });
      if (entry.icon) {
        createIconEl(preview, getIconUrl(this.plugin, entry.icon), entry.name, entry.iconColor, "duckmage-terrain-preview-icon");
      }
      btn.createSpan({ text: entry.name, cls: "duckmage-terrain-option-name" });
      btn.addEventListener("click", () => {
        this.selectionMade = true;
        this.onSelect(entry.name);
        this.close();
      });
    }
  }

  private renderEditMode(): void {
    const { contentEl } = this;
    const palette = this.palette;

    const grid = contentEl.createDiv({
      cls: "duckmage-terrain-picker duckmage-terrain-picker-full",
    });
    let dragSrcIndex = -1;

    const renderTiles = () => {
      grid.empty();

      for (let i = 0; i < palette.length; i++) {
        const entry = palette[i];
        const tile = grid.createDiv({
          cls: "duckmage-terrain-option duckmage-terrain-option-editable",
        });
        tile.draggable = true;

        // Grip handle — top-left
        tile.createSpan({ cls: "duckmage-terrain-edit-grip", text: "⠿" });

        // Edit pencil — decorative indicator that the tile is clickable
        tile.createSpan({ cls: "duckmage-terrain-edit-pencil", text: "✏" });

        // Click anywhere on the tile to open the editor
        tile.addEventListener("click", () => {
          new TerrainEntryEditorModal(
            this.app,
            this.plugin,
            palette,
            entry,
            () => { this.editChanged = true; renderTiles(); },
            () => { this.editChanged = true; renderTiles(); },
          ).open();
        });

        // Standard colored preview + icon (same as pick mode)
        const preview = tile.createDiv({ cls: "duckmage-terrain-preview" });
        preview.setCssProps({ 'background-color': entry.color });
        if (entry.icon) {
          createIconEl(preview, getIconUrl(this.plugin, entry.icon), entry.name, entry.iconColor, "duckmage-terrain-preview-icon");
        }
        tile.createSpan({
          text: entry.name,
          cls: "duckmage-terrain-option-name",
        });

        // Drag-to-reorder
        tile.addEventListener("dragstart", (e: DragEvent) => {
          dragSrcIndex = i;
          tile.addClass("duckmage-palette-dragging");
          e.dataTransfer?.setDragImage(tile, 0, 0);
        });
        tile.addEventListener("dragend", () => {
          tile.removeClass("duckmage-palette-dragging");
          grid
            .querySelectorAll(".duckmage-palette-drop-target")
            .forEach((el) =>
              el.classList.remove("duckmage-palette-drop-target"),
            );
        });
        tile.addEventListener("dragover", (e: DragEvent) => {
          e.preventDefault();
          grid
            .querySelectorAll(".duckmage-palette-drop-target")
            .forEach((el) =>
              el.classList.remove("duckmage-palette-drop-target"),
            );
          tile.addClass("duckmage-palette-drop-target");
        });
        tile.addEventListener("drop", (e: DragEvent) => {
          e.preventDefault();
          if (dragSrcIndex === -1 || dragSrcIndex === i) return;
          const [moved] = palette.splice(dragSrcIndex, 1);
          palette.splice(i, 0, moved);
          dragSrcIndex = -1;
          this.editChanged = true;
          void this.plugin.saveSettings().then(() => renderTiles());
        });
      }

      // "+" add tile at the end
      const addTile = grid.createDiv({
        cls: "duckmage-terrain-option duckmage-terrain-option-add",
      });
      addTile
        .createDiv({
          cls: "duckmage-terrain-preview duckmage-terrain-preview-add",
        })
        .setText("+");
      addTile.createSpan({ text: "Add", cls: "duckmage-terrain-option-name" });
      addTile.addEventListener("click", () => {
        new TerrainTemplatePickerModal(
          this.app,
          this.plugin,
          palette,
          (template) => {
            void (async () => {
            const newEntry: TerrainColor = template
              ? { ...template }
              : { name: "New", color: "#888888" };
            palette.push(newEntry);
            this.editChanged = true;
            await this.plugin.saveSettings();
            renderTiles();
            // Open editor with isNew=true so doSave creates tables under the final name
            // rather than scanning hexes for a rename.
            new TerrainEntryEditorModal(
              this.app,
              this.plugin,
              palette,
              newEntry,
              () => { this.editChanged = true; renderTiles(); },
              () => { this.editChanged = true; renderTiles(); },
              true,
            ).open();
            })();
          },
        ).open();
      });
    };

    renderTiles();

    // Debug: one-shot button to fix all hex encounter-table links on the current map
    const footer = contentEl.createDiv({ cls: "duckmage-tpe-edit-footer" });
    const refreshBtn = footer.createEl("button", {
      cls: "duckmage-tpe-refresh-btn",
      text: "Refresh all encounter table links",
      title:
        "Re-links every hex's encounters table section to match its current terrain",
    });
    refreshBtn.addEventListener("click", () => {
      void (async () => {
        refreshBtn.disabled = true;
        refreshBtn.setText("Refreshing…");
        await this.plugin.refreshAllTerrainEncounterLinks();
        refreshBtn.setText("Done");
      })();
    });
  }
}

/** Shown when the user clicks "+" — lets them pick a terrain from another palette as a template. */
class TerrainTemplatePickerModal extends HexmakerModal {
  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private currentPalette: TerrainColor[],
    private onPick: (template: TerrainColor | null) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("duckmage-hex-editor");
    contentEl.createEl("h3", { text: "Add terrain" });

    const blankBtn = contentEl.createEl("button", {
      cls: "duckmage-draw-btn mod-cta",
      text: "New blank",
    });
    blankBtn.addEventListener("click", () => { this.onPick(null); this.close(); });

    // Collect terrains from other palettes not already in this one
    const currentNames = new Set(this.currentPalette.map(t => t.name));
    const byPalette: { name: string; terrains: TerrainColor[] }[] = [];
    for (const pal of this.plugin.settings.terrainPalettes) {
      if (pal.terrains === this.currentPalette) continue;
      const available = pal.terrains.filter(t => !currentNames.has(t.name));
      if (available.length > 0) byPalette.push({ name: pal.name, terrains: available });
    }

    if (byPalette.length > 0) {
      contentEl.createEl("p", {
        text: "Or copy from an existing palette:",
        cls: "setting-item-description",
      });
      const list = contentEl.createDiv({ cls: "duckmage-terrain-template-list" });
      for (const { name: palName, terrains } of byPalette) {
        list.createDiv({ cls: "duckmage-terrain-template-group", text: palName });
        for (const t of terrains) {
          const row = list.createDiv({ cls: "duckmage-terrain-template-row" });
          const swatch = row.createSpan({ cls: "duckmage-terrain-template-swatch" });
          swatch.setCssProps({ background: t.color });
          row.createSpan({ text: t.name });
          row.addEventListener("click", () => { this.onPick(t); this.close(); });
        }
      }
    }

    this.makeDraggable();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
