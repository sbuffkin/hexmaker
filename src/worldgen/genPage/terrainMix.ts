/**
 * The generator page's "Terrain mix" section: one row per terrain in the
 * mix (bias, min / max patches, example and preview shares), × and
 * "+ Add terrain" (the shared mix list), Near rules and Mix strength.
 */

import { Notice } from "obsidian";
import { makeScrubbable } from "../../ui/scrub";
import { renderMultiplierSlider } from "../../ui/sliders";
import { mixRemoveButton, renderMixAdd, splitMix } from "../../ui/mixList";
import { exampleShares, formatShare } from "../shares";
import { parseNear, type CountRange, type NearRule } from "../../../packages/hex-wfc/src";
import { slider } from "./controls";
import type { GeneratorPageCtx } from "./ctx";

/** Terrain mix: per-terrain controls and what they do to the preview. */
export function renderTerrainMix(ctx: GeneratorPageCtx, main: HTMLElement): void {
  const { plugin, model, colors, s, save, place } = ctx;
  // Terrain mix: per-terrain controls and what they do to the preview
  const el = ctx.section(main, "Terrain mix");
  el.createEl("p", {
    text: "Only the terrains in the mix are listed: × takes one out; the add button under the list puts it back. Bias makes a terrain more or less common than it was learned (×1 = as learned). Min and max limit how many separate patches it forms; leave blank for no limit. Example is each terrain's share of the map it was learned from; Map is its share of the preview, with the change your bias and min/max make to it.",
    cls: "duckmage-map-origin-desc",
  });
  const table = el.createDiv({ cls: "duckmage-wfc-terrains" });
  const head = table.createDiv({ cls: "duckmage-wfc-terrain-row duckmage-wfc-terrain-head" });
  const headings: [string, string][] = [
    ["Terrain", ""],
    ["Bias", "More or less of this terrain than it was learned (×1 = as learned)"],
    ["Min", "Fewest separate patches"],
    ["Max", "Most separate patches"],
    ["Example", "Share of the map this generator was learned from"],
    ["Map", "Share of the preview; the change is what bias and min/max add or remove (same seed)"],
    ["", ""],
  ];
  for (const [h, title] of headings) head.createSpan({ text: h, attr: title ? { title } : {} });
  const example = exampleShares(model);
  const mix = { ...s().mix };
  const counts: Record<string, CountRange> = Object.fromEntries(Object.entries(s().counts).map(([k, r]) => [k, { ...r }]));
  const near: Record<string, NearRule | null> = { ...s().near };
  const terrainNames = new Set(model.terrains.map((t) => t.name));
  // Near rules: one per terrain, in their own box (Advanced → Engine tuning).
  const nearBox = el.createDiv({ cls: "duckmage-wfc-control" });
  nearBox.createEl("label", { text: "Near", cls: "duckmage-map-field-label" });
  nearBox.createEl("p", {
    text: "Keep a terrain within some hexes of another, such as lava fields near a volcano: \"volcano 3\" (how hard it steers follows the clumping slider). Blank = the generator's own rule; \"off\" = none.",
    cls: "duckmage-map-origin-desc",
  });
  const nearList = nearBox.createDiv({ cls: "duckmage-wfc-near-list" });
  // Only the terrains in the mix get a row (O6, the shared mix list):
  // learned here and not biased to ×0, or held by a min count; then
  // "+ Add terrain" (src/ui/mixList.ts) puts one back at ×1.
  const learnedWeight = new Map(model.terrains.map((t) => [t.name, t.weight]));
  /** Terrains added back on this page: they keep their row while it's open. */
  const shownExtra = new Set<string>();
  const inMix = (name: string) =>
    shownExtra.has(name) || ((learnedWeight.get(name) ?? 0) > 0 && mix[name] !== 0) || (counts[name]?.min ?? 0) > 0;
  const addBox = createDiv({ cls: "duckmage-wfc-mix-add" });
  table.after(addBox);
  const drawMixRows = () => {
    for (const r of Array.from(table.querySelectorAll(":scope > .duckmage-wfc-terrain-row:not(.duckmage-wfc-terrain-head)"))) r.remove();
    nearList.empty();
    ctx.shareCells.clear();
    const { shown, addable } = splitMix(model.terrains.map((t) => ({ ...t, id: t.name })), inMix);
    for (const t of shown) {
      const row = table.createDiv({ cls: "duckmage-wfc-terrain-row" });
      // Guaranteed line features are laid down before the solver runs, so
      // mix barely changes how much of them there is.
      const isFeature = model.features?.some((f) => f.terrain === t.name) ?? false;
      const title = `${t.name} (${t.shape ?? "no"} shape)` + (isFeature ? ". Placed as a guaranteed feature, so bias has little effect." : "");
      const nameCell = row.createSpan({ cls: "duckmage-wfc-terrain-name", attr: { title } });
      const swatch = nameCell.createSpan({ cls: "duckmage-wfc-swatch" });
      swatch.setCssProps({ "--duckmage-wfc-swatch": colors.get(t.name) ?? "var(--background-modifier-border)" });
      nameCell.createSpan({ text: t.name });
      if (isFeature) nameCell.createSpan({ text: "feature", cls: "duckmage-wfc-tag" });
      // Bias (owner Q2): the shared multiplier, ×1 = as learned; the Map column shows the share it gives.
      const mixCell = row.createSpan({ cls: "duckmage-wfc-mix" });
      renderMultiplierSlider(mixCell, {
        label: "",
        ariaLabel: `${t.name} bias`,
        value: mix[t.name],
        onChange: (v) => {
          if (v === undefined) delete mix[t.name];
          else mix[t.name] = v;
          save({ mix: Object.keys(mix).length ? { ...mix } : undefined });
        },
      });
      for (const bound of ["min", "max"] as const) {
        const input = row.createEl("input", { type: "number", cls: "duckmage-wfc-num", attr: { min: "0", placeholder: "–" } });
        const v = counts[t.name]?.[bound];
        input.value = v === undefined ? "" : String(v);
        makeScrubbable(input, { min: 0, max: 99, pxPerStep: 8 });
        input.addEventListener("change", () => {
          const range: CountRange = { ...(counts[t.name] ?? {}) };
          if (input.value === "") delete range[bound];
          else range[bound] = Math.max(0, Math.floor(Number(input.value) || 0));
          if (range.min === undefined && range.max === undefined) delete counts[t.name];
          else counts[t.name] = range;
          save({ counts: Object.keys(counts).length ? { ...counts } : undefined });
        });
      }
      // Near rule: blank = the generator's own (shown as the placeholder).
      const nearRow = nearList.createDiv({ cls: "duckmage-wfc-near-row" });
      nearRow.createSpan({ text: t.name, cls: "duckmage-wfc-terrain-name" });
      const nearInput = nearRow.createEl("input", {
        type: "text",
        cls: "duckmage-wfc-near",
        attr: { placeholder: t.near ? `${t.near.terrain} ${t.near.distance}` : "–", "aria-label": `${t.name} near rule` },
      });
      const own = near[t.name];
      nearInput.value = own === undefined ? "" : own === null ? "off" : `${own.terrain} ${own.distance}`;
      nearInput.addEventListener("change", () => {
        const raw = nearInput.value.trim();
        if (!raw) delete near[t.name];
        else if (/^(off|none)$/i.test(raw)) near[t.name] = null;
        else {
          const rule = parseNear(raw);
          if (!rule || !terrainNames.has(rule.terrain) || rule.terrain === t.name) {
            new Notice(`Write a terrain from this generator and a distance, e.g. "${model.terrains.find((x) => x.name !== t.name)?.name ?? "volcano"} 3", or "off".`);
            nearInput.value = own === undefined ? "" : own === null ? "off" : `${own.terrain} ${own.distance}`;
            return;
          }
          near[t.name] = rule;
        }
        save({ near: Object.keys(near).length ? { ...near } : undefined });
      });
      row.createSpan({ text: formatShare(example.get(t.name) ?? 0), cls: "duckmage-wfc-share" });
      const mapCell = row.createSpan({ cls: "duckmage-wfc-share" });
      ctx.shareCells.set(t.name, {
        now: mapCell.createSpan({ text: "–" }),
        change: mapCell.createSpan({ cls: "duckmage-wfc-share-change" }),
      });
      // Out of the mix: bias ×0, no min/max (O6, src/ui/mixList.ts).
      mixRemoveButton(row, t.name, () => {
        mix[t.name] = 0;
        delete counts[t.name];
        shownExtra.delete(t.name);
        save({ mix: { ...mix }, counts: Object.keys(counts).length ? { ...counts } : undefined });
        drawMixRows();
      });
    }

    addBox.empty();
    renderMixAdd(plugin.app, addBox, {
      thing: "terrain",
      things: "terrains",
      // Only what this generator learned can come back (a terrain it never saw has nothing to bias).
      addable: addable.filter((t) => (learnedWeight.get(t.name) ?? 0) > 0).map((t) => ({ id: t.name, label: t.name, color: colors.get(t.name) })),
      onAdd: (name) => {
        delete mix[name];
        shownExtra.add(name);
        save({ mix: Object.keys(mix).length ? { ...mix } : undefined });
        drawMixRows();
      },
    });
    ctx.schedulePreview();
  };
  drawMixRows();
  place("GenPage.near", nearBox);
  place("GenPage.mixStrength", slider(el, "Mix strength", "How closely the overall terrain mix follows the example.", 0, 4, 0.5, s().frequencyFeedback, (v) => save({ frequencyFeedback: v })));
}
