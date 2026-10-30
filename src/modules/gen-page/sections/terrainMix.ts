/**
 * The generator page's "Terrain mix" section: one row per terrain in the
 * mix (bias, min / max patches, example and preview shares), × and
 * "+ Add terrain" (the shared mix list), Near rules and Mix strength.
 */

import { makeScrubbable } from "../../../ui/scrub";
import { renderMultiplierSlider } from "../../../ui/sliders";
import { mixRemoveButton, renderMixAdd, splitMix } from "../../../ui/mixList";
import { exampleShares, formatShare } from "../shares";
import type { CountRange, NearRule } from "../../../../packages/hex-wfc/src";
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
  // Near rules: one per terrain, in their own box (Advanced → Engine tuning).
  const nearBox = el.createDiv({ cls: "duckmage-wfc-control" });
  nearBox.createEl("label", { text: "Near", cls: "duckmage-map-field-label" });
  nearBox.createEl("p", {
    text: "Keep a terrain within some hexes of another, such as lava fields near a volcano: pick the terrain it stays near and how many hexes away (1 = touching). How hard it steers follows the clumping slider.",
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
      // Near rule: a terrain on the map (the mix) and how many hexes away.
      renderNearRow(nearList, t.name, t.near, near[t.name], shown.map((x) => x.name).filter((n) => n !== t.name), (rule) => {
        if (rule === undefined) delete near[t.name];
        else near[t.name] = rule;
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

/** The most hexes away a near rule can be (parseNear's limit). */
const NEAR_MAX = 50;

/**
 * One terrain's near rule: a select of the terrains on the map (the mix;
 * "As learned" = the generator's own rule, "Off" = none) and the distance.
 * `onChange` gets undefined (as learned), null (off) or the rule.
 */
export function renderNearRow(
  list: HTMLElement,
  name: string,
  learned: NearRule | undefined,
  current: NearRule | null | undefined,
  onMap: string[],
  onChange: (rule: NearRule | null | undefined) => void,
): void {
  const row = list.createDiv({ cls: "duckmage-wfc-near-row" });
  row.createSpan({ text: name, cls: "duckmage-wfc-terrain-name" });
  const select = row.createEl("select", { cls: "duckmage-wfc-near", attr: { "aria-label": `Terrain ${name} stays near` } });
  select.createEl("option", { value: "", text: learned ? `As learned (${learned.terrain}, ${learned.distance})` : "As learned (none)" });
  select.createEl("option", { value: "\u0000off", text: "Off" });
  const choices = [...onMap].sort((a, b) => a.localeCompare(b));
  // A rule may name a terrain since taken out of the mix: keep it choosable.
  if (current && !choices.includes(current.terrain)) choices.push(current.terrain);
  const group = select.createEl("optgroup", { attr: { label: "Near (on the map)" } });
  for (const c of choices) group.createEl("option", { value: c, text: onMap.includes(c) ? c : `${c} (not in the mix)` });
  const distance = row.createEl("input", {
    type: "number",
    cls: "duckmage-wfc-num duckmage-wfc-near-distance",
    attr: { min: "1", max: String(NEAR_MAX), "aria-label": `Most hexes ${name} is from it`, title: "Most hexes away (1 = touching)" },
  });
  row.createSpan({ text: "hexes", cls: "duckmage-map-origin-desc" });
  makeScrubbable(distance, { min: 1, max: NEAR_MAX, pxPerStep: 8 });
  const show = (rule: NearRule | null | undefined) => {
    select.value = rule === undefined ? "" : rule === null ? "\u0000off" : rule.terrain;
    const own = rule ?? (rule === undefined ? learned : undefined);
    distance.value = own ? String(own.distance) : "";
    // The distance belongs to a chosen terrain; "As learned" shows the generator's.
    distance.disabled = !rule;
  };
  show(current);
  let rule = current;
  const clamp = (v: number) => Math.max(1, Math.min(NEAR_MAX, Math.round(v)));
  select.addEventListener("change", () => {
    const v = select.value;
    if (v === "") rule = undefined;
    else if (v === "\u0000off") rule = null;
    else rule = { terrain: v, distance: rule ? rule.distance : learned?.distance ?? 2 };
    show(rule);
    onChange(rule);
  });
  distance.addEventListener("change", () => {
    if (!rule) return;
    const n = Number(distance.value);
    rule = { ...rule, distance: Number.isFinite(n) && distance.value !== "" ? clamp(n) : rule.distance };
    show(rule);
    onChange(rule);
  });
}
