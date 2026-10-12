/**
 * Map properties → "Generator tables" (T11), the Space module's section:
 * the table each engine role rolls on for this map and the maps under it.
 * Contributed through the module runtime (mapProperties), so the core's
 * Map properties modal never names it.
 */

import type HexmakerPlugin from "../HexmakerPlugin";
import type { MapData } from "../types";
import type { MapPropertiesSection } from "../modules/types";
import { FileLinkSuggestModal } from "../hex-map/FileLinkSuggestModal";
import { contentFolder } from "../notePickers";
import { ENGINE_ROLES, type RoleId } from "../worldgen/tableRoles";
import { fittingRoleTables } from "../worldgen/tableSources";
import { registry } from "../modules";
import { SPACE_TABLES_FOLDER } from "./spaceTables";

const noteName = (path: string) => path.replace(/\.md$/i, "").replace(/^.*\//, "");
const withMd = (p: string) => (/\.md$/i.test(p) ? p : `${p}.md`);

/**
 * "Generator tables": the table each generator role rolls on for this map
 * and the maps under it. Blank follows the map above, else the World types
 * picked when generating. Shown on maps of a type whose generators roll on
 * tables (Space), or wherever a table is set.
 */
export function renderRoleTables(el: HTMLElement, plugin: HexmakerPlugin, map: MapData, rerender: () => void): void {
  const own = map.roleTables ?? {};
  const inherited = plugin.roleTablesFor(map.name);
  const anySet = Object.keys(inherited).length > 0;
  const context = plugin.contextKinds(map.name);
  if (!anySet && !registry.kindsWithTableRoles().some((k) => context.has(k))) return;

  el.createEl("h4", { text: "Generator tables" });
  el.createDiv({
    cls: "duckmage-map-origin-desc",
    text: "The random tables Star scatter and Orbits roll on, for this map and every map made under it. Unset: the map above's, else the World types picked when generating.",
  });
  const tablesFolder = contentFolder(plugin.settings, "tablesFolder");
  const all = plugin.tableNotes.tables();
  const save = (role: RoleId, path: string | undefined) => {
    const next = { ...(map.roleTables ?? {}) };
    if (path) next[role] = withMd(path);
    else delete next[role];
    if (Object.keys(next).length) map.roleTables = next;
    else delete map.roleTables;
    void plugin.saveSettings().then(rerender);
  };
  for (const role of ENGINE_ROLES) {
    const row = el.createDiv({ cls: "duckmage-role-table-row" });
    row.createSpan({ text: role.name, attr: { title: role.help } });
    const select = row.createEl("select", { attr: { "aria-label": `${role.name} table` } });
    const above = map.parent ? plugin.roleTablesFor(map.parent.map)[role.id] : undefined;
    select.createEl("option", {
      value: "",
      text: above ? `${noteName(above.link)} (from ${plugin.mapLabel(above.from)})` : "World types (as picked)",
    });
    const choices = fittingRoleTables(all, role.id, `${tablesFolder}/${SPACE_TABLES_FOLDER}`);
    const current = own[role.id];
    if (current && !choices.includes(withMd(current))) choices.unshift(withMd(current));
    for (const p of choices) {
      // Name plus its set ("Unexplored sector · Default space").
      const rel = p.startsWith(`${tablesFolder}/`) ? p.slice(tablesFolder.length + 1) : p;
      const parts = rel.replace(/\.md$/i, "").split("/");
      const set = parts[0] === SPACE_TABLES_FOLDER && parts.length > 2 ? ` · ${parts[1]}` : "";
      select.createEl("option", { value: p, text: `${noteName(p)}${set}` });
    }
    select.createEl("option", { value: "__other", text: "Other table…" });
    select.value = current ? withMd(current) : "";
    select.addEventListener("change", () => {
      if (select.value !== "__other") { save(role.id, select.value || undefined); return; }
      select.value = current ? withMd(current) : "";
      new FileLinkSuggestModal(plugin.app, plugin, (file) => save(role.id, file.path), tablesFolder, ["md"]).open();
    });
  }
  if (plugin.worldTypeStore.list().some((t) => !plugin.worldTypeStore.isConverted(t.name))) {
    const btn = el.createEl("button", { text: "Convert world types to tables…", attr: { title: "Write each world types table as random tables under the tables folder (backed up first; the old notes are kept)" } });
    btn.addEventListener("click", () => void plugin.runModuleCommand("convert-world-types").then(rerender));
  }
}

export const ROLE_TABLES_SECTION: MapPropertiesSection = { id: "role-tables", render: renderRoleTables };
