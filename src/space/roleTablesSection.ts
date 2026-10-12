/**
 * Map properties, after Generator tables (the core's, src/hex-map/
 * mapTablesForm.ts): "Convert world types to tables…" while a World types
 * note isn't converted yet, on maps where Space's roles are listed (a map
 * of the Space type, or one with a Space role table set here or above).
 * Contributed through the module runtime (mapProperties).
 */

import type { MapPropertiesSection } from "../modules/types";
import { SPACE_TABLE_ROLES } from "../modules/space/tableRoles";

const SPACE_ROLES = new Set(SPACE_TABLE_ROLES.map((r) => r.id));

export const ROLE_TABLES_SECTION: MapPropertiesSection = {
  id: "convert-world-types",
  render(el, plugin, map, rerender) {
    const shown = plugin.contextKinds(map.name).has("space") || Object.keys(plugin.roleTablesFor(map.name)).some((id) => SPACE_ROLES.has(id));
    if (!shown || !plugin.worldTypeStore.list().some((t) => !plugin.worldTypeStore.isConverted(t.name))) return;
    const btn = el.createEl("button", { text: "Convert world types to tables…", attr: { title: "Write each world types table as random tables under the tables folder (backed up first; the old notes are kept)" } });
    btn.addEventListener("click", () => void plugin.runModuleCommand("convert-world-types").then(rerender));
  },
};
