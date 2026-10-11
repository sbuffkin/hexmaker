/**
 * Map properties: what happens on arrival (GM4) and the generator tables
 * (T11), for the open map and everything under it. One select per line,
 * so a change is two clicks ("easy, modular and as low-click as
 * possible").
 */

import type HexmakerPlugin from "../HexmakerPlugin";
import type { MapData } from "../types";
import { FileLinkSuggestModal } from "./FileLinkSuggestModal";
import { contentFolder } from "../notePickers";
import { hasFeature } from "../featureLevel";
import { ENGINE_ROLES, type RoleId } from "../worldgen/tableRoles";
import { fittingRoleTables } from "../worldgen/tableSources";
import { SPACE_TABLES_FOLDER } from "../space/spaceTables";
import { ARRIVAL_MODE_TEXT, ARRIVAL_MODE_WORDS, parseArrivalMode, type ArrivalMode } from "../arrival/arrival";

const noteName = (path: string) => path.replace(/\.md$/i, "").replace(/^.*\//, "");
const withMd = (p: string) => (/\.md$/i.test(p) ? p : `${p}.md`);

/** "Arriving somewhere new": make places, or not; blank follows the map above. */
export function renderArrivalSetting(el: HTMLElement, plugin: HexmakerPlugin, map: MapData, rerender: () => void): void {
  el.createEl("h4", { text: "Arriving somewhere new" });
  el.createDiv({
    cls: "duckmage-map-origin-desc",
    text: "Going into a hex that has no map yet (Go there in the hex menu, or Ctrl+click). Making the place works in Play too; the new place can be rerolled until you lock it. Maps under this one do the same unless they set their own.",
  });
  const row = el.createDiv({ cls: "duckmage-region-row" });
  const select = row.createEl("select", { attr: { "aria-label": "Arriving somewhere new" } });
  const parent = plugin.parentOf(map.name)?.map;
  const inherited = parent ? plugin.arrivalModeFor(parent) : { mode: "off" as ArrivalMode };
  select.createEl("option", {
    value: "",
    text: parent && inherited.from ? `Same as ${plugin.mapLabel(inherited.from)} (${ARRIVAL_MODE_TEXT[inherited.mode].toLowerCase()})` : `${ARRIVAL_MODE_TEXT.off} (default)`,
  });
  for (const m of ["make", "off"] as ArrivalMode[]) select.createEl("option", { value: m, text: ARRIVAL_MODE_TEXT[m] });
  select.value = parseArrivalMode(map.arrivalMode) ?? "";
  select.addEventListener("change", () => {
    const v = select.value as ArrivalMode | "";
    if (v) map.arrivalMode = ARRIVAL_MODE_WORDS[v];
    else delete map.arrivalMode;
    void plugin.saveSettings().then(rerender);
  });
}

/**
 * "Generator tables": the table each generator role rolls on for this map
 * and the maps under it. Blank follows the map above, else the World types
 * picked when generating. Shown on space maps, or wherever a table is set.
 */
export function renderRoleTables(el: HTMLElement, plugin: HexmakerPlugin, map: MapData, rerender: () => void): void {
  const own = map.roleTables ?? {};
  const inherited = plugin.roleTablesFor(map.name);
  const anySet = Object.keys(inherited).length > 0;
  if (!anySet && (!plugin.isSpaceMap(map.name) || !hasFeature(plugin.settings, "generators"))) return;

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
    btn.addEventListener("click", () => void plugin.convertWorldTypes().then(rerender));
  }
}
