import type HexmakerPlugin from "../HexmakerPlugin";
import { PALETTE_PRESETS } from "./presets";
import { ALL_MAP_KINDS, enabledKinds, isKindEnabled, isSpacePalette, type MapKind } from "../mapKinds";
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

/** A palette's (or preset's) terrains by name; the plugin sets it on load. */
let terrainSource: ((paletteName: string) => readonly { name: string; color: string }[]) | null = null;

/** Where palette previews read a palette's terrains (HexmakerPlugin.onload). */
export function setPaletteTerrainSource(fn: typeof terrainSource): void {
  terrainSource = fn;
}

/**
 * The swatches a palette preview shows (E4): each terrain once, in palette
 * order, with its colour; a terrain without a colour shows grey.
 */
export function paletteSwatchList(terrains: readonly { name: string; color?: string }[]): { name: string; color: string }[] {
  const seen = new Set<string>();
  const out: { name: string; color: string }[] = [];
  for (const t of terrains) {
    const key = t.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name: t.name.trim(), color: /^#[0-9a-f]{3,8}$/i.test(t.color ?? "") ? t.color! : "#888888" });
  }
  return out;
}

/**
 * Add a muted line to `parent` that says what the palette picked in
 * `select` is for (Limited / Expanded; empty for other palettes), and a
 * compact grid of its terrains' colours, named on hover (E4). Follows the
 * select's changes, and refills by fillPaletteSelect.
 */
export function attachPaletteHint(parent: HTMLElement, select: HTMLSelectElement): void {
  const hint = parent.createDiv({ cls: "setting-item-description duckmage-palette-hint" });
  const preview = parent.createDiv({ cls: "duckmage-palette-preview" });
  const update = () => {
    const text = paletteHint(select.value);
    hint.setText(text);
    hint.toggle(!!text);
    const swatches = paletteSwatchList(terrainSource?.(select.value) ?? []);
    preview.empty();
    preview.toggle(swatches.length > 0);
    if (!swatches.length) return;
    preview.createSpan({ cls: "duckmage-palette-preview-count", text: `${swatches.length} terrain${swatches.length === 1 ? "" : "s"}` });
    const grid = preview.createDiv({ cls: "duckmage-palette-swatches" });
    for (const s of swatches) {
      const sw = grid.createSpan({ cls: "duckmage-palette-swatch", attr: { title: s.name, "aria-label": s.name } });
      sw.setCssProps({ "--duckmage-swatch": s.color });
    }
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
 * Whether new maps default to the Expanded palette (GEN1 = B: new installs
 * only). A saved value wins; without one, a fresh install (no saved data)
 * gets true and an update gets false, so existing users keep the default
 * they had (their first overland palette). Only used to seed
 * `defaultPalette` (see resolveDefaultPalette).
 */
export function resolveExpandedDefault(raw: Record<string, unknown> | null | undefined): boolean {
  const saved = raw?.["expandedByDefault"];
  if (typeof saved === "boolean") return saved;
  return !raw || Object.keys(raw).length === 0;
}

/**
 * The "Palette for new maps" setting from data.json. A saved value wins
 * ("" = first palette). Without one it is seeded once from GEN1: Expanded
 * on fresh installs (and installs that already defaulted to it), blank for
 * older installs. After that it is an ordinary setting the user can point
 * at any palette; nothing looks for the name "Expanded" again.
 */
export function resolveDefaultPalette(raw: Record<string, unknown> | null | undefined): string {
  const saved = raw?.["defaultPalette"];
  if (typeof saved === "string") return saved;
  return resolveExpandedDefault(raw) ? EXPANDED_PALETTE_NAME : "";
}

/**
 * Palette a new top-level map starts on when the user hasn't picked one:
 * the "Palette for new maps" setting (`defaultPalette`), when that palette
 * is installed and its map type is on. Otherwise the first installed
 * palette of an enabled map type (overland before space); with none
 * installed, the setting's preset (createNewMap installs it on first use),
 * else the first preset of an enabled type.
 * No palette is special by name: rename or delete any of them and this
 * still picks something sensible.
 */
export function defaultPaletteFor(settings: {
  mapKinds?: string[];
  terrainPalettes: { name: string; terrains: readonly { type?: string }[] }[];
  /** See resolveDefaultPalette. Unset or "" = first palette. */
  defaultPalette?: string;
}): string {
  const kinds = enabledKinds(settings);
  const pals = settings.terrainPalettes;
  const kindOf = (terrains: readonly { type?: string }[]): MapKind => (isSpacePalette(terrains) ? "space" : "world");
  const want = settings.defaultPalette;
  const installed = want ? pals.find((p) => p.name === want) : undefined;
  if (installed && kinds.has(kindOf(installed.terrains))) return installed.name;
  for (const kind of ALL_MAP_KINDS) {
    if (!kinds.has(kind)) continue;
    const first = pals.find((p) => kindOf(p.terrains) === kind);
    if (first) return first.name;
  }
  const preset = want && !installed ? PALETTE_PRESETS.find((p) => p.name === want && kinds.has(p.kind)) : undefined;
  return preset?.name ?? PALETTE_PRESETS.find((p) => kinds.has(p.kind))?.name ?? pals[0]?.name ?? "";
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

/**
 * A palette was renamed: repoint everything that names it (maps, the
 * "Palette for new maps" setting, other palettes' child palette and
 * Submap defaults), so a rename never silently drops a reference.
 */
export function repointPaletteName(
  settings: {
    maps: { paletteName: string }[];
    defaultPalette?: string;
    terrainPalettes: { childPalette?: string; submapDefaults?: Record<string, { palette?: string }> }[];
  },
  oldName: string,
  newName: string,
): void {
  if (oldName === newName) return;
  for (const m of settings.maps) if (m.paletteName === oldName) m.paletteName = newName;
  if (settings.defaultPalette === oldName) settings.defaultPalette = newName;
  for (const p of settings.terrainPalettes) {
    if (p.childPalette === oldName) p.childPalette = newName;
    for (const row of Object.values(p.submapDefaults ?? {})) if (row.palette === oldName) row.palette = newName;
  }
}
