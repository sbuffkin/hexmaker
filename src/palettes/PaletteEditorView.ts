import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { SubmapDefault, TerrainColor, TerrainPalette } from "../types";
import { VIEW_TYPE_PALETTE_EDITOR } from "../constants";
import { createIconEl, getIconUrl, iconLabel } from "../utils";
import { IconPickerModal } from "../hex-map/IconPickerModal";
import { fillTerrainTypeSelect } from "../terrainTypeSelect";
import { inferTerrainType, terrainTypeInfo } from "../terrainTypes";
import { AddPaletteModal } from "./AddPaletteModal";
import { fillPaletteSelect } from "./paletteOptions";
import { listGeneratorKinds, visibleKinds, type TerrainGeneratorKind } from "../worldgen/registry";
import { isSpacePalette } from "../mapKinds";
import { isImpassable, setImpassable, impassableByType } from "../impassable";

/**
 * Palette editor page: the "advanced view" of palette editing. One row per
 * terrain with every field (color, name, type, category, icon, tint),
 * drag-to-reorder, plus palette-level settings (child palette) and the
 * per-terrain Submap defaults. The quick editor on the map's terrain tool
 * stays as it is; both edit the same palette (and its note).
 */
export class PaletteEditorView extends ItemView {
  /** Palette shown; remembered across opens. */
  static paletteName: string | undefined;
  private query = "";
  private generators: TerrainGeneratorKind[] = [];
  private saveTimer: number | undefined;

  constructor(leaf: WorkspaceLeaf, private plugin: HexmakerPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_PALETTE_EDITOR;
  }

  getDisplayText(): string {
    return `Palette — ${this.palette()?.name ?? "editor"}`;
  }

  getIcon(): string {
    return "palette";
  }

  async onOpen(): Promise<void> {
    this.generators = await listGeneratorKinds(this.plugin);
    this.render();
  }

  async onClose(): Promise<void> {
    this.flushSave();
    this.contentEl.empty();
  }

  /** Show a palette (from settings, the terrain picker, or a command). */
  show(paletteName: string): void {
    PaletteEditorView.paletteName = paletteName;
    this.render();
  }

  /**
   * Palettes changed elsewhere (note edited by hand, map editor). Re-render
   * unless the user is typing here — their input would be lost.
   */
  refreshFromStore(): void {
    if (this.contentEl.contains(activeDocument.activeElement)) return;
    this.render();
  }

  private palette(): TerrainPalette | undefined {
    const all = this.plugin.settings.terrainPalettes;
    return all.find((p) => p.name === PaletteEditorView.paletteName) ?? all[0];
  }

  /** Coalesce rapid edits into one save (the palette note follows). */
  private save(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flushSave(), 400);
  }

  private flushSave(): void {
    if (this.saveTimer === undefined) return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    void this.plugin.saveSettings().then(() => this.plugin.refreshHexMap());
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("duckmage-palette-editor");
    const pal = this.palette();
    if (pal) PaletteEditorView.paletteName = pal.name;

    // ── Toolbar ──
    const bar = contentEl.createDiv({ cls: "duckmage-pe-toolbar" });
    const select = bar.createEl("select", { cls: "duckmage-pe-palette-select", attr: { "aria-label": "Palette" } });
    for (const p of this.plugin.settings.terrainPalettes) select.createEl("option", { value: p.name, text: p.name });
    select.value = pal?.name ?? "";
    select.addEventListener("change", () => this.show(select.value));
    bar.createEl("button", { text: "Add palette…" }).addEventListener("click", () => {
      const before = new Set(this.plugin.settings.terrainPalettes.map((p) => p.name));
      new AddPaletteModal(this.app, this.plugin, () => {
        const added = this.plugin.settings.terrainPalettes.find((p) => !before.has(p.name));
        if (added) this.show(added.name);
        else this.render();
      }).open();
    });
    if (pal) {
      bar.createEl("button", { text: "Open note" }).addEventListener("click", () => {
        const file = this.plugin.paletteStore.noteFor(pal.name);
        if (file) void this.app.workspace.getLeaf("tab").openFile(file);
        else new Notice("This palette's note hasn't been written yet.");
      });
    }
    const search = bar.createEl("input", {
      type: "search",
      cls: "duckmage-pe-search",
      attr: { placeholder: "Filter terrains…", "aria-label": "Filter terrains" },
    });
    search.value = this.query;

    if (!pal) {
      contentEl.createDiv({ cls: "duckmage-pe-empty", text: "No palettes yet — add one." });
      return;
    }

    // ── Terrains ──
    contentEl.createEl("h3", { text: `Terrains (${pal.terrains.length})` });
    const untyped = pal.terrains.filter((t) => !t.type).length;
    if (untyped) {
      const hint = contentEl.createDiv({ cls: "duckmage-pe-hint" });
      hint.createSpan({ text: `${untyped} terrain${untyped === 1 ? " has" : "s have"} no type. ` });
      hint.createEl("button", { text: "Guess types from names" }).addEventListener("click", () => {
        let n = 0;
        for (const t of pal.terrains) {
          if (t.type) continue;
          const guess = inferTerrainType(t.name, t.category);
          if (guess) { t.type = guess; n++; }
        }
        new Notice(n ? `Typed ${n} terrain${n === 1 ? "" : "s"} — check the guesses.` : "No confident guesses.");
        this.save();
        this.render();
      });
    }
    const table = contentEl.createEl("table", { cls: "duckmage-pe-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const h of ["", "Color", "Name", "Type", "Category", "Icon", "Icon tint", "Impassable", ""]) {
      const th = head.createEl("th", { text: h });
      if (h === "Impassable") th.title = "Auto-routed paths (path tool) go around impassable terrain. Water types are impassable unless you untick them.";
    }
    const body = table.createEl("tbody");
    const categories = [...new Set(pal.terrains.map((t) => t.category).filter((c): c is string => !!c))].sort();
    const dl = contentEl.createEl("datalist", { attr: { id: "duckmage-pe-categories" } });
    for (const c of categories) dl.createEl("option", { value: c });

    const applyFilter = () => {
      const q = this.query.trim().toLowerCase();
      body.querySelectorAll<HTMLElement>("tr[data-name]").forEach((tr) => {
        const t = pal.terrains[Number(tr.dataset.index)];
        const hay = `${t.name} ${t.category ?? ""} ${terrainTypeInfo(t.type)?.label ?? t.type ?? ""}`.toLowerCase();
        tr.toggle(!q || hay.includes(q));
      });
    };
    search.addEventListener("input", () => { this.query = search.value; applyFilter(); });

    let dragFrom = -1;
    pal.terrains.forEach((t, i) => this.terrainRow(body, pal, t, i, () => dragFrom, (v) => { dragFrom = v; }));
    applyFilter();

    const addRow = contentEl.createDiv({ cls: "duckmage-pe-add-row" });
    addRow.createEl("button", { text: "Add terrain" }).addEventListener("click", () => {
      let name = "new terrain";
      for (let n = 2; pal.terrains.some((t) => t.name === name); n++) name = `new terrain ${n}`;
      pal.terrains.push({ name, color: "#888888" });
      this.flushSave();
      void this.plugin.saveSettings().then(() => this.plugin.ensureTerrainTables());
      this.render();
      const inputs = this.contentEl.querySelectorAll<HTMLInputElement>(".duckmage-pe-name");
      const last = inputs[inputs.length - 1];
      last?.focus();
      last?.select();
    });

    // ── Palette settings ──
    contentEl.createEl("h3", { text: "Palette settings" });
    const childRow = contentEl.createDiv({ cls: "duckmage-pe-field" });
    childRow.createEl("label", { text: "Submap palette" });
    const childSelect = childRow.createEl("select");
    fillPaletteSelect(this.plugin, childSelect, pal.childPalette);
    const sameOpt = createEl("option", { value: "", text: "Same as this palette" });
    childSelect.prepend(sameOpt);
    childSelect.value = pal.childPalette ?? "";
    childRow.createDiv({
      cls: "setting-item-description",
      text: "Palette suggested for new submaps of maps using this palette (per-terrain defaults below win).",
    });
    childSelect.addEventListener("change", () => {
      if (childSelect.value) pal.childPalette = childSelect.value;
      else delete pal.childPalette;
      this.save();
    });

    // ── Submap defaults ──
    this.renderSubmapDefaults(contentEl, pal);
  }

  private terrainRow(
    body: HTMLElement,
    pal: TerrainPalette,
    t: TerrainColor,
    index: number,
    getDrag: () => number,
    setDrag: (i: number) => void,
  ): void {
    const tr = body.createEl("tr", { attr: { "data-name": t.name, "data-index": String(index) } });
    tr.draggable = true;

    const handle = tr.createEl("td", { cls: "duckmage-pe-handle", text: "⠿", attr: { title: "Drag to reorder" } });
    handle.setAttr("aria-label", "Drag to reorder");
    tr.addEventListener("dragstart", (e) => { setDrag(index); tr.addClass("is-dragging"); e.dataTransfer?.setData("text/plain", String(index)); });
    tr.addEventListener("dragend", () => tr.removeClass("is-dragging"));
    tr.addEventListener("dragover", (e) => { e.preventDefault(); tr.addClass("is-drop-target"); });
    tr.addEventListener("dragleave", () => tr.removeClass("is-drop-target"));
    tr.addEventListener("drop", (e) => {
      e.preventDefault();
      const from = getDrag();
      if (from < 0 || from === index) return;
      const [moved] = pal.terrains.splice(from, 1);
      pal.terrains.splice(index, 0, moved);
      this.save();
      this.render();
    });

    // Color
    const color = tr.createEl("td").createEl("input", { type: "color", attr: { "aria-label": `${t.name} color` } });
    color.value = /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : "#888888";
    let paintIcon = () => {};
    color.addEventListener("input", () => { t.color = color.value; paintIcon(); this.save(); });

    // Name (renames cascade to hex notes and terrain tables on commit)
    const name = tr.createEl("td").createEl("input", { type: "text", cls: "duckmage-pe-name", attr: { "aria-label": "Terrain name" } });
    name.value = t.name;
    const commitName = () => {
      const next = name.value.trim();
      if (!next || next === t.name) { name.value = t.name; return; }
      if (pal.terrains.some((o) => o !== t && o.name === next)) {
        new Notice(`A terrain named "${next}" already exists in this palette.`);
        name.value = t.name;
        return;
      }
      // Fill an empty type from the new name ("dark forest" → forest).
      if (!t.type) t.type = inferTerrainType(next, t.category);
      void this.plugin.renameTerrain(t, next).then(() => this.render());
    };
    name.addEventListener("change", commitName);
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") name.blur(); });

    // Type
    const type = tr.createEl("td").createEl("select", { attr: { "aria-label": `${t.name} type` } });
    fillTerrainTypeSelect(type, this.plugin.settings, t.type);
    if (!t.type) type.addClass("is-unset");
    type.addEventListener("change", () => {
      if (type.value) t.type = type.value;
      else delete t.type;
      type.toggleClass("is-unset", !t.type);
      this.save();
    });

    // Category
    const cat = tr.createEl("td").createEl("input", {
      type: "text",
      attr: { list: "duckmage-pe-categories", placeholder: "—", "aria-label": `${t.name} category` },
    });
    cat.value = t.category ?? "";
    cat.addEventListener("change", () => {
      const v = cat.value.trim();
      if (v) t.category = v;
      else delete t.category;
      this.save();
    });

    // Icon
    const iconCell = tr.createEl("td");
    const iconBtn = iconCell.createEl("button", { cls: "duckmage-pe-icon", attr: { title: t.icon ? iconLabel(t.icon) : "Choose icon" } });
    paintIcon = () => {
      iconBtn.empty();
      iconBtn.setCssProps({ "--duckmage-pe-fill": t.color });
      if (t.icon) createIconEl(iconBtn, getIconUrl(this.plugin, t.icon), iconLabel(t.icon), t.iconColor, "duckmage-pe-icon-img");
      else iconBtn.setText("—");
    };
    paintIcon();
    iconBtn.addEventListener("click", () => {
      new IconPickerModal(this.app, this.plugin, (icon) => {
        if (icon) t.icon = icon;
        else delete t.icon;
        this.save();
        this.render();
      }).open();
    });

    // Tint
    const tintCell = tr.createEl("td", { cls: "duckmage-pe-tint" });
    const tintOn = tintCell.createEl("input", { type: "checkbox", attr: { "aria-label": "Tint icon" } });
    tintOn.checked = !!t.iconColor;
    const tint = tintCell.createEl("input", { type: "color", attr: { "aria-label": "Icon tint" } });
    tint.value = t.iconColor && /^#[0-9a-f]{6}$/i.test(t.iconColor) ? t.iconColor : "#ffffff";
    tint.disabled = !t.iconColor;
    tintOn.addEventListener("change", () => {
      if (tintOn.checked) t.iconColor = tint.value;
      else delete t.iconColor;
      tint.disabled = !tintOn.checked;
      paintIcon();
      this.save();
    });
    tint.addEventListener("input", () => { if (tintOn.checked) { t.iconColor = tint.value; paintIcon(); this.save(); } });

    // Impassable (path tool auto-route); unset follows the type's default.
    const blockCell = tr.createEl("td", { cls: "duckmage-pe-impassable" });
    const block = blockCell.createEl("input", { type: "checkbox", attr: { "aria-label": `${t.name} impassable` } });
    block.checked = isImpassable(t);
    block.title = t.impassable === undefined
      ? `Default for its type (${impassableByType(t.type) ? "impassable" : "passable"})`
      : "Set for this terrain";
    block.addEventListener("change", () => {
      setImpassable(t, block.checked);
      this.save();
    });

    // Delete (two clicks)
    const del = tr.createEl("td").createEl("button", { cls: "duckmage-pe-delete", text: "×", attr: { title: "Delete terrain", "aria-label": `Delete ${t.name}` } });
    del.addEventListener("click", () => {
      if (!del.hasClass("is-armed")) {
        del.addClass("is-armed");
        del.setText("Delete?");
        window.setTimeout(() => { del.removeClass("is-armed"); del.setText("×"); }, 3000);
        return;
      }
      pal.terrains.splice(pal.terrains.indexOf(t), 1);
      if (pal.submapDefaults?.[t.name]) delete pal.submapDefaults[t.name];
      this.save();
      this.render();
    });
  }

  private renderSubmapDefaults(contentEl: HTMLElement, pal: TerrainPalette): void {
    contentEl.createEl("h3", { text: "Submap defaults" });
    contentEl.createDiv({
      cls: "setting-item-description",
      text: "When you make a submap from a hex of one of these terrains, the new-submap window starts with these choices. Tick \"Default for …\" there to add rows from real use.",
    });
    const defaults = pal.submapDefaults ?? {};
    const table = contentEl.createEl("table", { cls: "duckmage-pe-table duckmage-pe-defaults" });
    const head = table.createEl("thead").createEl("tr");
    for (const h of ["Terrain", "Palette", "Size", "Generator", "Options", "Base terrain", ""]) head.createEl("th", { text: h });
    const body = table.createEl("tbody");

    const update = (terrain: string, patch: (d: SubmapDefault) => void) => {
      const next = { ...(pal.submapDefaults ?? {}) };
      const d = { ...(next[terrain] ?? {}) };
      patch(d);
      next[terrain] = d;
      pal.submapDefaults = next;
      this.save();
    };

    for (const [terrain, d] of Object.entries(defaults)) {
      const tr = body.createEl("tr");
      tr.createEl("td", { text: terrain, cls: pal.terrains.some((t) => t.name === terrain) ? "" : "mod-warning" });

      const palSel = tr.createEl("td").createEl("select");
      fillPaletteSelect(this.plugin, palSel, d.palette);
      palSel.prepend(createEl("option", { value: "", text: "—" }));
      palSel.value = d.palette ?? "";
      palSel.addEventListener("change", () => update(terrain, (x) => { if (palSel.value) x.palette = palSel.value; else delete x.palette; }));

      const sizeTd = tr.createEl("td", { cls: "duckmage-pe-size" });
      const cols = sizeTd.createEl("input", { type: "number", attr: { min: "1", max: "200", placeholder: "—", "aria-label": "Columns" } });
      sizeTd.createSpan({ text: "×" });
      const rows = sizeTd.createEl("input", { type: "number", attr: { min: "1", max: "200", placeholder: "—", "aria-label": "Rows" } });
      cols.value = d.cols ? String(d.cols) : "";
      rows.value = d.rows ? String(d.rows) : "";
      const onSize = () => update(terrain, (x) => {
        const c = Number(cols.value), r = Number(rows.value);
        if (c > 0 && r > 0) { x.cols = c; x.rows = r; } else { delete x.cols; delete x.rows; }
      });
      cols.addEventListener("change", onSize);
      rows.addEventListener("change", onSize);

      const genSel = tr.createEl("td").createEl("select");
      genSel.createEl("option", { value: "", text: "—" });
      // Space generators while Space is off: only for a space palette or a
      // space submap palette (or the saved value).
      const spaceContext = isSpacePalette(pal.terrains)
        || (!!d.palette && isSpacePalette(this.plugin.getPaletteOrPresetTerrains(d.palette)));
      for (const g of visibleKinds(this.generators, this.plugin.settings, spaceContext, d.generator)) {
        genSel.createEl("option", { value: g.id, text: g.label });
      }
      if (d.generator && !this.generators.some((g) => g.id === d.generator)) {
        genSel.createEl("option", { value: d.generator, text: `${d.generator} (not available)` });
      }
      genSel.value = d.generator ?? "";
      genSel.addEventListener("change", () => update(terrain, (x) => { if (genSel.value) x.generator = genSel.value; else delete x.generator; }));

      const opts = tr.createEl("td").createEl("input", { type: "text", attr: { placeholder: "Key=value; key=value", "aria-label": "Generator options" } });
      opts.value = d.options ? Object.entries(d.options).map(([k, v]) => `${k}=${v}`).join("; ") : "";
      opts.addEventListener("change", () => update(terrain, (x) => {
        const parsed: Record<string, string> = {};
        for (const part of opts.value.split(/[;,]/)) {
          const m = /^\s*([^=]+?)\s*=\s*(.*?)\s*$/.exec(part);
          if (m) parsed[m[1]] = m[2];
        }
        if (Object.keys(parsed).length) x.options = parsed; else delete x.options;
      }));

      const base = tr.createEl("td").createEl("input", { type: "text", attr: { placeholder: "—", "aria-label": "Base terrain" } });
      base.value = d.baseTerrain ?? "";
      base.addEventListener("change", () => update(terrain, (x) => { if (base.value.trim()) x.baseTerrain = base.value.trim(); else delete x.baseTerrain; }));

      const del = tr.createEl("td").createEl("button", { cls: "duckmage-pe-delete", text: "×", attr: { "aria-label": `Remove default for ${terrain}` } });
      del.addEventListener("click", () => {
        const next = { ...(pal.submapDefaults ?? {}) };
        delete next[terrain];
        if (Object.keys(next).length) pal.submapDefaults = next;
        else delete pal.submapDefaults;
        this.save();
        this.render();
      });
    }

    const free = pal.terrains.filter((t) => !defaults[t.name]);
    if (free.length) {
      const add = contentEl.createDiv({ cls: "duckmage-pe-add-row" });
      const pick = add.createEl("select", { attr: { "aria-label": "Terrain to add a default for" } });
      for (const t of free) pick.createEl("option", { value: t.name, text: t.name });
      add.createEl("button", { text: "Add default" }).addEventListener("click", () => {
        update(pick.value, () => { /* empty row; fill in the cells */ });
        this.render();
      });
    }
  }
}
