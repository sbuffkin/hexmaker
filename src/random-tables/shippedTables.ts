/**
 * Installing the modules' shipped table notes (plan-tables-everywhere
 * §2.9, phase 6): which ones a vault is missing. A note at the path is
 * kept as it is, whatever it says (the user's copy wins; copy-on-edit),
 * so running this again writes nothing.
 *
 * Pure: no Obsidian imports.
 */

import type { ShippedTableDef } from "../modules/types";

/** The shipped tables to write: full vault paths under `tablesFolder`, only those not there yet. */
export function shippedTablesToInstall(
  tables: readonly ShippedTableDef[],
  tablesFolder: string,
  exists: (path: string) => boolean,
): ShippedTableDef[] {
  const out: ShippedTableDef[] = [];
  const seen = new Set<string>();
  for (const t of tables) {
    const path = tablesFolder ? `${tablesFolder}/${t.path}` : t.path;
    if (seen.has(path) || exists(path)) continue;
    seen.add(path);
    out.push({ path, text: t.text });
  }
  return out;
}
