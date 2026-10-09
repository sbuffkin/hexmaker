import type HexmakerPlugin from "../HexmakerPlugin";
import { PALETTE_PRESETS, SPACE_SECTOR_PALETTE_NAME } from "./presets";
import { enabledKinds, isKindEnabled, isSpacePalette } from "../mapKinds";

/**
 * Palette a new top-level map starts on when the user hasn't picked one:
 * the first installed palette of an enabled map type. World users get
 * their first overland palette (Limited on a fresh install); space-only
 * users get Space - Sector (installed, else the preset, which createNewMap
 * installs on first use) or another installed space palette.
 */
export function defaultPaletteFor(settings: {
  mapKinds?: string[];
  terrainPalettes: { name: string; terrains: readonly { type?: string }[] }[];
}): string {
  const kinds = enabledKinds(settings);
  const pals = settings.terrainPalettes;
  if (kinds.has("world")) {
    const world = pals.find((p) => !isSpacePalette(p.terrains));
    if (world) return world.name;
    return PALETTE_PRESETS.find((p) => p.kind === "world")?.name ?? pals[0]?.name ?? "";
  }
  const space = pals.filter((p) => isSpacePalette(p.terrains));
  return space.find((p) => p.name === SPACE_SECTOR_PALETTE_NAME)?.name ?? space[0]?.name ?? SPACE_SECTOR_PALETTE_NAME;
}

/**
 * Fill a palette <select> with the installed palettes, then any built-in
 * presets not installed yet (labelled "(preset)"). Picking a preset is
 * enough: createNewMap() installs it on first use. With no `selected`,
 * the default for the enabled map types is picked (defaultPaletteFor).
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
  if (selected) {
    select.value = selected;
  } else {
    const fallback = defaultPaletteFor(plugin.settings);
    if (Array.from(select.options).some((o) => o.value === fallback)) select.value = fallback;
  }
}
