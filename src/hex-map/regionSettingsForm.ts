import type HexmakerPlugin from "../HexmakerPlugin";
import type { RegionSettings } from "../types";
import {
  FLOWER_RADII,
  RECT_SIDE_RANGE,
  RECT_SIDES,
  regionCellCount,
  regionSettingsProblem,
} from "../maps/submaps";
import { fillPaletteSelect } from "../palettes/paletteOptions";

const BLENDS: { id: NonNullable<RegionSettings["blend"]>; label: string }[] = [
  { id: "narrow", label: "Narrow" },
  { id: "normal", label: "Normal" },
  { id: "wide", label: "Wide" },
];

let formSeq = 0;

/**
 * The region settings fields (shape, size, palette, blend). Used by the
 * one-time "Region settings" step and the map menu's Regions tab. With
 * `locked`, the fixed fields are shown read-only; blend stays editable
 * (it only applies to regions made afterwards). `onChange` gets every edit.
 */
export function renderRegionSettingsForm(
  el: HTMLElement,
  plugin: HexmakerPlugin,
  initial: RegionSettings,
  opts: { locked: boolean; onChange?: (s: RegionSettings) => void },
): { get: () => RegionSettings; problem: () => string | null } {
  const s: RegionSettings = { ...initial };
  const id = `duckmage-region-form-${formSeq++}`;
  const form = el.createDiv({ cls: "duckmage-region-settings-form" });

  // ── Shape ──
  const shapeRow = form.createDiv({ cls: "duckmage-region-settings-row" });
  shapeRow.createSpan({ cls: "duckmage-region-settings-label", text: "Shape" });
  const shapes = shapeRow.createDiv({ cls: "duckmage-region-settings-choices" });
  const shapeOpts: { id: RegionSettings["footprint"]; label: string; desc: string }[] = [
    { id: "rect", label: "Rectangle", desc: "A square block per hex, laid like bricks. Neighbouring regions join up, and the overworld shows them all." },
    { id: "hex", label: "Hex flower", desc: "Each hex opens into a hex of hexes. Not joined to its neighbours yet: that comes later." },
  ];
  const sizeBox = form.createDiv({ cls: "duckmage-region-settings-row" });
  for (const o of shapeOpts) {
    const label = shapes.createEl("label", { cls: "duckmage-region-settings-choice" });
    const radio = label.createEl("input", { type: "radio", attr: { name: `${id}-shape` } });
    radio.checked = s.footprint === o.id;
    radio.disabled = opts.locked;
    const text = label.createDiv();
    text.createDiv({ text: o.label, cls: "duckmage-region-settings-choice-title" });
    text.createDiv({ text: o.desc, cls: "setting-item-description" });
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      s.footprint = o.id;
      s.size = o.id === "hex" ? 3 : 8;
      drawSize();
      opts.onChange?.({ ...s });
    });
  }

  // ── Size ──
  const drawSize = () => {
    sizeBox.empty();
    sizeBox.createSpan({ cls: "duckmage-region-settings-label", text: "Size" });
    const box = sizeBox.createDiv({ cls: "duckmage-setup-size-presets" });
    const sizes = s.footprint === "hex" ? [...FLOWER_RADII] : [...RECT_SIDES];
    const btns: HTMLButtonElement[] = [];
    const sync = () => sizes.forEach((n, i) => btns[i].toggleClass("is-active", n === s.size));
    for (const n of sizes) {
      const text = s.footprint === "hex" ? `${regionCellCount({ footprint: "hex", size: n })}` : `${n} × ${n}`;
      const b = box.createEl("button", { text, attr: { title: s.footprint === "hex" ? `${text} hexes per region` : `${text} hexes per region` } });
      b.disabled = opts.locked;
      b.addEventListener("click", () => {
        s.size = n;
        sync();
        if (custom) custom.value = String(n);
        opts.onChange?.({ ...s });
      });
      btns.push(b);
    }
    let custom: HTMLInputElement | undefined;
    if (s.footprint === "rect") {
      custom = box.createEl("input", {
        type: "number",
        value: String(s.size),
        attr: { min: String(RECT_SIDE_RANGE.min), max: String(RECT_SIDE_RANGE.max), "aria-label": "Hexes across (custom)", title: "Custom: hexes across" },
      });
      custom.disabled = opts.locked;
      custom.addEventListener("change", () => {
        const n = Math.round(Number(custom!.value));
        if (Number.isFinite(n)) s.size = Math.max(RECT_SIDE_RANGE.min, Math.min(RECT_SIDE_RANGE.max, n));
        custom!.value = String(s.size);
        sync();
        opts.onChange?.({ ...s });
      });
    }
    sync();
    sizeBox.createDiv({
      cls: "setting-item-description",
      text: s.footprint === "hex" ? "Hexes in each region." : "Hexes across each region.",
    });
  };
  drawSize();

  // ── Palette ──
  const palRow = form.createDiv({ cls: "duckmage-region-settings-row" });
  palRow.createSpan({ cls: "duckmage-region-settings-label", text: "Palette" });
  const pal = palRow.createEl("select", { attr: { "aria-label": "Palette for every region" } });
  fillPaletteSelect(plugin, pal, s.palette ?? "");
  if (!s.palette) s.palette = pal.value;
  pal.disabled = opts.locked;
  pal.addEventListener("change", () => {
    s.palette = pal.value;
    opts.onChange?.({ ...s });
  });

  // ── Blend ──
  const blendRow = form.createDiv({ cls: "duckmage-region-settings-row" });
  blendRow.createSpan({ cls: "duckmage-region-settings-label", text: "Blend width" });
  const blend = blendRow.createEl("select", { attr: { "aria-label": "How far neighbouring regions blend" } });
  for (const b of BLENDS) blend.createEl("option", { value: b.id, text: b.label });
  blend.value = s.blend ?? "normal";
  blend.addEventListener("change", () => {
    s.blend = blend.value as RegionSettings["blend"];
    opts.onChange?.({ ...s });
  });
  blendRow.createDiv({
    cls: "setting-item-description",
    text: opts.locked ? "How far neighbouring regions blend. Applies to regions made from now on." : "How far neighbouring regions blend into each other.",
  });

  return { get: () => ({ ...s }), problem: () => regionSettingsProblem(s) };
}
