import type { App } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import { exportMapAsPng } from "./mapPngRenderer";
import { exportMapAsPdf, HANDOUT_COLUMNS } from "./exporters/mapWithTable";
import { MANUAL_PARTS } from "./manual/manualModel";
import { exportMapAsManual } from "./exporters/hexcrawlManual";
import { mapExportFileNames, mapExportStem, mapExportSuffix } from "./exportNames";

/**
 * The map export form: PNG, PDF with reference table, hexcrawl manual.
 * Shared by Maps → Export and the "Export current map…" command
 * (MapExportModal), so both look and behave the same.
 */

let nextFieldId = 0;

/** A checkbox whose label is a real <label for>: clicking the text toggles it and fires "change". */
function checkbox(parent: HTMLElement, labelText: string, initial: boolean, hint?: string): HTMLInputElement {
  const row = parent.createDiv({ cls: "duckmage-export-tab-row" });
  const id = `duckmage-export-field-${nextFieldId++}`;
  const cb = row.createEl("input", { type: "checkbox", cls: "duckmage-export-tab-checkbox", attr: { id } });
  cb.checked = initial;
  row.createEl("label", { text: labelText, cls: "duckmage-export-tab-label", attr: { for: id } });
  if (hint) row.createDiv({ cls: "duckmage-export-tab-row-hint", text: hint });
  return cb;
}

/** A small checkbox for a row of options; the label wraps it, so its text toggles it. */
function inlineCheck(parent: HTMLElement, labelText: string, initial: boolean, title?: string): HTMLInputElement {
  const label = parent.createEl("label", { attr: title ? { title } : {} });
  const cb = label.createEl("input", { type: "checkbox", cls: "duckmage-export-tab-checkbox" });
  cb.checked = initial;
  label.appendText(labelText);
  return cb;
}

function clampInt(v: number, lo: number, hi: number, fallback: number): number {
  if (Number.isNaN(v)) return fallback;
  return Math.max(lo, Math.min(hi, v));
}

export interface MapExportFormOptions {
  /** Offer a map picker (the command can export any map). */
  chooseMap?: boolean;
  /** Called after an export starts (the host modal closes). */
  onExport?: () => void;
}

export function renderMapExportForm(
  el: HTMLElement,
  plugin: HexmakerPlugin,
  initialMap: string,
  form: MapExportFormOptions = {},
): void {
  el.empty();
  el.addClass("duckmage-export-tab");
  let mapName = initialMap;

  const hint = el.createEl("p", { cls: "duckmage-export-tab-hint" });
  const setHint = () =>
    hint.setText(`Export the map "${plugin.mapLabel(mapName)}". Files go to the export folder and open in a new tab.`);
  setHint();

  const optsForm = el.createDiv({ cls: "duckmage-export-tab-options" });

  let nameInput: HTMLInputElement;
  if (form.chooseMap && plugin.settings.maps.length > 1) {
    const mapRow = optsForm.createDiv({ cls: "duckmage-export-tab-row" });
    const id = `duckmage-export-field-${nextFieldId++}`;
    mapRow.createEl("label", { text: "Map", cls: "duckmage-export-tab-label", attr: { for: id } });
    const mapSelect = mapRow.createEl("select", { cls: "duckmage-export-tab-select", attr: { id } });
    for (const m of plugin.settings.maps) mapSelect.createEl("option", { value: m.name, text: plugin.mapLabel(m.name) });
    mapSelect.value = mapName;
    mapSelect.addEventListener("change", () => {
      // A name still equal to the old map's follows the new map.
      if (nameInput.value.trim() === mapName) nameInput.value = mapSelect.value;
      mapName = mapSelect.value;
      nameInput.placeholder = mapName;
      setHint();
      updatePreview();
    });
  }

  // File name: defaults to the map name; overlay suffixes are added (see
  // mapExportStem) so successive variants don't overwrite each other.
  const nameRow = optsForm.createDiv({ cls: "duckmage-export-tab-row" });
  const nameId = `duckmage-export-field-${nextFieldId++}`;
  nameRow.createEl("label", { text: "File name", cls: "duckmage-export-tab-label", attr: { for: nameId } });
  nameInput = nameRow.createEl("input", {
    type: "text",
    cls: "duckmage-export-tab-text",
    attr: { placeholder: mapName, id: nameId },
  });
  nameInput.value = mapName;
  // The overlay suffix the files get, right after the box, so what's typed
  // plus this reads as the "Writes:" names (fresh-eyes r5).
  const suffixEl = nameRow.createSpan({ cls: "duckmage-export-name-suffix" });

  // What goes on the map images: one compact group of toggles (X1).
  const layers = optsForm.createDiv({ cls: "duckmage-export-group" });
  layers.createDiv({ cls: "duckmage-export-group-title", text: "On the map" });
  const layerRow = layers.createDiv({ cls: "duckmage-export-inline" });
  const showCoords = inlineCheck(layerRow, "Coordinates", true);
  const showIcons = inlineCheck(layerRow, "Icons", true);
  const showPaths = inlineCheck(layerRow, "Paths", true);
  const showHexNames = inlineCheck(layerRow, "Hex names", true);
  const showTokens = inlineCheck(layerRow, "Tokens", true, "Tokens and their names. Hidden tokens are never drawn.");
  const showFactionOverlay = inlineCheck(layerRow, "Faction overlay", false,
    "Tints hexes by faction and lists the faction names: leave off if players shouldn't know them.");
  const showRegionOverlay = inlineCheck(layerRow, "Region overlay", false,
    "Tints hexes by region and labels each region by name.");

  // What goes into the PDF's reference table.
  const columnsBox = optsForm.createEl("details", { cls: "duckmage-export-group" });
  columnsBox.createEl("summary", { text: "PDF table columns" });
  const columnsRow = columnsBox.createDiv({ cls: "duckmage-export-inline" });
  const columnChecks = HANDOUT_COLUMNS.map((c) => ({ key: c.key, cb: inlineCheck(columnsRow, c.label, true) }));

  // The hexcrawl manual's edition and optional parts.
  const manualBox = optsForm.createEl("details", { cls: "duckmage-export-group" });
  manualBox.createEl("summary", { text: "Hexcrawl manual" });
  const playerEdition = checkbox(manualBox, "Player version (leave out the hidden and secret sections)", false);
  const partsRow = manualBox.createDiv({ cls: "duckmage-export-inline" });
  const partChecks = MANUAL_PARTS.map((p) => ({ key: p.key, cb: inlineCheck(partsRow, p.label, true) }));

  // Output size: presets of hex radius (the image size also depends on the grid).
  const sizeRow = optsForm.createDiv({ cls: "duckmage-export-tab-row" });
  const sizeId = `duckmage-export-field-${nextFieldId++}`;
  sizeRow.createEl("label", { text: "Output size", cls: "duckmage-export-tab-label", attr: { for: sizeId } });
  const sizeSelect = sizeRow.createEl("select", { cls: "duckmage-export-tab-select", attr: { id: sizeId } });
  for (const preset of [
    { label: "Small (30px hexes — quick preview)", radius: 30 },
    { label: "Medium (50px hexes — standard)", radius: 50 },
    { label: "Large (80px hexes — print quality)", radius: 80 },
    { label: "Huge (120px hexes — max detail)", radius: 120 },
  ]) {
    const opt = sizeSelect.createEl("option", { text: preset.label, value: String(preset.radius) });
    if (preset.radius === 50) opt.selected = true;
  }

  // What players would see: the map images never carry GM content.
  const included = el.createDiv({ cls: "duckmage-export-included" });
  included.createDiv({ cls: "duckmage-export-included-title", text: "What's in each file" });
  const list = included.createEl("ul");
  list.createEl("li", {
    text: "PNG: the map with what you tick under On the map (the faction and region overlays print their names). " +
      "Never game master icons, hidden tokens or any note text (description, hidden, secret), so it's safe to hand to players.",
  });
  list.createEl("li", {
    text: "PDF with reference table: that map, then a table per section with the columns you tick (name, linked notes, the start of the description…); no hidden or secret sections.",
  });
  list.createEl("li", {
    text: "Hexcrawl manual: the full game master gazetteer with the parts you tick, hidden and secret sections included, unless you tick the player version.",
  });

  // The exact file names each button writes (shared with the exporters' naming).
  const preview = el.createDiv({ cls: "duckmage-export-tab-preview" });
  const names = () => mapExportFileNames({
    base: nameInput.value,
    mapName,
    showFactionOverlay: showFactionOverlay.checked,
    showRegionOverlay: showRegionOverlay.checked,
    player: playerEdition.checked,
  });
  const updatePreview = () => {
    const n = names();
    const suffix = mapExportSuffix({ showFactionOverlay: showFactionOverlay.checked, showRegionOverlay: showRegionOverlay.checked });
    suffixEl.setText(suffix);
    suffixEl.toggle(!!suffix);
    suffixEl.setAttr("title", suffix ? "Added for the overlays you ticked, so each variant gets its own file" : null);
    preview.setText(`Writes: ${n.png} (PNG) · ${n.pdf} (PDF) · ${n.manual} (manual)`);
  };
  for (const input of [nameInput, showFactionOverlay, showRegionOverlay, playerEdition]) {
    input.addEventListener("input", updatePreview);
    input.addEventListener("change", updatePreview);
  }
  updatePreview();

  const collectOpts = () => ({
    outputName: mapExportStem({
      base: nameInput.value,
      mapName,
      showFactionOverlay: showFactionOverlay.checked,
      showRegionOverlay: showRegionOverlay.checked,
    }),
    hexRadius: clampInt(parseInt(sizeSelect.value, 10), 10, 200, 50),
    showCoords: showCoords.checked,
    showIcons: showIcons.checked,
    showPaths: showPaths.checked,
    showFactionOverlay: showFactionOverlay.checked,
    showRegionOverlay: showRegionOverlay.checked,
    showHexNames: showHexNames.checked,
    showTokens: showTokens.checked,
    columns: columnChecks.filter((c) => c.cb.checked).map((c) => c.key),
  });

  const actions = el.createDiv({ cls: "duckmage-export-tab-actions" });
  actions.createEl("button", { cls: "mod-cta", text: "Export PNG" }).addEventListener("click", () => {
    void exportMapAsPng(plugin, mapName, collectOpts());
    form.onExport?.();
  });
  actions.createEl("button", { cls: "mod-cta", text: "Export PDF with reference table" }).addEventListener("click", () => {
    void exportMapAsPdf(plugin, mapName, collectOpts());
    form.onExport?.();
  });
  // A printable gazetteer: legend, encounter tables, keyed hexes by
  // section, index. Uses its own print styling and hex numbering.
  actions.createEl("button", { cls: "mod-cta", text: "Export hexcrawl manual (PDF)" }).addEventListener("click", () => {
    const o = collectOpts();
    void exportMapAsManual(plugin, mapName, {
      outputName: names().manual.replace(/\.pdf$/, ""),
      player: playerEdition.checked,
      showIcons: o.showIcons,
      showPaths: o.showPaths,
      showFactionOverlay: o.showFactionOverlay,
      showRegionOverlay: o.showRegionOverlay,
      showHexNames: o.showHexNames,
      showTokens: o.showTokens,
      omit: partChecks.filter((p) => !p.cb.checked).map((p) => p.key),
    });
    form.onExport?.();
  });
}

/** "Export current map…": the export form on its own, for any map. */
export class MapExportModal extends HexmakerModal {
  constructor(app: App, private plugin: HexmakerPlugin, private mapName: string) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.titleEl.setText("Export map");
    this.contentEl.addClass("duckmage-region-modal");
    renderMapExportForm(this.contentEl, this.plugin, this.mapName, {
      chooseMap: true,
      onExport: () => this.close(),
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
