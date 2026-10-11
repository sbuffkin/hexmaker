/**
 * Local disclosure for one surface (a modal, page or the settings tab): the
 * collapsed "Advanced" dropdown and the "Debug" subsection inside it.
 *
 * - The Advanced dropdown is made the first time something goes in it, so
 *   a surface with nothing advanced shows none. It starts collapsed; its
 *   open state is remembered per surface on this device (local storage).
 * - Debug exists only while debug mode is on (src/ui/debugMode.ts); it sits
 *   at the end of Advanced, after the advanced controls.
 * - Where a control goes comes from the placement map (src/ui/placement.ts):
 *   `place(id, el)` moves a built control into its layer; `target(id, here)`
 *   gives the parent to build it in (null: don't build it).
 *
 * If the host is emptied and rebuilt (a re-render), the next call makes a
 * fresh dropdown in it.
 */

import { isDebugMode, type LocalStore } from "./debugMode";
import { layerOf, type Layer } from "./placement";

/** Local-storage key: surfaces whose Advanced dropdown was left open. */
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

export class Disclosure {
  private details: HTMLDetailsElement | null = null;
  private items: HTMLElement | null = null;
  private debug: HTMLElement | null = null;

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

  /** The Advanced dropdown's container, or Debug's inside it (null while debug mode is off). */
  section(layer: "advanced" | "debug"): HTMLElement | null {
    if (layer === "debug" && !this.debugMode) return null;
    if (!this.details?.isConnected) this.build();
    if (layer === "advanced") return this.items;
    if (!this.debug?.isConnected) {
      this.debug = this.details!.createDiv({ cls: "duckmage-disclosure-debug" });
      this.debug.createDiv({ cls: "duckmage-disclosure-debug-title", text: "Debug" });
    }
    return this.debug;
  }

  /**
   * The parent control `id` should be built in: `here` for main and more,
   * the Advanced or Debug container, or null when it isn't shown (hidden,
   * or Debug while debug mode is off).
   */
  target(id: string, here: HTMLElement): HTMLElement | null {
    const layer: Layer = layerOf(id);
    if (layer === "main" || layer === "more") return here;
    if (layer === "hidden") return null;
    return this.section(layer);
  }

  /**
   * Put a built control where the placement map says: left where it is for
   * main and more, moved into Advanced or Debug, or removed when it isn't
   * shown. Returns whether it is shown.
   */
  place(id: string, el: HTMLElement): boolean {
    const layer: Layer = layerOf(id);
    if (layer === "main" || layer === "more") return true;
    const to = layer === "hidden" ? null : this.section(layer);
    if (!to) {
      el.remove();
      return false;
    }
    // Advanced controls stay above Debug: they have their own container before it.
    to.appendChild(el);
    return true;
  }

  /** Move the dropdown (if there is one) to the end of the host, e.g. below content built after it. */
  toEnd(): void {
    if (this.details?.isConnected) this.host().appendChild(this.details);
  }

  /** Is there an Advanced dropdown on the surface now. */
  get exists(): boolean {
    return !!this.details?.isConnected;
  }

  private build(): void {
    const details = this.host().createEl("details", { cls: "duckmage-disclosure" });
    details.createEl("summary", { cls: "duckmage-disclosure-summary", text: "Advanced" });
    details.open = disclosureOpen(this.store, this.surface);
    details.addEventListener("toggle", () => setDisclosureOpen(this.store, this.surface, details.open));
    this.details = details;
    this.items = details.createDiv({ cls: "duckmage-disclosure-body" });
    this.debug = null;
  }
}
