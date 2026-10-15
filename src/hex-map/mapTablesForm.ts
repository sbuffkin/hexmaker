/**
 * Map properties: what happens on arrival (GM4) and the generator tables
 * (T11), for the open map and everything under it. One select per line,
 * so a change is two clicks ("easy, modular and as low-click as
 * possible"). Modules add their own sections after these
 * (MapPropertiesSection; Space: Convert world types to tables).
 */

import type HexmakerPlugin from "../HexmakerPlugin";
import type { MapData } from "../types";
import { FileLinkSuggestModal } from "./FileLinkSuggestModal";
import { contentFolder } from "../notePickers";
import { ENGINE_ROLES, type RoleId } from "../worldgen/tableRoles";
import { fittingRoleTables } from "../worldgen/tableSources";
import { registry } from "../modules";
import { ARRIVAL_MODE_TEXT, ARRIVAL_MODE_WORDS, parseArrivalMode, type ArrivalMode } from "../arrival/arrival";

const noteName = (path: string) => path.replace(/\.md$/i, "").replace(/^.*\//, "");
const withMd = (p: string) => (/\.md$/i.test(p) ? p : `${p}.md`);

/** "Arriving somewhere new": make submaps, or not; blank follows the map above. */
export function renderArrivalSetting(el: HTMLElement, plugin: HexmakerPlugin, map: MapData, rerender: () => void): void {
  el.createEl("h4", { text: "Arriving somewhere new" });
  el.createDiv({
    cls: "duckmage-map-origin-desc",
    text: "Going into a hex that has no map yet (Go there in the hex menu, or Ctrl+click). Making the submap works in Play too; the new submap can be rerolled until you lock it. Maps under this one do the same unless they set their own.",
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
 * and the maps under it. Blank follows the map above, else the role's own
 * default (its unsetLabel: a module's setup choice or shipped table; for
 * Names, the hex's terrain and coordinates). Names shows on every map; a
 * module's roles on maps of its type, or wherever one is set.
 */
export function renderRoleTables(el: HTMLElement, plugin: HexmakerPlugin, map: MapData, rerender: () => void): void {
  const own = map.roleTables ?? {};
  const inherited = plugin.roleTablesFor(map.name);
  const context = plugin.contextKinds(map.name);
  const moduleKinds = new Set(registry.kindsWithTableRoles().filter((k) => context.has(k)));
  // A module role shows on its type's maps, or when it's set here or above.
  const moduleRoles = new Set(registry.tableRoles().map((r) => r.id));
  const kindOfRole = new Map(registry.modules.flatMap((m) => (m.tableRoles ?? []).map((r) => [r.id, m.kind?.id] as const)));
  // A module role's tables are listed from its module's folder first ("{tables}/space/…"), with their set's name.
  const folderOfRole = new Map(registry.modules.flatMap((m) => (m.tableRoles ?? []).map((r) => [r.id, m.tablesFolder ?? ""] as const)));
  const roles = ENGINE_ROLES.filter((r) => !moduleRoles.has(r.id) || inherited[r.id] || moduleKinds.has(kindOfRole.get(r.id) ?? ""));
  if (!roles.length) return;

  el.createEl("h4", { text: "Generator tables" });
  el.createDiv({
    cls: "duckmage-map-origin-desc",
    text: "The random tables used here and on every map made under it: Names for new maps, and what generators roll on. Unset: the map above's, else the default shown.",
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
  for (const role of roles) {
    const row = el.createDiv({ cls: "duckmage-role-table-row" });
    row.createSpan({ text: role.name, attr: { title: role.help } });
    const select = row.createEl("select", { attr: { "aria-label": `${role.name} table` } });
    const above = map.parent ? plugin.roleTablesFor(map.parent.map)[role.id] : undefined;
    select.createEl("option", {
      value: "",
      text: above ? `${noteName(above.link)} (from ${plugin.mapLabel(above.from)})` : (role.unsetLabel ?? "Default"),
    });
    const roleFolder = folderOfRole.get(role.id) ?? "";
    const choices = fittingRoleTables(all, role.id, roleFolder ? `${tablesFolder}/${roleFolder}` : "");
    const current = own[role.id];
    if (current && !choices.includes(withMd(current))) choices.unshift(withMd(current));
    for (const p of choices) {
      // Name plus its set ("Unexplored sector · Default space").
      const rel = p.startsWith(`${tablesFolder}/`) ? p.slice(tablesFolder.length + 1) : p;
      const parts = rel.replace(/\.md$/i, "").split("/");
      const set = roleFolder && parts[0] === roleFolder && parts.length > 2 ? ` · ${parts[1]}` : "";
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
}
