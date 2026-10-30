/**
 * The Neighbour influence slider (owner 2026-10-13; worldgen/neighbourWeight.ts):
 * the shared labelled slider (value always shown, reset to ×1), how strongly
 * the maps already made around a new one steer it. One control for Edit
 * region (overworld regions) and New map → Next to (plain maps, SF6).
 */

import { clampNeighbourWeight, NEIGHBOUR_WEIGHT } from "../worldgen/neighbourWeight";
import { renderLabeledSlider, sliderFormat, type LabeledSlider } from "./sliders";

export const NEIGHBOUR_SLIDER_HELP =
  "How strongly the maps already made around it steer this one: ×1 is as tuned, ×0 only the seams, ×2 twice as much.";

export function renderNeighbourSlider(
  parent: HTMLElement,
  value: number,
  on: { input?: (v: number) => void; change?: (v: number) => void },
  cls = "duckmage-edit-region-neighbour-weight",
): LabeledSlider {
  return renderLabeledSlider(parent, {
    label: "Neighbour influence",
    help: NEIGHBOUR_SLIDER_HELP,
    min: NEIGHBOUR_WEIGHT.min,
    max: NEIGHBOUR_WEIGHT.max,
    step: NEIGHBOUR_WEIGHT.step,
    value: clampNeighbourWeight(value),
    format: sliderFormat.multiplier,
    reset: { value: NEIGHBOUR_WEIGHT.default },
    cls,
    onInput: (v) => on.input?.(clampNeighbourWeight(v)),
    onChange: (v) => on.change?.(clampNeighbourWeight(v)),
  });
}
