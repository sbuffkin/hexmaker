import type HexmakerPlugin from "../HexmakerPlugin";
import { PALETTE_PRESETS } from "./presets";
import { isKindEnabled, isSpacePalette } from "../mapKinds";

/**
 * Fill a palette <select> with the installed palettes, then any built-in
 * presets not installed yet (labelled "(preset)"). Picking a preset is
 * enough: createNewMap() installs it on first use.
 */
export function fillPaletteSelect(
  plugin: HexmakerPlugin,
  select: HTMLSelectElement,
  selected?: string,
): void {
  select.empty();
  const installed = new Set(plugin.settings.terrainPalettes.map((p) => p.name));
  // Installed space palettes are hidden too while Space is off — unless
  // selected, so a map or saved default using one still shows it.
  const spaceOn = isKindEnabled(plugin.settings, "space");
  for (const pal of plugin.settings.terrainPalettes) {
    if (!spaceOn && pal.name !== selected && isSpacePalette(pal.terrains)) continue;
    select.createEl("option", { value: pal.name, text: pal.name });
  }
  // Presets of disabled map types are hidden — unless already selected (e.g.
  // a saved submap default), so the dropdown can still show it.
  const presets = PALETTE_PRESETS.filter(
    (p) => !installed.has(p.name) && (isKindEnabled(plugin.settings, p.kind) || p.name === selected),
  );
  if (presets.length > 0) {
    const group = select.createEl("optgroup", { attr: { label: "Presets" } });
    for (const p of presets) {
      group.createEl("option", { value: p.name, text: `${p.name} (preset)`, attr: { title: p.description } });
    }
  }
  if (selected) select.value = selected;
}
