/**
 * The generator page's "Map settings" section: size presets, and Connect
 * to (the new map as a neighbouring region of an existing one, with Lean
 * toward neighbours).
 */

import { SIDES, hexRangeText, type Side } from "../world";
import { blendFromNeighbours, neighbourSpec, NEIGHBOUR_SHARE, occupiedSides, regionNameAt, regionNeighbourNames, type NewRegion } from "../neighbours";
import { sizePresets } from "../sizePresets";
import { sourceMapsOf } from "../generators";
import { generatorPageState } from "../generatorPageState";
import type { HexWfcModel } from "../../../packages/hex-wfc/src";
import type { GeneratorPageCtx } from "./ctx";
import type { PreviewParts } from "./previewColumn";

/**
 * Map settings lead the controls. Returns the neighbour slot the new map
 * fills (null: a separate map) and the model to generate it with.
 */
export function renderMapSettings(ctx: GeneratorPageCtx, main: HTMLElement, preview: PreviewParts): { connected: NewRegion | null; genModel: HexWfcModel } {
  const { plugin, model } = ctx;
  const { colsInput, rowsInput, paletteSelect } = preview;
  // Map settings lead the controls: preset sizes for now. The exact size,
  // seed and palette sit under the preview.
  const el = ctx.section(main, "Map settings");
  const presetRow = el.createDiv({ cls: "duckmage-wfc-chips duckmage-wfc-presets" });
  const sourceMap = plugin.getMap(sourceMapsOf(model)[0] ?? "");
  const presets = sizePresets(sourceMap ? { name: sourceMap.name, cols: sourceMap.gridSize.cols, rows: sourceMap.gridSize.rows } : undefined);
  const presetBtns = presets.map((p) => {
    const btn = presetRow.createEl("button", { cls: "duckmage-wfc-chip" });
    btn.createSpan({ text: p.label });
    btn.createSpan({ text: `${p.cols}×${p.rows}`, cls: "duckmage-wfc-preset-size" });
    btn.addEventListener("click", () => {
      colsInput.value = String(p.cols);
      rowsInput.value = String(p.rows);
      markPreset();
      ctx.schedulePreview();
    });
    return { p, btn };
  });
  const markPreset = () => {
    for (const { p, btn } of presetBtns)
      btn.toggleClass("is-selected", Number(colsInput.value) === p.cols && Number(rowsInput.value) === p.rows);
  };
  markPreset();
  for (const input of [colsInput, rowsInput]) {
    input.addEventListener("input", markPreset);
    input.addEventListener("change", markPreset);
  }

  // Connect to: the new map becomes a neighbouring region of an existing
  // one, so its size, palette, coordinates and stagger follow from it, and
  // its terrain carries on across the border.
  const connectRow = el.createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
  connectRow.createSpan({ text: "Connect to", cls: "duckmage-map-origin-label" });
  const anchorSelect = connectRow.createEl("select");
  anchorSelect.createEl("option", { value: "", text: "Nothing (a separate map)" });
  for (const m of plugin.settings.maps) anchorSelect.createEl("option", { value: m.name, text: plugin.mapLabel(m.name) });
  const sideSelect = connectRow.createEl("select");
  for (const sd of SIDES) sideSelect.createEl("option", { value: sd, text: `${sd} of it` });
  anchorSelect.value = generatorPageState.connect?.anchor ?? "";
  sideSelect.value = generatorPageState.connect?.side ?? "east";
  sideSelect.disabled = !anchorSelect.value;
  const connectNote = el.createEl("p", { cls: "duckmage-map-origin-desc" });
  let connected: NewRegion | null = null;
  if (generatorPageState.connect) {
    const spec = neighbourSpec(plugin, generatorPageState.connect.anchor, generatorPageState.connect.side);
    if (!spec.ok) connectNote.setText(`⚠ ${spec.reason}`);
    else {
      connected = { slot: spec.slot, aSlot: spec.aSlot, anchor: generatorPageState.connect.anchor, side: generatorPageState.connect.side, cols: spec.cols, rows: spec.rows, offset: spec.offset, stagger: spec.stagger, paletteName: spec.paletteName };
      const borders = occupiedSides(plugin, connected).map((sd) => `${sd}: ${plugin.mapLabel(regionNameAt(plugin, connected!, sd))}`);
      connectNote.setText(`Size locked to ${spec.cols}×${spec.rows} and palette to ${spec.paletteName}, so it lines up. Borders ${borders.join("; ")}. ${hexRangeText(spec.offset, spec.cols, spec.rows)}.`);
      colsInput.value = String(spec.cols);
      rowsInput.value = String(spec.rows);
      colsInput.disabled = rowsInput.disabled = true;
      for (const { btn } of presetBtns) btn.disabled = true;
      markPreset();
    }
  }
  const setConnect = () => {
    generatorPageState.connect = anchorSelect.value ? { anchor: anchorSelect.value, side: sideSelect.value as Side } : null;
    // Neighbours must share the palette.
    const anchorMap = anchorSelect.value ? plugin.getMap(anchorSelect.value) : undefined;
    if (anchorMap) generatorPageState.paletteName = anchorMap.paletteName;
    ctx.host.rerender();
  };
  anchorSelect.addEventListener("change", setConnect);
  sideSelect.addEventListener("change", setConnect);
  if (connected) paletteSelect.disabled = true;
  // Blend toward the neighbours, so the region is the border country
  // between this generator and what's next door.
  let genModel = model;
  if (connected) {
    const lean = el.createEl("label", { cls: "duckmage-region-row duckmage-wfc-toggle" });
    const box = lean.createEl("input", { type: "checkbox" });
    box.checked = generatorPageState.leanToNeighbours;
    lean.createSpan({ text: "Lean toward neighbours" });
    lean.setAttr("title", `Blend in what the neighbouring regions look like (${NEIGHBOUR_SHARE}% between them), each toward its own side. Directional bias sets how sharp the change is.`);
    box.addEventListener("change", () => {
      generatorPageState.leanToNeighbours = box.checked;
      ctx.host.rerender();
    });
    if (generatorPageState.leanToNeighbours) genModel = blendFromNeighbours(plugin, model, regionNeighbourNames(plugin, connected), NEIGHBOUR_SHARE, ctx.generators);
  }
  return { connected, genModel };
}
