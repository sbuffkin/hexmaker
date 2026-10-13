/**
 * The picker standard (audit 2026-10-12, L1–L6): every picker with more
 * than a handful of items has a filter box above its list, one look for
 * "nothing here", one drag grip and one edit toggle. Pickers keep their own
 * tiles and click handling; these are the shared parts.
 *
 * - Filter: `type="search"`, "Filter <things>…", right above the list,
 *   shown from FILTER_FROM items up. Tiles carry their searchable text in
 *   `data-filter` (filterText); tiles without it ("Clear", "Pick",
 *   "Remove") always show. Group headings (`data-filter-head="<group>"`)
 *   hide when no tile of their group (`data-filter-group`) is shown.
 * - Empty state: emptyState(), "No <things> match." or the picker's own
 *   "nothing yet" line, class `duckmage-empty-state`.
 * - Drag grip: dragGrip(), "⠿".
 * - Edit toggle: editToggle(), "Edit" / "Done editing".
 */

/** Show the filter box from this many items up (one threshold for every picker). */
export const FILTER_FROM = 9;

/** The filter box's placeholder: "Filter terrains…". */
export function filterPlaceholder(things: string): string {
  return `Filter ${things}…`;
}

/** What a filter that hides everything says: "No terrains match." */
export function noMatchText(things: string): string {
  return `No ${things} match.`;
}

/** Whether `text` matches a filter query (case-insensitive substring; an empty query matches all). */
export function filterMatches(query: string, ...texts: (string | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return texts.some((t) => !!t && t.toLowerCase().includes(q));
}

/** Whether a list of `count` items gets a filter box. */
export function wantsFilter(count: number): boolean {
  return count >= FILTER_FROM;
}

/** The one "nothing here" line of every picker. */
export function emptyState(parent: HTMLElement, text: string, cls?: string): HTMLElement {
  return parent.createDiv({ cls: `duckmage-empty-state${cls ? ` ${cls}` : ""}`, text });
}

/** Mark a tile as filterable by these words (its name, type, group…). */
export function filterText(tile: HTMLElement, ...words: (string | undefined)[]): void {
  tile.dataset["filter"] = words.filter(Boolean).join(" ").toLowerCase();
}

export interface PickerFilterOptions {
  /** Plural noun for the placeholder and the empty state: "terrains", "factions". */
  things: string;
  /** How many items the list holds (the box shows from FILTER_FROM up, or when `always`). */
  count: number;
  always?: boolean;
  /** Extra class on the box. */
  cls?: string;
  /** Called after each filter pass with how many tiles are shown. */
  onFilter?: (shown: number) => void;
}

export interface PickerFilter {
  /** The box (null when the list is too short to need one). */
  input: HTMLInputElement | null;
  /** Filter the list again (call after the list is re-rendered). */
  apply(): void;
}

/**
 * A filter box right above `list` (inserted before it) and an empty state
 * right after it. Filters `list`'s `[data-filter]` tiles in place.
 */
export function addPickerFilter(list: HTMLElement, o: PickerFilterOptions): PickerFilter {
  if (!o.always && !wantsFilter(o.count)) return { input: null, apply: () => {} };
  const input = createEl("input", {
    type: "search",
    cls: `duckmage-picker-filter${o.cls ? ` ${o.cls}` : ""}`,
    attr: { placeholder: filterPlaceholder(o.things), "aria-label": `Filter ${o.things}` },
  });
  list.before(input);
  const empty = createDiv({ cls: "duckmage-empty-state", text: noMatchText(o.things) });
  list.after(empty);
  empty.toggle(false);
  const apply = () => {
    const q = input.value;
    const groups = new Set<string>();
    let shown = 0;
    for (const tile of Array.from(list.querySelectorAll<HTMLElement>("[data-filter]"))) {
      const hit = filterMatches(q, tile.dataset["filter"]);
      tile.toggle(hit);
      if (!hit) continue;
      shown++;
      groups.add(tile.dataset["filterGroup"] ?? "");
    }
    for (const head of Array.from(list.querySelectorAll<HTMLElement>("[data-filter-head]"))) {
      head.toggle(!q.trim() || groups.has(head.dataset["filterHead"] ?? ""));
    }
    empty.toggle(shown === 0 && !!q.trim());
    o.onFilter?.(shown);
  };
  input.addEventListener("input", apply);
  return { input, apply };
}

/** The one drag grip (⠿) of a reorderable row or tile. */
export function dragGrip(parent: HTMLElement, cls?: string): HTMLElement {
  return parent.createSpan({ cls: `duckmage-drag-grip${cls ? ` ${cls}` : ""}`, text: "⠿", attr: { "aria-hidden": "true" } });
}

/** The edit toggle's text: "Edit" in pick mode, "Done editing" in edit mode. */
export function editToggleText(editing: boolean): string {
  return editing ? "Done editing" : "Edit";
}

/** A picker's edit toggle: "Edit" / "Done editing". */
export function editToggle(parent: HTMLElement, editing: boolean, onToggle: () => void, cls?: string): HTMLButtonElement {
  const btn = parent.createEl("button", { cls, text: editToggleText(editing) });
  btn.addEventListener("click", onToggle);
  return btn;
}
