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

import { setIcon } from "obsidian";
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

/** Where a section call puts things: plain Advanced, a sub-section of it, Debug, or a sub-section of Debug. */
export type SectionName = "advanced" | "debug" | `advanced/${string}` | `debug/${string}`;

/** Reporter `where` of Debug sub-section `sub` (counted in Debug's header and its own). */
const debugWhere = (sub: string) => `debug/${sub}`;

/** The section a looked-up placement goes in. */
function sectionOf(layer: Layer, sub: string | undefined): SectionName {
  if (layer === "advanced" && sub) return `advanced/${sub}`;
  if (layer === "debug" && sub) return `debug/${sub}`;
  return layer === "debug" ? "debug" : "advanced";
}

/** The reporter `where` of a looked-up placement. */
function whereOf(layer: Layer, sub: string | undefined): string | null {
  if (layer === "debug") return sub ? debugWhere(sub) : "debug";
  return sub ?? null;
}

export class Disclosure {
  private details: HTMLDetailsElement | null = null;
  private summary: HTMLElement | null = null;
  private items: HTMLElement | null = null;
  private subsEl: HTMLElement | null = null;
  private subs = new Map<string, HTMLElement>();
  private subSummaries = new Map<string, HTMLElement>();
  private debug: HTMLElement | null = null;
  private debugTitle: HTMLElement | null = null;
  private debugSubs = new Map<string, HTMLElement>();
  private debugSubSummaries = new Map<string, HTMLElement>();
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
    if ((layer === "debug" || layer.startsWith("debug/")) && !this.debugMode) return null;
    if (!this.details?.isConnected) this.build();
    if (layer === "advanced") return this.items;
    if (layer.startsWith("debug/")) {
      const debug = this.section("debug")!;
      return this.debugSubSection(debug, layer.slice("debug/".length).trim() || "Debug");
    }
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
    const to = this.section(sectionOf(layer, sub));
    if (to && isSet) this.addReporter(whereOf(layer, sub), isSet);
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
    if (!this.section(sectionOf(layer, sub))) return;
    this.addReporter(whereOf(layer, sub), isSet);
  }

  /** Re-count the set controls and update the headers. */
  refreshSet(): void {
    if (!this.reporters.length || !this.summary) return;
    const { total, by } = countSet(this.reporters);
    this.summary.setText(setLabel("Advanced", total));
    for (const [name, el] of this.subSummaries) el.setText(setLabel(name, by.get(name) ?? 0));
    for (const [name, el] of this.debugSubSummaries) el.setText(setLabel(name, by.get(debugWhere(name)) ?? 0));
    // Debug's header counts its own controls and its sub-sections'.
    let debugSet = by.get("debug") ?? 0;
    for (const [w, n] of by) if (w.startsWith("debug/")) debugSet += n;
    this.debugTitle?.setText(setLabel("Debug", debugSet));
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

  /** A collapsible sub-section of Debug (`debug/<Sub-section>`), closed at first, its open state remembered. */
  private debugSubSection(debug: HTMLElement, name: string): HTMLElement {
    const have = this.debugSubs.get(name);
    if (have?.isConnected) return have;
    const sub = debug.createEl("details", { cls: "duckmage-disclosure-sub duckmage-disclosure-debug-sub" });
    this.debugSubSummaries.set(name, sub.createEl("summary", { cls: "duckmage-disclosure-sub-summary", text: name }));
    const key = subSectionKey(this.surface, debugWhere(name));
    sub.open = disclosureOpen(this.store, key);
    sub.addEventListener("toggle", () => setDisclosureOpen(this.store, key, sub.open));
    const body = sub.createDiv({ cls: "duckmage-disclosure-sub-body" });
    this.debugSubs.set(name, body);
    return body;
  }

  /**
   * One item isn't worth a dropdown (owner, round 10): a sub-section holding
   * a single control folds into plain Advanced, and an Advanced dropdown
   * left holding a single control (and no Debug) shows it inline instead.
   * Runs once the surface has finished building (queued from build()).
   */
  settle(): void {
    if (!this.details?.isConnected || !this.items || !this.subsEl) return;
    for (const [name, body] of [...this.subs]) {
      if (!body.isConnected || body.childElementCount !== 1) continue;
      this.items.appendChild(body.firstElementChild!);
      body.parentElement?.remove();
      this.subs.delete(name);
      this.subSummaries.delete(name);
      for (const r of this.reporters) if (r.where === name) r.where = null;
    }
    // Likewise a Debug sub-section with one control folds into plain Debug.
    for (const [name, body] of [...this.debugSubs]) {
      if (!body.isConnected || body.childElementCount !== 1 || !this.debug) continue;
      const details = body.parentElement;
      this.debug.insertBefore(body.firstElementChild!, details);
      details?.remove();
      this.debugSubs.delete(name);
      this.debugSubSummaries.delete(name);
      for (const r of this.reporters) if (r.where === debugWhere(name)) r.where = "debug";
    }
    const hasDebug = !!this.debug?.isConnected;
    const subsLeft = [...this.subs.values()].some((b) => b.isConnected && b.childElementCount > 0);
    if (hasDebug || subsLeft || this.items.childElementCount !== 1) {
      this.refreshSet();
      return;
    }
    const only = this.items.firstElementChild!;
    this.details.parentElement?.insertBefore(only, this.details);
    this.details.remove();
    this.details = null;
    this.summary = null;
    this.reporters = [];
  }

  private build(): void {
    queueMicrotask(() => this.settle());
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
    this.debugSubs.clear();
    this.debugSubSummaries.clear();
    this.reporters = [];
  }
}

// ── Fold: a titled group that folds away (not Advanced) ────────────────────

/** Local-storage key: each fold's open state, by key (`{ "<key>": true|false }`). */
export const FOLD_STATE_KEY = "hexmaker-fold-state";

/** Whether fold `key` is open on this device: its remembered state, else `dflt`. */
export function foldOpen(store: LocalStore, key: string, dflt: boolean): boolean {
  const v = store.loadLocalStorage(FOLD_STATE_KEY);
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const s = (v as Record<string, unknown>)[key];
    if (typeof s === "boolean") return s;
  }
  return dflt;
}

/** Remember fold `key` open or closed on this device. */
export function setFoldOpen(store: LocalStore, key: string, open: boolean): void {
  const v = store.loadLocalStorage(FOLD_STATE_KEY);
  const state: Record<string, boolean> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, s] of Object.entries(v as Record<string, unknown>)) if (typeof s === "boolean") state[k] = s;
  }
  state[key] = open;
  store.saveLocalStorage(FOLD_STATE_KEY, state);
}

export interface FoldOptions {
  /** The header text ("Terrain mix"); "· N set" is added while tracked controls are on. */
  title: string;
  /** Open at first (before the user has folded it on this device). Default true. */
  open?: boolean;
  /**
   * Remember the open state on this device under `<surface>/<title>` (or
   * `key`). Without a store the fold opens as `open` says every time.
   */
  store?: LocalStore;
  /** Stable surface id for the remembered state ("GenPage"). */
  surface?: string;
  /** The remembered state's key, when the title changes (a count in it). Default: the title. */
  key?: string;
  /** Extra classes on the fold, its header and its body (to keep a surface's own spacing). */
  cls?: string;
  summaryCls?: string;
  bodyCls?: string;
  /** Called after the user opens or closes it. */
  onToggle?: (open: boolean) => void;
}

/**
 * A titled group of controls the user can fold away (audit D1–D3): every
 * fold that isn't the Advanced dropdown. A `<details>` with a chevron that
 * points right when closed and down when open; its open state is
 * remembered per surface on this device, like Disclosure's; and its header
 * counts the tracked controls that are on ("Terrain mix · 2 set").
 */
export class Fold {
  readonly el: HTMLDetailsElement;
  readonly summary: HTMLElement;
  readonly body: HTMLElement;
  readonly titleEl: HTMLElement;
  private title: string;
  private reporters: IsSet[] = [];

  constructor(parent: HTMLElement, private o: FoldOptions) {
    this.title = o.title;
    this.el = parent.createEl("details", { cls: `duckmage-fold${o.cls ? ` ${o.cls}` : ""}` });
    this.summary = this.el.createEl("summary", { cls: `duckmage-fold-summary${o.summaryCls ? ` ${o.summaryCls}` : ""}` });
    setIcon(this.summary.createSpan({ cls: "duckmage-fold-chevron" }), "chevron-right");
    this.titleEl = this.summary.createSpan({ cls: "duckmage-fold-title", text: o.title });
    this.body = this.el.createDiv({ cls: `duckmage-fold-body${o.bodyCls ? ` ${o.bodyCls}` : ""}` });
    const key = this.storeKey();
    this.el.open = o.store && key ? foldOpen(o.store, key, o.open ?? true) : (o.open ?? true);
    this.el.addEventListener("toggle", () => {
      if (o.store && key) setFoldOpen(o.store, key, this.el.open);
      o.onToggle?.(this.el.open);
    });
    for (const type of ["input", "change", "click"]) this.body.addEventListener(type, () => this.refreshSet());
  }

  private storeKey(): string | null {
    if (!this.o.store) return null;
    return subSectionKey(this.o.surface ?? "fold", this.o.key ?? this.o.title);
  }

  get open(): boolean {
    return this.el.open;
  }

  set open(v: boolean) {
    this.el.open = v;
  }

  /** Change the header text (a count in it). */
  setTitle(title: string): void {
    this.title = title;
    this.refreshSet();
  }

  /** Count a control in the header ("· N set") while `isSet()`. */
  track(isSet: IsSet): void {
    this.reporters.push(isSet);
    this.refreshSet();
  }

  /** Re-count the set controls and update the header. */
  refreshSet(): void {
    const { total } = countSet(this.reporters.map((isSet) => ({ where: null, isSet })));
    this.titleEl.setText(setLabel(this.title, total));
  }
}
