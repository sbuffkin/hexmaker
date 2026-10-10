import type HexmakerPlugin from "../HexmakerPlugin";
import { PALETTE_PRESETS, SPACE_SECTOR_PALETTE_NAME } from "./presets";
import { enabledKinds, isKindEnabled, isSpacePalette } from "../mapKinds";
import { EXPANDED_PALETTE_NAME, LIMITED_PALETTE_NAME } from "../constants";

/**
 * One line on what each built-in fantasy palette is for, shown under
 * palette dropdowns (G7b: Expanded is the default; say what Limited is
 * good for).
 */
export const PALETTE_HINTS: Record<string, string> = {
  [EXPANDED_PALETTE_NAME]: "Expanded: more terrains (coasts, wetlands, forest and mountain kinds); matches the generators.",
  [LIMITED_PALETTE_NAME]: "Limited: fewer, simpler terrains; quicker to paint. For more (coasts and such), use Expanded.",
};

/** The hint line for a palette name, or "" when it has none. */
export function paletteHint(name: string): string {
  return PALETTE_HINTS[name] ?? "";
}

const hintUpdaters = new WeakMap<HTMLSelectElement, () => void>();

/**
 * Add a muted line to `parent` that says what the palette picked in
 * `select` is for (Limited / Expanded); empty for other palettes. Follows
 * the select's changes, and refills by fillPaletteSelect.
 */
export function attachPaletteHint(parent: HTMLElement, select: HTMLSelectElement): void {
  const hint = parent.createDiv({ cls: "setting-item-description duckmage-palette-hint" });
  const update = () => {
    const text = paletteHint(select.value);
    hint.setText(text);
    hint.toggle(!!text);
  };
  hintUpdaters.set(select, update);
  select.addEventListener("change", update);
  update();
}

/** Re-read the hint after setting `select.value` from code. */
export function refreshPaletteHint(select: HTMLSelectElement): void {
  hintUpdaters.get(select)?.();
}

/**
 * Palette a new top-level map starts on when the user hasn't picked one.
 * World users get Expanded when it's installed (G7b), else their first
 * overland palette, else the Expanded preset; space-only users get Space -
 * Sector (installed, else the preset, which createNewMap installs on first
 * use) or another installed space palette.
 */
export function defaultPaletteFor(settings: {
  mapKinds?: string[];
  terrainPalettes: { name: string; terrains: readonly { type?: string }[] }[];
}): string {
  const kinds = enabledKinds(settings);
  const pals = settings.terrainPalettes;
  if (kinds.has("world")) {
    const world = pals.filter((p) => !isSpacePalette(p.terrains));
    const expanded = world.find((p) => p.name === EXPANDED_PALETTE_NAME);
    if (expanded) return expanded.name;
    if (world.length) return world[0].name;
    return EXPANDED_PALETTE_NAME;
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
    const hint = paletteHint(pal.name);
    select.createEl("option", { value: pal.name, text: pal.name, ...(hint ? { attr: { title: hint } } : {}) });
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
  hintUpdaters.get(select)?.();
}
