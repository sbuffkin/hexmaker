/**
 * The Space module's shipped table notes (plan-tables-everywhere phase 6,
 * T12): the tables Orbits rolls for moons and system extras when no map or
 * setup names its own. The rows are data, in ./tables/*.md; installed under
 * `{tables}/space/Orbits/` (T1: an organised tree). Pure data.
 */

import type { ShippedTableDef } from "../types";
import moons from "./tables/Moons.md";
import gasGiantMoons from "./tables/Gas giant moons.md";
import systemExtras from "./tables/System extras.md";

/** Where Orbits' shipped tables go, under the tables folder. */
export const ORBITS_TABLES_FOLDER = "space/Orbits";

export const MOONS_TABLE = `${ORBITS_TABLES_FOLDER}/Moons.md`;
export const SYSTEM_EXTRAS_TABLE = `${ORBITS_TABLES_FOLDER}/System extras.md`;

export const SPACE_TABLES: readonly ShippedTableDef[] = [
  { path: MOONS_TABLE, text: moons },
  { path: `${ORBITS_TABLES_FOLDER}/Gas giant moons.md`, text: gasGiantMoons },
  { path: SYSTEM_EXTRAS_TABLE, text: systemExtras },
];
