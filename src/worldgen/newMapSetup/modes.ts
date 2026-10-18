/**
 * New map's first choice about terrain (HF8, owner B1, 2026-10-18): what
 * kind of map it is. "Generate it now" (the generator list), any mode a
 * module adds (Hex flower: "Explore as you go"), and "Blank". A module's
 * mode is made by a generator that's never listed
 * (TerrainGeneratorKind.unlisted); the form knows which mode it's in from
 * the generator it's on, so a saved submap default that names one opens in
 * that mode.
 *
 * Pure: no Obsidian imports.
 */

import type { NewMapModeContribution } from "../../modules/types";
import { BLANK_ID } from "../registry";

export const GENERATE_MODE = "generate";
export const BLANK_MODE = "blank";

/** One choice of the row: its card text, and the generator a module's mode makes maps with. */
export interface MapModeChoice {
  id: string;
  label: string;
  description: string;
  generatorId?: string;
}

/** The row's choices: Generate it now, the modules' modes, then Blank. */
export function mapModeChoices(modes: readonly Pick<NewMapModeContribution, "id" | "label" | "desc" | "generatorId">[]): MapModeChoice[] {
  return [
    { id: GENERATE_MODE, label: "Generate it now", description: "Pick a generator: the whole map is made at once." },
    ...modes.map((m) => ({ id: m.id, label: m.label, description: m.desc, generatorId: m.generatorId })),
    { id: BLANK_MODE, label: "Blank", description: "An empty map to paint by hand." },
  ];
}

/** The mode the form is in while it's on generator `kindId`. */
export function modeOfKind(kindId: string, choices: readonly MapModeChoice[]): string {
  if (kindId === BLANK_ID) return BLANK_MODE;
  return choices.find((c) => c.generatorId === kindId)?.id ?? GENERATE_MODE;
}
