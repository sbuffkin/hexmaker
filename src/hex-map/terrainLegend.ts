import { setIcon } from "obsidian";
import { createIconEl } from "../utils";

/**
 * Terrain legend: the terrains used on a map (or a generator preview), as
 * swatch + name rows. Size (S/M/L) and visibility are plugin settings
 * (`terrainLegendSize`, `showTerrainLegend`) shared by the map and the
 * previews.
 */

export type LegendSize = "s" | "m" | "l";
export const LEGEND_SIZES: LegendSize[] = ["s", "m", "l"];

export interface LegendEntry {
  name: string;
  color: string;
  icon?: string;
  iconColor?: string;
}

/** Settings value → a valid size (unset or junk = medium). */
export function legendSize(v: unknown): LegendSize {
  return v === "s" || v === "l" ? v : "m";
}

/**
 * The entries for the terrains in `used`, in palette order. A used name the
 * palette doesn't know (renamed or removed terrain) is listed last in grey so
 * the legend still explains every colour on the map.
 */
export function usedTerrainEntries(
  palette: readonly LegendEntry[],
  used: Iterable<string | undefined | null>,
): LegendEntry[] {
  const names = new Set<string>();
  for (const n of used) if (n) names.add(n);
  const out: LegendEntry[] = [];
  for (const t of palette) {
    if (names.delete(t.name)) out.push({ name: t.name, color: t.color, icon: t.icon, iconColor: t.iconColor });
  }
  for (const n of [...names].sort((a, b) => a.localeCompare(b))) out.push({ name: n, color: "#888888" });
  return out;
}

export interface LegendOptions {
  size: LegendSize;
  /** S/M/L picked. */
  onSize: (size: LegendSize) => void;
  /** Hide button; omitted = no hide button. */
  onHide?: () => void;
  /** Icon file → URL (icons are skipped when omitted). */
  iconUrl?: (icon: string) => string;
  /** Extra class on the box (placement). */
  cls?: string;
  /** Link badge kinds shown on the map, listed after the terrains. */
  badges?: readonly LegendBadge[];
}

/** A link badge kind in the legend (as drawn on the map). */
export interface LegendBadge {
  label: string;
  icon: string;
  /** Suffix of the badge's colour class (duckmage-link-badge-<cls>). */
  cls: string;
}

/** Build the legend box under `parent`, replacing a previous one there. */
export function renderTerrainLegend(
  parent: HTMLElement,
  entries: readonly LegendEntry[],
  opts: LegendOptions,
): HTMLElement | null {
  parent.querySelector(":scope > .duckmage-terrain-legend")?.remove();
  const badges = opts.badges ?? [];
  if (entries.length === 0 && badges.length === 0) return null;
  const box = parent.createDiv({
    cls: `duckmage-terrain-legend duckmage-terrain-legend-${opts.size}${opts.cls ? " " + opts.cls : ""}`,
  });
  const head = box.createDiv({ cls: "duckmage-terrain-legend-head" });
  head.createSpan({ cls: "duckmage-terrain-legend-title", text: "Legend" });
  const sizes = head.createDiv({ cls: "duckmage-terrain-legend-sizes" });
  for (const s of LEGEND_SIZES) {
    const b = sizes.createEl("button", {
      cls: "duckmage-terrain-legend-size" + (s === opts.size ? " is-active" : ""),
      text: s.toUpperCase(),
      attr: { "aria-label": `Legend size ${s.toUpperCase()}` },
    });
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      opts.onSize(s);
    });
  }
  if (opts.onHide) {
    const onHide = opts.onHide;
    const hide = head.createEl("button", {
      cls: "duckmage-terrain-legend-hide",
      text: "×",
      attr: { "aria-label": "Hide legend (turn it back on in the layers menu)" },
    });
    hide.addEventListener("click", (e) => {
      e.stopPropagation();
      onHide();
    });
  }
  const list = box.createDiv({ cls: "duckmage-terrain-legend-list" });
  for (const t of entries) {
    const row = list.createDiv({ cls: "duckmage-terrain-legend-row" });
    const sw = row.createDiv({ cls: "duckmage-terrain-legend-swatch" });
    sw.setCssProps({ "--duckmage-legend-color": t.color });
    if (t.icon && opts.iconUrl) {
      createIconEl(sw, opts.iconUrl(t.icon), t.name, t.iconColor, "duckmage-terrain-legend-icon");
    }
    row.createSpan({ cls: "duckmage-terrain-legend-name", text: t.name });
  }
  for (const b of badges) {
    const row = list.createDiv({ cls: "duckmage-terrain-legend-row duckmage-terrain-legend-badge" });
    const chip = row.createSpan({ cls: `duckmage-link-badge duckmage-link-badge-${b.cls}` });
    setIcon(chip, b.icon);
    row.createSpan({ cls: "duckmage-terrain-legend-name", text: b.label });
  }
  // Keep a press on the legend from starting a map pan.
  for (const ev of ["mousedown", "pointerdown"]) {
    box.addEventListener(ev, (e) => e.stopPropagation());
  }
  return box;
}

/** What a preview legend needs from the plugin (kept narrow for tests). */
export interface LegendHost {
  settings: { showTerrainLegend?: boolean; terrainLegendSize?: LegendSize };
  saveSettings(): Promise<void>;
}

/**
 * Legend under a generator preview: the terrains in `cells`, same size and
 * visibility settings as the map's. Hidden → a small "Show legend" link, so
 * it can come back without leaving the preview. Re-call after each redraw.
 */
export function renderPreviewLegend(
  holder: HTMLElement,
  host: LegendHost,
  palette: readonly LegendEntry[],
  cells: Iterable<string | undefined | null>,
  iconUrl?: (icon: string) => string,
): void {
  holder.empty();
  const list = [...cells];
  const redraw = () => renderPreviewLegend(holder, host, palette, list, iconUrl);
  const save = () => { void host.saveSettings(); };
  if (!(host.settings.showTerrainLegend ?? true)) {
    const show = holder.createEl("a", { cls: "duckmage-terrain-legend-show", text: "Show legend", href: "#" });
    show.addEventListener("click", (e) => {
      e.preventDefault();
      host.settings.showTerrainLegend = true;
      save();
      redraw();
    });
    return;
  }
  renderTerrainLegend(holder, usedTerrainEntries(palette, list), {
    size: legendSize(host.settings.terrainLegendSize),
    cls: "duckmage-terrain-legend-preview",
    iconUrl,
    onSize: (size) => {
      host.settings.terrainLegendSize = size;
      save();
      redraw();
    },
    onHide: () => {
      host.settings.showTerrainLegend = false;
      save();
      redraw();
    },
  });
}
