/**
 * Local disclosure for one surface (a modal, page or the settings tab): the
 * collapsed "Advanced" dropdown, its collapsible sub-sections, and the
 * "Debug" subsection inside it.
 *
 * - The Advanced dropdown is made the first time something goes in it, so
 *   a surface with nothing advanced shows none. It starts collapsed; its
 *   open state is remembered per surface on this device (local storage).
 * - Sub-sections (`advanced/<Sub-section>` in the placement map) are nested
 *   collapsibles after the plain advanced controls, in the order first
 *   used. Each starts closed; its open state is remembered per surface
 *   too (key `<surface>/<Sub-section>`).
 * - Debug exists only while debug mode is on (src/ui/debugMode.ts); it sits
 *   at the end of Advanced, after the advanced controls and sub-sections.
 * - Where a control goes comes from the placement map (src/ui/placement.ts):
 *   `place(id, el)` moves a built control into its layer; `target(id, here)`
 *   gives the parent to build it in (null: don't build it).
 *
 * - "Advanced · 2 set": a control placed in Advanced can report whether it
 *   holds a non-default or active value (`place(id, el, isSet)`,
 *   `target(id, here, isSet)` or `track(id, isSet)`). The dropdown's header
 *   counts them all, and each sub-section's (and Debug's) header counts its
 *   own, so nothing is quietly in effect unseen. Headers update on any
 *   input, change or click inside the dropdown, and on `refreshSet()`.
 *
 * If the host is emptied and rebuilt (a re-render), the next call makes a
 * fresh dropdown in it.
 */

import { isDebugMode, type LocalStore } from "./debugMode";
import { parsePlacement, PLACEMENT, type Layer } from "./placement";

/** Local-storage key: surfaces (and `<surface>/<sub-section>`s) left open. */
export const DISCLOSURE_OPEN_KEY = "hexmaker-disclosure-open";

export function disclosureOpen(store: LocalStore, surface: string): boolean {
  const v = store.loadLocalStorage(DISCLOSURE_OPEN_KEY);
  return Array.isArray(v) && v.includes(surface);
}

export function setDisclosureOpen(store: LocalStore, surface: string, open: boolean): void {
  const v = store.loadLocalStorage(DISCLOSURE_OPEN_KEY);
  const list = new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  if (open) list.add(surface);
  else list.delete(surface);
  store.saveLocalStorage(DISCLOSURE_OPEN_KEY, list.size ? [...list] : null);
}

/** The open-state key of sub-section `sub` on `surface`. */
export function subSectionKey(surface: string, sub: string): string {
  return `${surface}/${sub}`;
}

/** A header with its count: "Advanced", or "Advanced · 2 set" when two of its controls are on. */
export function setLabel(title: string, set: number): string {
  return set > 0 ? `${title} · ${set} set` : title;
}

/** Whether a control holds a non-default or active value. */
export type IsSet = () => boolean;

/** A control that reports isSet, and where it sits (a sub-section's name, "debug", or plain Advanced). */
export interface SetReporter {
  where: string | null;
  isSet: IsSet;
}

/**
 * How many reporters are set: in all of Advanced, and per sub-section or
 * Debug. A reporter that throws counts as not set.
 */
export function countSet(reporters: readonly SetReporter[]): { total: number; by: Map<string, number> } {
  const by = new Map<string, number>();
  let total = 0;
  for (const r of reporters) {
    let on = false;
    try {
      on = r.isSet();
    } catch {
      on = false;
    }
    if (!on) continue;
    total++;
    if (r.where !== null) by.set(r.where, (by.get(r.where) ?? 0) + 1);
  }
  return { total, by };
}

/** Where a section call puts things: plain Advanced, a sub-section of it, or Debug. */
export type SectionName = "advanced" | "debug" | `advanced/${string}`;

export class Disclosure {
  private details: HTMLDetailsElement | null = null;
  private summary: HTMLElement | null = null;
  private items: HTMLElement | null = null;
  private subsEl: HTMLElement | null = null;
  private subs = new Map<string, HTMLElement>();
  private subSummaries = new Map<string, HTMLElement>();
  private debug: HTMLElement | null = null;
  private debugTitle: HTMLElement | null = null;
  private reporters: SetReporter[] = [];

  /**
   * @param store   local storage (the App)
   * @param surface stable id of the surface, e.g. "Settings", "GenPage"
   * @param host    where the dropdown goes (read at creation, so a
   *                re-rendered surface can hand over its new container)
   */
  constructor(
    private store: LocalStore,
    readonly surface: string,
    private host: () => HTMLElement,
  ) {}

  get debugMode(): boolean {
    return isDebugMode(this.store);
  }

  /**
   * The Advanced dropdown's container, one of its sub-sections'
   * (`advanced/<Sub-section>`), or Debug's (null while debug mode is off).
   */
  section(layer: SectionName): HTMLElement | null {
    if (layer === "debug" && !this.debugMode) return null;
    if (!this.details?.isConnected) this.build();
    if (layer === "advanced") return this.items;
    if (layer !== "debug") {
      const sub = parsePlacement(layer)?.sub;
      return sub ? this.subSection(sub) : this.items;
    }
    if (!this.debug?.isConnected) {
      this.debug = this.details!.createDiv({ cls: "duckmage-disclosure-debug" });
      this.debugTitle = this.debug.createDiv({ cls: "duckmage-disclosure-debug-title", text: "Debug" });
    }
    return this.debug;
  }

  /**
   * The parent control `id` should be built in: `here` for main and more,
   * the Advanced container (or its sub-section) or Debug's, or null when it
   * isn't shown (hidden, or Debug while debug mode is off).
   */
  target(id: string, here: HTMLElement, isSet?: IsSet): HTMLElement | null {
    const { layer, sub } = this.lookup(id);
    if (layer === "main" || layer === "more") return here;
    if (layer === "hidden") return null;
    const to = this.section(layer === "advanced" && sub ? `advanced/${sub}` : layer);
    if (to && isSet) this.addReporter(layer === "debug" ? "debug" : (sub ?? null), isSet);
    return to;
  }

  /**
   * Put a built control where the placement map says: left where it is for
   * main and more, moved into Advanced (or its sub-section) or Debug, or
   * removed when it isn't shown. Returns whether it is shown.
   */
  place(id: string, el: HTMLElement, isSet?: IsSet): boolean {
    const { layer } = this.lookup(id);
    if (layer === "main" || layer === "more") return true;
    const to = this.target(id, el, isSet);
    if (!to) {
      el.remove();
      return false;
    }
    // Plain advanced controls, then sub-sections, then Debug: each has its own container.
    to.appendChild(el);
    return true;
  }

  /**
   * Count control `id` in its header while `isSet()` (when it is in
   * Advanced or Debug and shown). For a control placed or built some other way.
   */
  track(id: string, isSet: IsSet): void {
    const { layer, sub } = this.lookup(id);
    if (layer !== "advanced" && layer !== "debug") return;
    if (!this.section(layer === "advanced" && sub ? `advanced/${sub}` : layer)) return;
    this.addReporter(layer === "debug" ? "debug" : (sub ?? null), isSet);
  }

  /** Re-count the set controls and update the headers. */
  refreshSet(): void {
    if (!this.reporters.length || !this.summary) return;
    const { total, by } = countSet(this.reporters);
    this.summary.setText(setLabel("Advanced", total));
    for (const [name, el] of this.subSummaries) el.setText(setLabel(name, by.get(name) ?? 0));
    this.debugTitle?.setText(setLabel("Debug", by.get("debug") ?? 0));
  }

  private addReporter(where: string | null, isSet: IsSet): void {
    this.reporters.push({ where, isSet });
    this.refreshSet();
  }

  /** Move the dropdown (if there is one) to the end of the host, e.g. below content built after it. */
  toEnd(): void {
    if (this.details?.isConnected) this.host().appendChild(this.details);
  }

  /** Is there an Advanced dropdown on the surface now. */
  get exists(): boolean {
    return !!this.details?.isConnected;
  }

  private lookup(id: string): { layer: Layer; sub?: string } {
    const value = Object.prototype.hasOwnProperty.call(PLACEMENT, id) ? PLACEMENT[id] : undefined;
    return parsePlacement(value) ?? { layer: "main" };
  }

  private subSection(name: string): HTMLElement {
    const have = this.subs.get(name);
    if (have?.isConnected) return have;
    const sub = this.subsEl!.createEl("details", { cls: "duckmage-disclosure-sub" });
    this.subSummaries.set(name, sub.createEl("summary", { cls: "duckmage-disclosure-sub-summary", text: name }));
    const key = subSectionKey(this.surface, name);
    sub.open = disclosureOpen(this.store, key);
    sub.addEventListener("toggle", () => setDisclosureOpen(this.store, key, sub.open));
    const body = sub.createDiv({ cls: "duckmage-disclosure-sub-body" });
    this.subs.set(name, body);
    return body;
  }

  private build(): void {
    const details = this.host().createEl("details", { cls: "duckmage-disclosure" });
    this.summary = details.createEl("summary", { cls: "duckmage-disclosure-summary", text: "Advanced" });
    details.open = disclosureOpen(this.store, this.surface);
    details.addEventListener("toggle", () => setDisclosureOpen(this.store, this.surface, details.open));
    // A control inside changed: re-count the set ones.
    for (const type of ["input", "change", "click"]) details.addEventListener(type, () => this.refreshSet());
    this.details = details;
    this.items = details.createDiv({ cls: "duckmage-disclosure-body" });
    this.subsEl = details.createDiv({ cls: "duckmage-disclosure-subs" });
    this.subs.clear();
    this.subSummaries.clear();
    this.debug = null;
    this.debugTitle = null;
    this.reporters = [];
  }
}
