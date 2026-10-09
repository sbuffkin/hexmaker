import { MAP_KINDS, enabledKinds } from "./mapKinds";
import { TERRAIN_TYPES, terrainTypeInfo } from "./terrainTypes";

/**
 * Fill a <select> with the terrain types, grouped by map type (World /
 * Space). Types of disabled map kinds are left out unless `current` uses
 * one. The first option is "— none —" (value "").
 */
export function fillTerrainTypeSelect(
  select: HTMLSelectElement,
  settings: { mapKinds?: string[] },
  current: string | undefined,
  noneLabel = "— none —",
): void {
  select.empty();
  select.createEl("option", { value: "", text: noneLabel });
  const on = enabledKinds(settings);
  for (const kind of MAP_KINDS) {
    const types = TERRAIN_TYPES.filter((t) => t.kind === kind.id && (on.has(kind.id) || t.id === current));
    if (types.length === 0) continue;
    const group = select.createEl("optgroup", { attr: { label: kind.label } });
    for (const t of types) group.createEl("option", { value: t.id, text: t.label });
  }
  // An unknown type typed into a note by hand still shows (and is kept).
  if (current && !terrainTypeInfo(current)) select.createEl("option", { value: current, text: `${current} (unknown)` });
  select.value = current ?? "";
}
