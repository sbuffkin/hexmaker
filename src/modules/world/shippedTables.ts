/**
 * The World module's shipped table notes (plan-tables-everywhere phase 6):
 * the starter weather and rumours tables the hex editor rolls when neither
 * the hex nor the map names one (regionTables.ts). The rows are data, in
 * ./tables/*.md (the text written into the vault); they are installed at
 * the root of the tables folder, where earlier versions wrote them, so a
 * vault that has them already keeps its own. Pure data.
 */

import type { ShippedTableDef } from "../types";
import weather from "./tables/weather.md";
import rumors from "./tables/rumors.md";

export const WORLD_TABLES: readonly ShippedTableDef[] = [
  { path: "weather.md", text: weather },
  { path: "rumors.md", text: rumors },
];
