import { App, Notice } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import { getIconUrl, createIconEl } from "../utils";
import { fillPaletteSelect } from "../palettes/paletteOptions";
import { defaultSubmapName } from "./submapNav";

export class SubmapPickerModal extends HexmakerModal {
  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private current: string | undefined,
    /** `created` is true when the map was just made in this modal. */
    private onLink: (mapName: string, created: boolean) => void,
    private onUnlink: () => void,
    /** The hex being linked. Enables the create-first layout: section open,
     *  auto-named `<parent>-x-y`, child palette pre-selected. */
    private origin?: { map: string; x: number; y: number },
    /** When set (single-hex use), "create" hands off to the new-submap setup
     *  modal (size, generator, preview) instead of the inline form. */
    private onNewSubmap?: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("duckmage-hex-editor");
    this.modalEl.addClass("duckmage-submap-picker-modal");
    this.makeDraggable();

    contentEl.createEl("h2", { text: "Link submap" });

    // ── Current submap indicator ──────────────────────────────────────────
    if (this.current) {
      const curRow = contentEl.createDiv({ cls: "duckmage-submap-current-row" });
      curRow.createSpan({ text: "Current: ", cls: "duckmage-submap-current-label" });
      curRow.createSpan({ text: this.current, cls: "duckmage-submap-current-value" });
    }

    // ── Link existing map ─────────────────────────────────────────────────
    const maps = this.plugin.settings.maps;
    let selectedMap = this.current ?? maps[0]?.name ?? "";

    if (maps.length > 0) {
      contentEl.createEl("h4", { text: "Link existing map" });

      const filterInput = contentEl.createEl("input", {
        type: "text",
        cls: "duckmage-rt-search",
        attr: { placeholder: "Filter maps…" },
      });

      const listEl = contentEl.createDiv({ cls: "duckmage-rt-list duckmage-picker-list" });

      const renderMapList = (query: string) => {
        listEl.empty();
        const q = query.trim().toLowerCase();
        const matches = maps.filter((m) => !q || m.name.toLowerCase().includes(q));
        if (matches.length === 0) {
          listEl.createDiv({ cls: "duckmage-picker-list-empty", text: "No matching maps" });
          return;
        }
        for (const m of matches) {
          const item = listEl.createDiv({
            cls: "duckmage-rt-list-item duckmage-map-list-item-row" + (m.name === selectedMap ? " is-active" : ""),
          });
          const terrainEntry = m.terrainType
            ? this.plugin.getMapPalette(m.name).find((t) => t.name === m.terrainType)
            : undefined;
          const swatch = item.createSpan({ cls: "duckmage-map-terrain-swatch" });
          if (terrainEntry?.color) {
            swatch.style.backgroundColor = terrainEntry.color;
            swatch.addClass("duckmage-map-terrain-swatch--set");
          }
          if (terrainEntry?.icon) {
            createIconEl(
              swatch,
              getIconUrl(this.plugin, terrainEntry.icon),
              terrainEntry.name,
              terrainEntry.iconColor,
              "duckmage-map-terrain-swatch-icon",
            );
          }
          item.createSpan({ text: this.plugin.mapLabel(m.name) });
          item.addEventListener("click", () => {
            selectedMap = m.name;
            listEl.querySelectorAll<HTMLElement>(".duckmage-rt-list-item").forEach((el) =>
              el.removeClass("is-active"),
            );
            item.addClass("is-active");
          });
        }
      };

      renderMapList("");
      filterInput.addEventListener("input", () => renderMapList(filterInput.value));
    }

    if (this.onNewSubmap) {
      const newRow = contentEl.createDiv({ cls: "duckmage-submap-new-row" });
      const newBtn = newRow.createEl("button", { text: "New submap…", cls: maps.length ? "" : "mod-cta" });
      newRow.createSpan({ cls: "setting-item-description", text: "Choose size, palette and a generator, then go straight in." });
      newBtn.addEventListener("click", () => { this.close(); this.onNewSubmap?.(); });
      this.renderButtons(contentEl, maps.length > 0, () => selectedMap);
      return;
    }

    // ── Create & link new map (collapsible) ──────────────────────────────
    const createSection = contentEl.createDiv({ cls: "duckmage-editor-collapsible" });
    const createHeader = createSection.createDiv({ cls: "duckmage-editor-collapsible-header" });
    const createArrow = createHeader.createSpan({ cls: "duckmage-editor-collapsible-arrow", text: "▶" });
    createHeader.createEl("h4", { text: "Create & link new map", cls: "duckmage-editor-collapsible-title" });

    const createBody = createSection.createDiv({ cls: "duckmage-editor-collapsible-body" });
    // From a single hex with nothing linked yet, creating is the likely
    // intent — open the section instead of making the user find it.
    const createFirst = !!this.origin && !this.current;
    if (createFirst) createArrow.setText("▼");
    else createBody.hide();

    createHeader.addEventListener("click", () => {
      const open = createBody.isShown();
      createArrow.setText(open ? "▶" : "▼");
      if (open) createBody.hide(); else createBody.show();
    });

    // Name
    const nameRow = createBody.createDiv({ cls: "duckmage-submap-create-row" });
    nameRow.createSpan({ text: "Name", cls: "duckmage-submap-create-label" });
    const nameInput = nameRow.createEl("input", {
      type: "text",
      placeholder: "Map name",
      cls: "duckmage-submap-create-name",
    });
    if (this.origin) {
      nameInput.value = defaultSubmapName(
        this.origin.map, this.origin.x, this.origin.y,
        this.plugin.settings.maps.map((m) => m.name),
      );
    }

    // Size (cols × rows on one row)
    const sizeRow = createBody.createDiv({ cls: "duckmage-submap-create-row" });
    sizeRow.createSpan({ text: "Size", cls: "duckmage-submap-create-label" });
    const colsInput = sizeRow.createEl("input", { type: "number", value: String(this.plugin.settings.defaultSubmapCols ?? 10) });
    colsInput.setCssProps({ width: "55px" });
    sizeRow.createSpan({ text: "×", cls: "duckmage-submap-create-sep" });
    const rowsInput = sizeRow.createEl("input", { type: "number", value: String(this.plugin.settings.defaultSubmapRows ?? 10) });
    rowsInput.setCssProps({ width: "55px" });

    // Palette
    const paletteRow = createBody.createDiv({ cls: "duckmage-submap-create-row" });
    paletteRow.createSpan({ text: "Palette", cls: "duckmage-submap-create-label" });
    const paletteSelect = paletteRow.createEl("select", { cls: "duckmage-submap-create-palette" });
    fillPaletteSelect(
      this.plugin,
      paletteSelect,
      this.origin ? this.plugin.childPaletteFor(this.origin.map) : undefined,
    );

    // Starting coordinates
    const originRow = createBody.createDiv({ cls: "duckmage-submap-create-row" });
    originRow.createSpan({ text: "Start at", cls: "duckmage-submap-create-label" });
    const originXInput = originRow.createEl("input", { type: "number", value: "0" });
    originXInput.setCssProps({ width: "55px" });
    originRow.createSpan({ text: ",", cls: "duckmage-submap-create-sep" });
    const originYInput = originRow.createEl("input", { type: "number", value: "0" });
    originYInput.setCssProps({ width: "55px" });

    // Stagger offset
    const staggerRow = createBody.createDiv({ cls: "duckmage-submap-create-row" });
    staggerRow.createSpan({ text: "Stagger", cls: "duckmage-submap-create-label" });
    let staggerVal: "odd" | "even" = this.plugin.settings.staggerOffset ?? "odd";
    const staggerBtn = staggerRow.createEl("button", { cls: "duckmage-stagger-toggle" });
    staggerBtn.setText(staggerVal === "odd" ? "Odd" : "Even");
    staggerBtn.toggleClass("is-even", staggerVal === "even");
    staggerBtn.addEventListener("click", () => {
      staggerVal = staggerVal === "odd" ? "even" : "odd";
      staggerBtn.setText(staggerVal === "odd" ? "Odd" : "Even");
      staggerBtn.toggleClass("is-even", staggerVal === "even");
    });

    // Terrain type (updates when palette changes)
    createBody.createEl("h5", { text: "Map terrain theme", cls: "duckmage-submap-terrain-heading" });
    let selectedTerrainType: string | undefined;
    const terrainGrid = createBody.createDiv({ cls: "duckmage-terrain-picker" });

    const renderTerrainGrid = () => {
      terrainGrid.empty();
      selectedTerrainType = undefined;
      const palette = this.plugin.getPaletteOrPresetTerrains(paletteSelect.value);

      const noneTile = terrainGrid.createDiv({
        cls: "duckmage-terrain-option duckmage-terrain-option-clear is-selected",
      });
      noneTile.createDiv({ cls: "duckmage-terrain-preview duckmage-terrain-preview-clear" });
      noneTile.createSpan({ text: "None", cls: "duckmage-terrain-option-name" });
      noneTile.addEventListener("click", () => {
        selectedTerrainType = undefined;
        terrainGrid.querySelectorAll<HTMLElement>(".duckmage-terrain-option").forEach((el) =>
          el.removeClass("is-selected"),
        );
        noneTile.addClass("is-selected");
      });

      for (const t of palette) {
        const tile = terrainGrid.createDiv({ cls: "duckmage-terrain-option" });
        const preview = tile.createDiv({ cls: "duckmage-terrain-preview" });
        preview.setCssProps({ "--duckmage-bg": t.color });
        if (t.icon) {
          createIconEl(
            preview,
            getIconUrl(this.plugin, t.icon),
            t.name,
            t.iconColor,
            "duckmage-terrain-preview-icon",
          );
        }
        tile.createSpan({ text: t.name, cls: "duckmage-terrain-option-name" });
        tile.addEventListener("click", () => {
          selectedTerrainType = t.name;
          terrainGrid.querySelectorAll<HTMLElement>(".duckmage-terrain-option").forEach((el) =>
            el.removeClass("is-selected"),
          );
          tile.addClass("is-selected");
        });
      }
    };

    renderTerrainGrid();
    paletteSelect.addEventListener("change", renderTerrainGrid);

    // Create & link button
    const createLabel = this.origin ? "Create & enter" : "Create & link";
    const createBtn = createBody.createEl("button", {
      text: createLabel,
      cls: "mod-cta duckmage-submap-create-btn",
    });
    const allInputs: (HTMLInputElement | HTMLSelectElement)[] = [
      nameInput, colsInput, rowsInput, paletteSelect, originXInput, originYInput,
    ];
    createBtn.addEventListener("click", () =>
      void this.handleCreateAndLink(
        nameInput.value.trim(),
        Number(colsInput.value) || 10,
        Number(rowsInput.value) || 10,
        paletteSelect.value,
        selectedTerrainType,
        Number(originXInput.value) || 0,
        Number(originYInput.value) || 0,
        staggerVal,
        createBtn,
        allInputs,
      ),
    );

    this.renderButtons(contentEl, maps.length > 0, () => selectedMap);
  }

  /** Bottom button row: Remove link / Link existing / Cancel. */
  private renderButtons(contentEl: HTMLElement, hasMaps: boolean, selected: () => string): void {
    const bottomRow = contentEl.createDiv({ cls: "duckmage-token-modal-buttons" });
    if (hasMaps) {
      if (this.current) {
        bottomRow.createEl("button", { text: "Remove link", cls: "mod-warning" })
          .addEventListener("click", () => { this.close(); this.onUnlink(); });
      }
      bottomRow.createEl("button", { text: "Link", cls: "mod-cta" })
        .addEventListener("click", () => {
          this.close();
          this.onLink(selected(), false);
        });
    }
    bottomRow.createEl("button", { text: "Cancel" })
      .addEventListener("click", () => this.close());
  }

  private async handleCreateAndLink(
    raw: string,
    cols: number,
    rows: number,
    paletteName: string,
    terrainType: string | undefined,
    initialX: number,
    initialY: number,
    staggerOffset: "odd" | "even",
    btn: HTMLButtonElement,
    inputs: (HTMLInputElement | HTMLSelectElement)[],
  ): Promise<void> {
    btn.setText("Creating…");
    btn.disabled = true;
    for (const input of inputs) input.disabled = true;

    const result = await this.plugin.createNewMap(
      raw, cols, rows, paletteName, initialX, initialY, staggerOffset,
      (done, total) => btn.setText(`Creating ${done} / ${total}…`),
    );

    if ("error" in result) {
      new Notice(result.error);
      btn.setText(this.origin ? "Create & enter" : "Create & link");
      btn.disabled = false;
      for (const input of inputs) input.disabled = false;
      return;
    }

    if (terrainType) {
      const map = this.plugin.getMap(result.name);
      if (map) {
        map.terrainType = terrainType;
        await this.plugin.saveSettings();
      }
    }

    this.close();
    this.onLink(result.name, true);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
