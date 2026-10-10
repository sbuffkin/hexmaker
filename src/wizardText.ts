/**
 * Setup wizard copy that has to stay true (tested in
 * tests/freshEyesR4Setup.test.ts; kept out of SetupWizardView so tests
 * needn't load an ItemView).
 */

/**
 * What setup made for terrain: empty tables to fill in, not ready-made
 * encounters (fresh-eyes r4: "encounter tables for every terrain" read as
 * ready to roll; rolling an empty one says so, see emptyTableMessage).
 */
export const TERRAIN_TABLES_SUMMARY =
	"An empty description table and encounter table for each terrain, ready for you to fill in (linked to a hex when you paint its terrain)";
