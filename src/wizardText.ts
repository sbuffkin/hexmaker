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
