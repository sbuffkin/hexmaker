/**
 * New map's generator list (HF8, owner A1–A4 and C1, 2026-10-18): a
 * search box over a short scrolling list, one line per generator. Starred
 * and recent first, then the engines and your own, then the shipped
 * families and your folders as collapsed groups (pickerRows.ts). The
 * picked one shows its description under it; the star on a row keeps it
 * at the top. Next to a map, the note above the list says once what
 * "continues" means. Explore as you go picks the generators that power it
 * with the same list.
 *
 * Unlike the setup wizard's cards (fresh-eyes F8: a list that grows), this
 * one scrolls inside a fixed height (owner C1): the groups and the search
 * keep everything a click away.
 */

import type HexmakerPlugin from "../../HexmakerPlugin";
import type { TerrainColor } from "../../types";
import { generatorsFolder } from "../generators";
import { describeKind, type TerrainGeneratorKind } from "../registry";
import { pickerRows, toggleStar, type PickerRow } from "./pickerRows";

/** What the list keeps between redraws (one per list on a form). */
export interface PickerState {
  query: string;
  /** Groups opened or closed by hand. */
  expanded: Map<string, boolean>;
  scrollTop: number;
}

export function newPickerState(): PickerState {
  return { query: "", expanded: new Map(), scrollTop: 0 };
}

export interface GeneratorPickerOptions {
  kinds: readonly TerrainGeneratorKind[];
  terrains: TerrainColor[];
  selected: string | undefined;
  state: PickerState;
  /** The generators folder (your folders become groups). */
  generatorsFolder: string;
  starred: readonly string[];
  recent: readonly string[];
  /** Star or unstar a generator (saved by the caller). */
  star(id: string): void;
  /** A row's description when it isn't the generator's own (Region detail for this hex). */
  describe?(kind: TerrainGeneratorKind): string | undefined;
  /** Next to a map: its name, for the note above the list. */
  neighbour?: string;
  /** The element that names the list (aria-labelledby). */
  labelId?: string;
  pick(kind: TerrainGeneratorKind): void;
}

/** The list's folder, starred and recent generators, and star() saving to the plugin's settings. */
export function pickerSettings(plugin: HexmakerPlugin): Pick<GeneratorPickerOptions, "generatorsFolder" | "starred" | "recent" | "star"> {
  const settings = plugin.settings;
  return {
    generatorsFolder: generatorsFolder(plugin),
    starred: settings.starredGenerators ?? [],
    recent: settings.recentGenerators ?? [],
    star: (id) => {
      settings.starredGenerators = toggleStar(settings.starredGenerators, id);
      void plugin.saveSettings();
    },
  };
}

/** Draw the list into `host` (emptied first). */
export function renderGeneratorPicker(host: HTMLElement, o: GeneratorPickerOptions): void {
  host.empty();
  host.addClass("duckmage-gen-pick");
  if (o.neighbour !== undefined) {
    host.createDiv({
      cls: "setting-item-description duckmage-gen-pick-seam",
      text: `Next to ${o.neighbour}: the ones tagged "continues" carry its edge on; the others ignore it.`,
    });
  }
  const search = host.createEl("input", { type: "search", cls: "duckmage-gen-pick-search", attr: { placeholder: "Search generators…", "aria-label": "Search generators" } });
  search.value = o.state.query;
  const list = host.createDiv({ cls: "duckmage-gen-pick-list", attr: { role: "radiogroup", ...(o.labelId ? { "aria-labelledby": o.labelId } : {}) } });
  list.addEventListener("scroll", () => { o.state.scrollTop = list.scrollTop; });
  const byId = new Map(o.kinds.map((k) => [k.id, k]));
  const text = (k: TerrainGeneratorKind) => o.describe?.(k) ?? describeKind(k, o.terrains);

  const row = (r: PickerRow) => {
    const k = byId.get(r.id);
    if (!k) return;
    const on = r.id === o.selected;
    const el = list.createDiv({ cls: `duckmage-gen-pick-row${on ? " is-active" : ""}`, attr: { role: "radio", tabindex: on ? "0" : "-1", "aria-checked": on ? "true" : "false" } });
    const line = el.createDiv({ cls: "duckmage-gen-pick-line" });
    line.createSpan({ cls: "duckmage-gen-pick-name", text: r.label });
    for (const t of r.tags) line.createSpan({ cls: `duckmage-gen-pick-tag is-${t}`, text: t });
    const starred = o.starred.includes(r.id);
    const star = line.createSpan({
      cls: `duckmage-gen-pick-star${starred ? " is-starred" : ""}`,
      text: starred ? "★" : "☆",
      attr: { role: "button", tabindex: "0", "aria-label": starred ? `Unstar ${r.label}` : `Star ${r.label}`, title: starred ? "Unstar" : "Star: keep it at the top" },
    });
    const toggle = (e: Event) => { e.stopPropagation(); e.preventDefault(); o.star(r.id); draw(); };
    star.addEventListener("click", toggle);
    star.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") toggle(e); });
    if (on) el.createDiv({ cls: "duckmage-gen-pick-desc", text: text(k) });
    el.addEventListener("click", () => o.pick(k));
    el.addEventListener("keydown", (e) => {
      if (e.target === el && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); o.pick(k); }
    });
  };
  const heading = (label: string) => list.createDiv({ cls: "duckmage-gen-pick-heading", text: label });

  const draw = () => {
    list.empty();
    const rows = pickerRows(o.kinds, {
      generatorsFolder: o.generatorsFolder,
      starred: o.starred,
      recent: o.recent,
      query: o.state.query,
      expanded: o.state.expanded,
      current: o.selected,
      neighbour: o.neighbour !== undefined,
      text: (k) => { const kind = byId.get(k.id); return kind ? text(kind) : ""; },
    });
    if (rows.starred.length) { heading("Starred"); rows.starred.forEach(row); }
    if (rows.recent.length) { heading("Recent"); rows.recent.forEach(row); }
    if ((rows.starred.length || rows.recent.length) && rows.tree.top.length) heading("All");
    rows.tree.top.forEach(row);
    for (const g of rows.tree.groups) {
      const head = list.createDiv({ cls: `duckmage-gen-pick-group${g.open ? " is-open" : ""}`, attr: { role: "button", tabindex: "0", "aria-expanded": g.open ? "true" : "false" } });
      head.createSpan({ cls: "duckmage-gen-pick-caret", text: g.open ? "▾" : "▸" });
      head.createSpan({ text: `${g.label} (${g.rows.length})` });
      const flip = () => { o.state.expanded.set(g.key, !g.open); draw(); };
      head.addEventListener("click", flip);
      head.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });
      if (g.open) g.rows.forEach(row);
    }
    const none = !rows.starred.length && !rows.recent.length && !rows.tree.top.length && !rows.tree.groups.length;
    if (none) list.createDiv({ cls: "setting-item-description", text: o.state.query ? `No generator matches "${o.state.query}".` : "No generator fits this palette." });
    list.scrollTop = o.state.scrollTop;
  };
  search.addEventListener("input", () => {
    o.state.query = search.value;
    o.state.scrollTop = 0;
    draw();
  });
  draw();
}
