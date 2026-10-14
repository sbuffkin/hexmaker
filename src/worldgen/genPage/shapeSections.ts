/**
 * The generator page's engine sections: Shape (feature size, clumping,
 * clean-up, symmetry, edges), Placement and Guarantees (with the
 * impassable-terrain list and its suggestions).
 */

import { suggestImpassable } from "../impassableHint";
import { isImpassable } from "../../impassable";
import { cleanupStrengths, SYMMETRIES, type Symmetry } from "../../../packages/hex-wfc/src";
import { sliderFormat } from "../../ui/sliders";
import { generatorPageState } from "../generatorPageState";
import { slider, select, toggle, terrainFilter } from "./controls";
import type { GeneratorPageCtx } from "./ctx";

const SYMMETRY_LABELS: Record<Symmetry, string> = {
  none: "None",
  "left-right": "Left–right",
  "top-bottom": "Top–bottom",
  both: "Both",
};

/** Shape, Placement and Guarantees. */
export function renderShapeSections(ctx: GeneratorPageCtx, main: HTMLElement): void {
  const { plugin, model, colors, s, save, place, dropIfEmpty } = ctx;
  // Shape
  let el = ctx.section(main, "Shape");
  slider(el, "Feature size", "Size of each terrain's patches relative to the map. 1 = like the example; lower = more, smaller patches; 0 = no growth.", 0, 3, 0.25, s().featureSize, (v) => save({ featureSize: v }), sliderFormat.multiplier);
  place("GenPage.clumping", slider(el, "Clumping", "How strongly each hex follows its neighbours. 0 gives speckled noise.", 0, 6, 0.5, s().neighbourInfluence, (v) => save({ neighbourInfluence: v })));
  if (model.terrains.some((t) => t.shape === "line")) {
    const learnedWidth = Math.max(1, Math.round(Math.max(...model.terrains.filter((t) => t.shape === "line").map((t) => t.width ?? 1))));
    slider(el, "Line width", "Thickness of line-shaped terrain, in hexes.", 1, 3, 1, s().lineWidth > 0 ? s().lineWidth : learnedWidth, (v) => save({ lineWidth: v }), sliderFormat.count);
  }
  // Clean-up after generating. Older generators only have one "smoothing"
  // value; the sliders start from what it meant, and any change replaces it.
  const cleanup = cleanupStrengths(s());
  place("GenPage.edgeSmoothing", slider(el, "Edge smoothing", "Trim one-hex bumps and notches along the edges of patches. Lone hexes are left alone.", 0, 1, 0.1, cleanup.edges,
    (v) => save({ edgeSmoothing: v, speckSize: cleanupStrengths(s()).speckSize, smoothing: undefined }), sliderFormat.fraction));
  place("GenPage.removeSmallPatches", slider(el, "Remove small patches", "Fill in patches of this many hexes or fewer with the terrain around them. 0 = keep all.", 0, 6, 1, cleanup.speckSize,
    (v) => save({ speckSize: v, edgeSmoothing: cleanupStrengths(s()).edges, smoothing: undefined }), sliderFormat.count));
  place("GenPage.keepRare", slider(el, "Keep rare terrain", "Terrains under this share of the example (%) are never smoothed or removed, so the odd rare hex survives.", 0, 20, 1,
    Math.round(s().keepRare * 100), (v) => save({ keepRare: v / 100 }), sliderFormat.percent));
  place("GenPage.symmetry", select(el, "Symmetry", "Mirror the map. Symmetric wherever the rules allow.",
    SYMMETRIES.map((v) => [v, SYMMETRY_LABELS[v]]), s().symmetry, (v) => save({ symmetry: v })));
  place("GenPage.edgeStyle", select(el, "Edge style", "What the map border prefers: a terrain of your choice, or the example's border.",
    [["", "As in the example"], ...model.terrains.map((t): [string, string] => [t.name, t.name])],
    s().edgeTerrain, (v) => save({ edgeTerrain: v || undefined })));
  place("GenPage.edgeStrength", slider(el, "Edge strength", "How strongly the border follows the edge style. 0 = off.", 0, 1, 0.05, s().edgeStrength, (v) => save({ edgeStrength: v }), sliderFormat.fraction));
  dropIfEmpty(el);

  // Placement
  el = ctx.section(main, "Placement");
  place("GenPage.directionalBias", slider(el, "Directional bias", "0 = terrain goes anywhere. 1 = it keeps to where it was in the example.", 0, 1, 0.05, s().directionalBias, (v) => save({ directionalBias: v }), sliderFormat.fraction));
  place("GenPage.scatter", slider(el, "Scatter", "Randomness in where patches start. Too low and one terrain can take over the map.", 0, 6, 0.5, s().scatter, (v) => save({ scatter: v })));
  if (model.terrains.some((t) => t.shape === "scatter")) {
    place("GenPage.spacing", slider(el, "Spacing", "How far apart single-hex terrain stays, relative to the example. 0 = no spacing.", 0, 3, 0.25, s().spacing, (v) => save({ spacing: v }), sliderFormat.multiplier));
  }
  place("GenPage.randomness", slider(el, "Randomness", "Share of hexes chosen by chance, ignoring neighbours, so rare terrain turns up here and there.", 0, 1, 0.05, s().randomness, (v) => save({ randomness: v }), sliderFormat.fraction));
  dropIfEmpty(el);

  // Guarantees
  el = ctx.section(main, "Guarantees");
  if (model.features?.length) {
    place("GenPage.guaranteedFeatures", toggle(el, "Guaranteed features", "Always place the example's anchored terrain lines (such as a river painted as terrain). Drawn paths have their own section below.", s().features, (v) => save({ features: v })));
  }
  place("GenPage.connectedLand", toggle(el, "Connected land", "Fill cut-off pockets so every passable hex connects.", s().connected, (v) => save({ connected: v })));
  const impassableBox = el.createDiv();
  const hintBox = el.createDiv({ cls: "duckmage-wfc-hint" });
  // Terrain the learned paths go around, offered to add (never added for you).
  const drawHints = () => {
    hintBox.empty();
    const palette = plugin.getPaletteByName(generatorPageState.paletteName)?.terrains ?? [];
    const hints = suggestImpassable(model, colors, s().impassable, new Set(palette.filter(isImpassable).map((t) => t.name)));
    if (!hints.length) return;
    const row = hintBox.createDiv({ cls: "duckmage-region-row" });
    row.createSpan({ text: "Suggested", cls: "duckmage-map-origin-label" });
    for (const h of hints) {
      const chip = row.createSpan({ cls: "duckmage-wfc-chip duckmage-wfc-hint-chip", attr: { title: h.reason } });
      chip.createSpan({ cls: "duckmage-wfc-swatch" }).setCssProps({ "--duckmage-wfc-swatch": colors.get(h.terrain) ?? "var(--background-modifier-border)" });
      chip.createSpan({ text: h.terrain });
    }
    const add = row.createEl("button", { text: hints.length > 1 ? "Add all" : "Add" });
    add.addEventListener("click", () => {
      // Redraw here rather than re-rendering the page: the page would
      // re-read the file before this save has landed.
      save({ impassable: [...s().impassable, ...hints.map((h) => h.terrain).filter((t) => !s().impassable.includes(t))] });
      drawImpassable();
    });
    hintBox.createEl("p", { text: hints.map((h) => `${h.terrain}: ${h.reason}.`).join(" "), cls: "duckmage-map-origin-desc" });
  };
  const drawImpassable = () => {
    impassableBox.empty();
    terrainFilter(impassableBox, "Impassable terrain", model.terrains.map((t) => t.name), colors, s().impassable, (list) => {
      save({ impassable: list });
      drawHints();
    });
    drawHints();
  };
  drawImpassable();
}
