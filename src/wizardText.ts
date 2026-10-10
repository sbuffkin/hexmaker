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
 * The hint under the wizard's map name: the name it will be saved under
 * when that differs from what was typed, else "" (the line keeps its
 * space either way; see .duckmage-wizard-slug-note).
 */
export function slugHint(typed: string): string {
	const slug = slugify(typed);
	return slug && slug !== typed ? `Saved as "${slug}" (map names are lower-case, with dashes).` : "";
}
