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
/** The saved size, or `fallback` when unset (the map legend starts small; previews medium). */
export function legendSize(v: unknown, fallback: LegendSize = "m"): LegendSize {
  return v === "s" || v === "m" || v === "l" ? v : fallback;
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
  /** Folded to a small "Legend" chip (the map's legend, MK2). */
  collapsed?: boolean;
  /** Minimize / expand button; omitted = no button. */
  onCollapse?: (collapsed: boolean) => void;
  /** Cut names longer than this (full name on hover); omitted = no cut. */
  maxName?: number;
}

/** Longest name shown in the map's legend before it's cut (MK2). */
export const MAP_LEGEND_NAME_MAX = 8;

/** Cut to `max` characters with "…" (trailing spaces dropped). */
function cut(text: string, max: number): string {
  const chars = [...text];
  if (max < 2 || chars.length <= max) return text;
  return chars.slice(0, max - 1).join("").trimEnd() + "…";
}

/**
 * A legend name shortened to about `max` characters, or unchanged when it
 * fits. Several words keep the last one and shrink the rest to initials
 * ("mixed forest hills" → "m.f. hills", a few characters of slack), so
 * kinds of forest stay apart; one long word is cut ("brokenlands" →
 * "brokenl…").
 */
export function shortLegendName(name: string, max: number): string {
  const text = name.replace(/\s+/g, " ").trim();
  if (max < 2 || [...text].length <= max) return text;
  const words = text.split(" ");
  if (words.length > 1) {
    const last = words[words.length - 1];
    const initials = words.slice(0, -1).map((w) => `${[...w][0]}.`).join("");
    const room = max + 3 - initials.length - 1;
    if (room >= 3) return `${initials} ${cut(last, room)}`;
  }
  return cut(text, max);
}

/**
 * Short names for a whole legend: shortLegendName, except where two short
 * forms would clash (the legend must tell them apart): those keep their
 * last word whole ("m.f. mountain" / "m.f. mountains"), else the full name.
 */
export function shortLegendNames(names: readonly string[], max: number): Map<string, string> {
  const short = new Map(names.map((n) => [n, shortLegendName(n, max)]));
  const clashing = () => {
    const count = new Map<string, number>();
    for (const s of short.values()) count.set(s, (count.get(s) ?? 0) + 1);
    return [...short].filter(([n, s]) => s !== n && (count.get(s) ?? 0) > 1).map(([n]) => n);
  };
  for (const n of clashing()) {
    const words = n.replace(/\s+/g, " ").trim().split(" ");
    if (words.length > 1) {
      short.set(n, `${words.slice(0, -1).map((w) => `${[...w][0]}.`).join("")} ${words[words.length - 1]}`);
    }
  }
  for (const n of clashing()) short.set(n, n);
  return short;
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
  // Keep a press on the legend from starting a map pan.
  for (const ev of ["mousedown", "pointerdown"]) {
    box.addEventListener(ev, (e) => e.stopPropagation());
  }
  const onCollapse = opts.onCollapse;
  if (opts.collapsed && onCollapse) {
    box.addClass("is-collapsed");
    const chip = box.createEl("button", {
      cls: "duckmage-terrain-legend-chip",
      text: "Legend",
      attr: { "aria-label": "Show the legend", title: "Show the legend" },
    });
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      onCollapse(false);
    });
    return box;
  }
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
  if (onCollapse) {
    const min = head.createEl("button", {
      cls: "duckmage-terrain-legend-min",
      text: "–",
      attr: { "aria-label": "Minimize the legend", title: "Minimize" },
    });
    min.addEventListener("click", (e) => {
      e.stopPropagation();
      onCollapse(true);
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
  // Long names are cut on the map; the row's tooltip has the full name.
  const shortNames = opts.maxName
    ? shortLegendNames([...entries.map((t) => t.name), ...badges.map((b) => b.label)], opts.maxName)
    : undefined;
  const shown = (name: string) => shortNames?.get(name) ?? name;
  const nameSpan = (row: HTMLElement, name: string) => {
    const text = shown(name);
    row.createSpan({ cls: "duckmage-terrain-legend-name", text });
    if (text !== name) row.setAttr("title", name);
  };
  for (const t of entries) {
    const row = list.createDiv({ cls: "duckmage-terrain-legend-row" });
    const sw = row.createDiv({ cls: "duckmage-terrain-legend-swatch" });
    sw.setCssProps({ "--duckmage-legend-color": t.color });
    if (t.icon && opts.iconUrl) {
      createIconEl(sw, opts.iconUrl(t.icon), t.name, t.iconColor, "duckmage-terrain-legend-icon");
    }
    nameSpan(row, t.name);
  }
  for (const b of badges) {
    const row = list.createDiv({ cls: "duckmage-terrain-legend-row duckmage-terrain-legend-badge" });
    const chip = row.createSpan({ cls: `duckmage-link-badge duckmage-link-badge-${b.cls}` });
    setIcon(chip, b.icon);
    nameSpan(row, b.label);
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
