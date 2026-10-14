/**
 * Setup wizard copy that has to stay true (tested in
 * tests/freshEyesR4Setup.test.ts; kept out of SetupWizardView so tests
 * needn't load an ItemView).
 */

import { slugify } from "./utils";

/**
 * What setup made for terrain: empty tables to fill in, not ready-made
 * encounters (fresh-eyes r4: "encounter tables for every terrain" read as
 * ready to roll; rolling an empty one says so, see emptyTableMessage).
 */
export const TERRAIN_TABLES_SUMMARY =
	"An empty description table and encounter table for each terrain, ready for you to fill in (linked to a hex when you paint its terrain)";

/**
 * The hint under the wizard's map name: the folder it will be saved in
 * when that differs from what was typed (the name shows as typed), else "" (the line keeps its
 * space either way; see .duckmage-wizard-slug-note).
 */
export function slugHint(typed: string): string {
	const slug = slugify(typed);
	return slug && slug !== typed ? `Folder: "${slug}" (the map keeps the name you typed).` : "";
}

/**
 * The placement id (src/ui/placement.ts) of a generator option in the
 * wizard: Wizard.genOptWater, …Climate, …Relief, …Sea; any other option
 * is Wizard.genOptOther.
 */
export function wizardOptionId(key: string, newMapId?: string): string {
	const named = ["water", "climate", "relief", "sea"];
	if (named.includes(key)) return `Wizard.genOpt${key.charAt(0).toUpperCase()}${key.slice(1)}`;
	// A module's option with its own New map id (NewMap.x) has the matching Wizard.x.
	return newMapId?.startsWith("NewMap.") ? `Wizard.${newMapId.slice("NewMap.".length)}` : "Wizard.genOptOther";
}

/** Inventory id of the setup wizard's engine tuning sliders (its Advanced). */
export const WIZARD_TUNING_ID = "Wizard.tuning";

/** Inventory id of New map's engine tuning sliders (its Advanced, as the setup wizard's). */
export const NEW_MAP_TUNING_ID = "NewMap.tuning";

/** A tuning slider's value as shown: at most two decimals, no trailing zeros. */
export function tuningText(n: number): string {
	return String(Math.round(n * 100) / 100);
}
