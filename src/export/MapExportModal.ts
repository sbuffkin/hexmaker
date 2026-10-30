import type { App } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import { exportMapAsPng } from "./mapPngRenderer";
import { exportMapAsPdf, HANDOUT_COLUMNS, handoutColumnLabel } from "./exporters/mapWithTable";
import {
  EXPORT_LAYER_KEYS,
  exportLayerDefaults,
  mapExportFileNames,
  mapExportStem,
  mapExportSuffix,
  type ExportLayerKey,
  type MapExportPrefs,
} from "./exportNames";
import { Disclosure, Fold } from "../ui/disclosure";
import { uniqueMapsByName } from "../maps/mapTree";
import { moduleExportForm, moduleFog } from "../modules/runtime";
import { inlineCheck } from "./exportFormControls";
import { pdfAvailable, PDF_UNAVAILABLE_MESSAGE } from "../platform";

/**
 * The map export form: PNG, PDF with reference table, and the modules'
 * parts (moduleExportForm).
 * Shared by Maps → Export and the "Export current map…" command
 * (MapExportModal), so both look and behave the same.
 */

let nextFieldId = 0;

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
  const mapName = initialMap;
  // Start from this map's last choices, else from what the map view shows (S9).
  const map = plugin.getMap(mapName);
  const prefs: MapExportPrefs = plugin.settings.mapExportPrefs?.[mapName] ?? {};
  const ticks = exportLayerDefaults({ ...map, showLegend: plugin.settings.showTerrainLegend }, prefs);

  // The form's Advanced dropdown, at its end.
  const disclosure = new Disclosure(plugin.app, "MapExport", () => el);

  const hint = el.createEl("p", { cls: "duckmage-export-tab-hint" });
  hint.setText(`Export the map "${plugin.mapLabel(mapName)}". Files go to the export folder and open in a tab; exporting again under the same name replaces the file.`);

  const optsForm = el.createDiv({ cls: "duckmage-export-tab-options" });

  let nameInput: HTMLInputElement;
  if (form.chooseMap && plugin.settings.maps.length > 1) {
    const mapRow = optsForm.createDiv({ cls: "duckmage-export-tab-row" });
    const id = `duckmage-export-field-${nextFieldId++}`;
    mapRow.createEl("label", { text: "Map", cls: "duckmage-export-tab-label", attr: { for: id } });
    const mapSelect = mapRow.createEl("select", { cls: "duckmage-export-tab-select", attr: { id } });
    for (const m of uniqueMapsByName(plugin.settings.maps)) mapSelect.createEl("option", { value: m.name, text: plugin.mapLabel(m.name) });
    mapSelect.value = mapName;
    // Another map: the form again, with that map's choices.
    mapSelect.addEventListener("change", () => renderMapExportForm(el, plugin, mapSelect.value, form));
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
  nameInput.value = prefs.fileName?.trim() || mapName;
  // The overlay suffix the files get, right after the box, so what's typed
  // plus this reads as the "Writes:" names (fresh-eyes r5).
  const suffixEl = nameRow.createSpan({ cls: "duckmage-export-name-suffix" });

  // A map under fog (being explored by revealing it, HF11): the whole map, or only what the party has seen.
  const fog = map ? moduleFog(plugin, map) : undefined;
  let asSeen: HTMLSelectElement | undefined;
  if (fog) {
    const fogRow = optsForm.createDiv({ cls: "duckmage-export-tab-row" });
    const fogId = `duckmage-export-field-${nextFieldId++}`;
    fogRow.createEl("label", { text: "Show", cls: "duckmage-export-tab-label", attr: { for: fogId } });
    asSeen = fogRow.createEl("select", { cls: "duckmage-export-tab-select duckmage-export-fog", attr: { id: fogId } });
    asSeen.createEl("option", { value: "seen", text: "As the party has seen it (a player handout)" });
    asSeen.createEl("option", { value: "whole", text: "Whole map" });
  }

  // What goes on the map images: one compact group of toggles (X1).
  const layers = optsForm.createDiv({ cls: "duckmage-export-group" });
  layers.createDiv({ cls: "duckmage-export-group-title", text: "On the map" });
  const layerRow = layers.createDiv({ cls: "duckmage-export-inline" });
  const showCoords = inlineCheck(layerRow, "Coordinates", ticks.showCoords);
  const showIcons = inlineCheck(layerRow, "Icons", ticks.showIcons);
  const showPaths = inlineCheck(layerRow, "Paths", ticks.showPaths);
  const boldPaths = inlineCheck(layerRow, "Bolder paths", prefs.boldPaths ?? true,
    "Draw roads and rivers thicker than on the map so they read in print. Off: the same thickness as on the map.");
  const syncBold = () => { boldPaths.disabled = !showPaths.checked; };
  showPaths.addEventListener("change", syncBold);
  syncBold();
  const showHexNames = inlineCheck(layerRow, "Hex names", ticks.showHexNames);
  const showTokens = inlineCheck(layerRow, "Tokens", ticks.showTokens, "Tokens and their names. Hidden tokens are never drawn.");
  const showLinkBadges = inlineCheck(layerRow, "Link badges", ticks.showLinkBadges,
    "A badge at the corner of each hex that links a town, dungeon, feature, quest or faction.");
  const showLegend = inlineCheck(layerRow, "Legend", ticks.showLegend,
    "A key beside the map: the terrains used and the badge kinds.");
  const showFactionOverlay = inlineCheck(layerRow, "Faction overlay", ticks.showFactionOverlay,
    "Tints hexes by faction and lists the faction names: leave off if players shouldn't know them.");
  // Region overlay is Advanced (placement map): its own row in the dropdown.
  const regionHost = disclosure.target("MapExport.showRegionOverlay", layerRow);
  const regionRow = regionHost === layerRow ? layerRow : (regionHost ?? createDiv()).createDiv({ cls: "duckmage-export-inline" });
  const showRegionOverlay = inlineCheck(regionRow, "Area overlay", regionHost ? ticks.showRegionOverlay : false,
    "Tints hexes by area and labels each area by name.");
  // "Advanced · 1 set" while it's ticked.
  if (regionHost && regionHost !== layerRow) disclosure.track("MapExport.showRegionOverlay", () => showRegionOverlay.checked);
  const layerChecks: Record<ExportLayerKey, HTMLInputElement> = {
    showCoords, showIcons, showPaths, showHexNames, showTokens, showLinkBadges, showLegend, showFactionOverlay, showRegionOverlay,
  };

  // What goes into the PDF's reference table.
  // Shared Folds (src/ui/disclosure.ts): closed at first, remembered; "· N set" counts what differs from the default.
  const columnsBox = new Fold(optsForm, { title: "PDF table columns", open: false, store: plugin.app, surface: "MapExport", cls: "duckmage-export-group" });
  const columnsRow = columnsBox.body.createDiv({ cls: "duckmage-export-inline" });
  const columnChecks = HANDOUT_COLUMNS.map((c) => ({ key: c.key, cb: inlineCheck(columnsRow, handoutColumnLabel(c, plugin.sectionWordsFor(mapName)), true) }));
  for (const { cb } of columnChecks) columnsBox.track(() => !cb.checked);

  // The modules' parts of the form (ModuleRuntime.exportForm): their options here, then their file, button and notes below.
  let partsChanged = (): void => {};
  const parts = moduleExportForm().map((c) => ({ id: c.id, ...c.render({ plugin, mapName, options: optsForm, changed: () => partsChanged() }) }));

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
    if (preset.radius === (prefs.hexRadius ?? 50)) opt.selected = true;
  }

  // Remember this map's choices for next time (S9). data.json only: saving
  // through saveSettings would also sync map notes and mark views stale.
  const remember = () => {
    const layers: Partial<Record<ExportLayerKey, boolean>> = {};
    for (const k of EXPORT_LAYER_KEYS) layers[k] = layerChecks[k].checked;
    const fileName = nameInput.value.trim();
    plugin.settings.mapExportPrefs = {
      ...plugin.settings.mapExportPrefs,
      [mapName]: {
        ...(fileName && fileName !== mapName ? { fileName } : {}),
        hexRadius: clampInt(parseInt(sizeSelect.value, 10), 10, 200, 50),
        ...(boldPaths.checked ? {} : { boldPaths: false }),
        layers,
      },
    };
    void plugin.saveData(plugin.settings);
  };
  for (const input of [nameInput, sizeSelect, boldPaths, ...Object.values(layerChecks)]) {
    input.addEventListener("change", remember);
  }

  // The exact file names each button writes (shared with the exporters' naming).
  const preview = el.createDiv({ cls: "duckmage-export-tab-preview" });
  const names = () => mapExportFileNames({
    base: nameInput.value,
    mapName,
    showFactionOverlay: showFactionOverlay.checked,
    showRegionOverlay: showRegionOverlay.checked,
  }, parts);
  const updatePreview = () => {
    const n = names();
    const suffix = mapExportSuffix({ showFactionOverlay: showFactionOverlay.checked, showRegionOverlay: showRegionOverlay.checked });
    suffixEl.setText(suffix);
    suffixEl.toggle(!!suffix);
    suffixEl.setAttr("title", suffix ? "Added for the overlays you ticked, so each variant gets its own file" : null);
    const more = parts.flatMap((p) => (n.parts[p.id] ? [` · ${n.parts[p.id]} (${p.fileLabel ?? "file"})`] : []));
    preview.setText(`Writes: ${n.png} (PNG) · ${n.pdf} (PDF)${more.join("")}`);
  };
  for (const input of [nameInput, showFactionOverlay, showRegionOverlay]) {
    input.addEventListener("input", updatePreview);
    input.addEventListener("change", updatePreview);
  }
  updatePreview();
  partsChanged = updatePreview;

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
    boldPaths: boldPaths.checked,
    showFactionOverlay: showFactionOverlay.checked,
    showRegionOverlay: showRegionOverlay.checked,
    showHexNames: showHexNames.checked,
    showTokens: showTokens.checked,
    showLinkBadges: showLinkBadges.checked,
    showLegend: showLegend.checked,
    columns: columnChecks.filter((c) => c.cb.checked).map((c) => c.key),
    // As seen: hidden hexes are blank on the images and left out of the tables.
    ...(fog && asSeen?.value === "seen" ? { hidden: (hex: string) => fog.hidden(hex) } : {}),
  });

  const actions = el.createDiv({ cls: "duckmage-export-tab-actions" });
  actions.createEl("button", { text: "Export PNG" }).addEventListener("click", () => {
    remember();
    void exportMapAsPng(plugin, mapName, collectOpts());
    form.onExport?.();
  });
  if (pdfAvailable()) {
    actions.createEl("button", { text: "Export PDF with reference table" }).addEventListener("click", () => {
      remember();
      void exportMapAsPdf(plugin, mapName, collectOpts());
      form.onExport?.();
    });
  } else {
    actions.createDiv({ cls: "duckmage-export-mobile-note", text: PDF_UNAVAILABLE_MESSAGE });
  }
  for (const p of parts) {
    const button = p.button;
    if (!button || !pdfAvailable()) continue;  // module buttons print PDFs
    actions.createEl("button", { text: button.label }).addEventListener("click", () => {
      remember();
      void button.run(collectOpts(), names().parts[p.id]);
      form.onExport?.();
    });
  }

  // What players would see: the map images never carry GM content.
  const included = el.createDiv({ cls: "duckmage-export-included" });
  included.createDiv({ cls: "duckmage-export-included-title", text: "What's in each file" });
  const list = included.createEl("ul");
  list.createEl("li", {
    text: "PNG: the map with what you tick under On the map (the faction and area overlays print their names). " +
      "Never game master icons, hidden tokens or any note text (description, hidden, secret), so it's safe to hand to players.",
  });
  list.createEl("li", {
    text: "PDF with reference table: that map, then a table per section with the columns you tick (name, linked notes, the start of the description…); no hidden or secret sections.",
  });
  for (const p of parts) {
    if (p.describe) list.createEl("li", { text: p.describe });
    if (!p.box) continue;
    const box = el.createDiv({ cls: "duckmage-export-group" });
    p.box.render(box, () => form.onExport?.());
    disclosure.place(p.box.placementId, box);
  }
  disclosure.toEnd();
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
