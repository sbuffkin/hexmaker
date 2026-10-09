import type HexmakerPlugin from "../HexmakerPlugin";
import { PALETTE_PRESETS } from "./presets";

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
  for (const pal of plugin.settings.terrainPalettes) {
    select.createEl("option", { value: pal.name, text: pal.name });
  }
  const presets = PALETTE_PRESETS.filter((p) => !installed.has(p.name));
  if (presets.length > 0) {
    const group = select.createEl("optgroup", { attr: { label: "Presets" } });
    for (const p of presets) {
      group.createEl("option", { value: p.name, text: `${p.name} (preset)`, attr: { title: p.description } });
    }
  }
  if (selected) select.value = selected;
}
