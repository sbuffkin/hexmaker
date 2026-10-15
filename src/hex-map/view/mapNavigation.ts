/**
 * Moving between maps (L2j, split out of HexMapView): Back / Forward / Up
 * and their history, the breadcrumb and arrows, the neighbour flower /
 * d-pad, walking into new land, the New place bar, child maps made or
 * linked from a hex, and landing on a hex (centred, flashed). Switching the
 * open map itself stays with the view (host.switchToMap).
 */
import { Notice, type App } from "obsidian";
import type HexmakerPlugin from "../../HexmakerPlugin";
import { ancestorNeighbourCrumbs, neighbourCrumbs } from "../../maps/mapTree";
import { flowerLayout, flowerPetals, MapHistory, navArrows, neighbourButton, PAD_SIDES, padButtonText } from "../../maps/mapNav";
import { hexChildMaps, parentHexTerrain, regionMapAt, submapKindLabel } from "../../maps/submaps";
import type { WorldMapsApi } from "../../modules/world-maps/api";
import type { BiomeHost } from "../../overworld/BiomeModals";
import type { OverworldWalk } from "../../overworld/WalkRegionModal";
import { ADD_REGION_LOCKED_HINT, canAdd, canRerollPlace, WORK_MODE_TEXT } from "../../workMode";
import type { Side } from "../../worldgen/world";
import { recipeOf } from "../../worldgen/freshMap";
import { neighbourSpec } from "../../worldgen/neighbours";
import { hexKeyCoords } from "../hexHover";
import { LocationsModal } from "../LocationsModal";
import { startNewChildMap, startNewLocation, type NewChildMapHost } from "../newChildMap";
import { mayAutoPan, revealDelta, usableInsets } from "../safeArea";
import { mapAncestors } from "../submapNav";
import { SubmapPickerModal } from "../SubmapPickerModal";
import type { DrawingMode } from "../toolMode";
import type { MapToolbar } from "./mapToolbar";
import type { MapViewport } from "./mapViewport";
import type { UndoController } from "./undoController";
import { hexKey, hexXY } from "../../hexKey";

export interface MapNavigationHost {
  activeMapName(): string;
  viewportEl(): HTMLElement | null;
  /** The map picker button (the top row's fit measures it). */
  mapBtn(): HTMLButtonElement | null;
  drawingMode(): DrawingMode | null;
  wm(): WorldMapsApi | undefined;
  viewport: Pick<MapViewport, "measureOverlayInsets" | "panBy">;
  undos: Pick<UndoController, "updateUndoButton">;
  toolbar: Pick<MapToolbar, "exitPathMode">;
  /** Show map `name` (the view's open map changes; its viewport is restored). */
  switchToMap(name: string): void;
  exitCurrentMode(): void;
  renderGrid(): void;
  centerOnHex(x: number, y: number, keepHexWidth?: number): void;
  setSelectedHex(x: number, y: number): void;
  refreshWorkModeBtn(): void;
  openHexEditorModal(x: number, y: number): void;
  openEditRegion(px: number, py: number, overworld?: string): void;
  biomeHost(): BiomeHost;
}

export class MapNavigation {
  /** Back / Forward between maps, like a browser. */
  private history = new MapHistory();
  crumbsEl: HTMLElement | null = null;
  /** ← ↑ →: always in that order, glyphs only (see mapNav.ts). */
  navArrowsEl: HTMLElement | null = null;
  /** Sideways crumbs: the neighbouring regions of the open map. */
  sideCrumbsEl: HTMLElement | null = null;
  /** Reroll / Lock for a place made on arrival (refreshArrivalBar). */
  arrivalBarEl: HTMLElement | null = null;

  constructor(private plugin: HexmakerPlugin, private host: MapNavigationHost) {}

  private get app(): App {
    return this.plugin.app;
  }

  private get activeMapName(): string {
    return this.host.activeMapName();
  }

  /**
   * The one way to change maps from the UI (map list, breadcrumb, submap
   * badge, Ctrl+click, context menu, hex editor, Up/Back targets). Exits the
   * active tool and clears undo — undo entries hold bare x/y and would apply
   * to the wrong map — and records history for Back. `offerModule`: the map
   * was picked on purpose (maps picker, region menu), so offer to turn its
   * module on when it's off (CM6). Never set from "New …" flows.
   */
  navigateToMap(name: string, opts: { recordHistory?: boolean; offerModule?: boolean } = {}): void {
    if (!this.plugin.getMap(name)) {
      new Notice(`Map "${name}" no longer exists.`);
      return;
    }
    if (name === this.activeMapName) {
      this.host.renderGrid();
      return;
    }
    this.host.exitCurrentMode();
    this.host.toolbar.exitPathMode();
    if (opts.recordHistory !== false) this.history.visit(this.activeMapName);
    this.host.switchToMap(name);
    // Each map keeps its own undo queues (WM6): show the new map's.
    this.host.undos.updateUndoButton();
    if (opts.offerModule) this.plugin.offerModuleFor(name);
  }

  /**
   * Open map `name` centred on hex (x, y), the hex flashed and selected: a
   * hex link (src/hexLink.ts, copied from the hex editor's centre dot).
   * Waits for the grid to be drawn and sized (a freshly opened view).
   */
  goToHex(name: string, x: number, y: number, opts: { recordHistory?: boolean } = {}): void {
    if (!this.plugin.getMap(name)) {
      new Notice(`Map "${name}" no longer exists.`);
      return;
    }
    if (name !== this.activeMapName) this.navigateToMap(name, opts);
    let tries = 0;
    const attempt = () => {
      if (this.activeMapName !== name) return;
      const clip = this.host.viewportEl()?.parentElement;
      const hexEl = this.host.viewportEl()?.querySelector(`[data-x="${x}"][data-y="${y}"]`);
      if ((!hexEl || !clip || clip.clientWidth === 0) && ++tries < 25) {
        window.setTimeout(attempt, 80);
        return;
      }
      this.host.setSelectedHex(x, y);
      this.host.centerOnHex(x, y);
      this.flashHex(x, y);
    };
    window.setTimeout(attempt, 80);
  }

  /** Back to the previously viewed map (skips maps deleted since). */
  navigateBack(): boolean {
    const prev = this.history.goBack(this.activeMapName, (m) => !!this.plugin.getMap(m));
    if (!prev) {
      this.refreshMapNav();
      return false;
    }
    this.navigateToMap(prev, { recordHistory: false });
    return true;
  }

  /** Forward again after Back. */
  navigateForward(): boolean {
    const next = this.history.goForward(this.activeMapName, (m) => !!this.plugin.getMap(m));
    if (!next) {
      this.refreshMapNav();
      return false;
    }
    this.navigateToMap(next, { recordHistory: false });
    return true;
  }

  canNavigateForward(): boolean {
    return this.history.peekForward(this.activeMapName, (m) => !!this.plugin.getMap(m)) !== undefined;
  }

  /** Up to the map this one is a submap of, flashing the hex we came from. */
  navigateUp(): boolean {
    const parent = this.plugin.parentOf(this.activeMapName);
    if (!parent) return false;
    this.navigateToMap(parent.map);
    const { x, y } = hexXY(parent.hex);
    window.requestAnimationFrame(() => this.flashHex(x, y));
    return true;
  }

  /**
   * "New map from this hex…" for hex (x, y): Region or Location (K1), then
   * the setup modal (size, palette, generator, preview). On create, links
   * the hex and enters the new map.
   */
  openNewSubmapSetup(x: number, y: number): void {
    startNewChildMap(this.childMapHost(), this.activeMapName, x, y);
  }

  /**
   * Go into hex (x, y) where nothing exists yet (arrival, GM4/SP4): its On
   * arrival table is rolled, its place made from the result with no form,
   * and the view enters it.
   */
  async arriveAt(x: number, y: number): Promise<void> {
    const from = this.activeMapName;
    const made = await this.plugin.arrival.arrive(from, x, y);
    if (made && this.activeMapName === from) this.navigateToMap(made);
    else this.host.renderGrid();
  }

  /** Redraw the New place bar (after a lock elsewhere: the Lock button, the first hand edit). */
  refreshPlaceBar(): void {
    this.refreshArrivalBar();
  }

  /**
   * The bar for a place made on arrival (GM4): Reroll makes it again (any
   * mode until locked, then God), Lock keeps it. Hidden on other maps.
   */
  refreshArrivalBar(): void {
    const el = this.arrivalBarEl;
    if (!el) return;
    el.empty();
    const map = this.plugin.getMap(this.activeMapName);
    const state = map?.arrival?.trim().toLowerCase();
    const wasShown = el.isShown();
    // The toolbar row fits itself to what it holds (fitTopBar).
    const hide = () => { el.hide(); if (wasShown) this.fitTopBar(); };
    // Places made from a hex, and fresh maps made by New map → Generate (SF7: their recipe).
    const fresh = !map?.parent && !!recipeOf(map);
    if (!map || (state !== "open" && state !== "locked") || (!map.parent && !fresh)) { hide(); return; }
    const open = state === "open";
    // A locked place shows the bar only where it can still be rerolled (God).
    if (!open && !canRerollPlace(map)) { hide(); return; }
    el.show();
    // "New location" / "Locked region" (owner Q9/R1: never "place").
    const kind = fresh ? "Map" : submapKindLabel(map);
    const word = kind.toLowerCase();
    el.createSpan({ cls: "duckmage-arrival-bar-label", text: open ? `New ${word}` : `Locked ${word}` });
    const reroll = el.createEl("button", {
      text: "Reroll",
      attr: { title: open ? `Make this ${word} again with a new seed (its terrain and paths are replaced)` : `Make this locked ${word} again with a new seed (God mode)` },
    });
    reroll.addEventListener("click", () => void this.plugin.arrival.reroll(map.name).then(() => { this.refreshArrivalBar(); this.host.renderGrid(); }));
    if (open) {
      const lock = el.createEl("button", { text: "Lock", attr: { title: `Keep this ${word} as it is (rerolling it then needs ${WORK_MODE_TEXT.god.label} mode)` } });
      lock.addEventListener("click", () => void this.plugin.arrival.lock(map.name).then(() => this.refreshArrivalBar()));
    }
    this.fitTopBar();
  }

  /** "+ New location…" straight away (the Locations list's button). */
  private openNewLocationSetup(x: number, y: number): void {
    startNewLocation(this.childMapHost(), this.activeMapName, x, y);
  }

  private childMapHost(): NewChildMapHost {
    const parentMap = this.activeMapName;
    return {
      app: this.app,
      plugin: this.plugin,
      onCreated: (name) => {
        if (this.activeMapName === parentMap) this.navigateToMap(name);
        else this.host.renderGrid();
      },
      onEnter: (name) => this.navigateToMap(name),
    };
  }

  /** "Link existing map…" for hex (x, y): the picked map joins its locations. */
  openLinkExistingMap(x: number, y: number): void {
    const parentMap = this.activeMapName;
    const linked = hexChildMaps(this.plugin.mapStore.get(parentMap, hexKey(x, y)));
    new SubmapPickerModal(
      this.app,
      this.plugin,
      undefined,
      (mapName) => {
        void this.plugin.linkSubmap(parentMap, x, y, mapName).then(() => this.host.renderGrid());
      },
      undefined,
      () => this.openNewLocationSetup(x, y),
      { title: "Link existing map", exclude: [...linked, parentMap] },
    ).open();
  }

  /** The hex's Locations list (search, open, unlink, reorder). */
  openLocationsList(x: number, y: number): void {
    new LocationsModal(this.app, this.plugin, this.activeMapName, x, y, {
      open: (name) => this.navigateToMap(name),
      newLocation: () => this.openNewLocationSetup(x, y),
      linkExisting: () => this.openLinkExistingMap(x, y),
      changed: () => this.host.renderGrid(),
    }).open();
  }

  canNavigateBack(): boolean {
    return this.previousMapName() !== undefined;
  }

  /** The map Back would go to (skips maps deleted since and the current one). */
  private previousMapName(): string | undefined {
    return this.history.peekBack(this.activeMapName, (m) => !!this.plugin.getMap(m));
  }

  canNavigateUp(): boolean {
    return this.plugin.parentOf(this.activeMapName) !== undefined;
  }

  /** Brief ripple on a hex so the eye lands on it after a map change. */
  private flashHex(x: number, y: number): void {
    const hexEl = this.host.viewportEl()?.querySelector<HTMLElement>(`[data-x="${x}"][data-y="${y}"]`);
    if (!hexEl) return;
    this.revealHexEl(hexEl);
    const blip = hexEl.createSpan({ cls: "duckmage-hex-blip" });
    blip.addEventListener("animationend", () => blip.remove(), { once: true });
  }

  /** Pan just enough that a hex is fully visible, clear of the toolbar
   *  rows and an open side panel (round 4: the tools panel hid the hex a
   *  tester came back to from a submap). */
  private revealHexEl(hexEl: HTMLElement): void {
    if (!mayAutoPan(this.host.drawingMode())) return;
    const clipEl = this.host.viewportEl()?.parentElement;
    if (!clipEl) return;
    const clip = clipEl.getBoundingClientRect();
    if (clip.width === 0 || clip.height === 0) return;
    const h = hexEl.getBoundingClientRect();
    const ins = usableInsets(clip.width, clip.height, this.host.viewport.measureOverlayInsets());
    const dx = revealDelta(h.left - clip.left, h.right - clip.left, ins.left, clip.width - ins.right);
    const dy = revealDelta(h.top - clip.top, h.bottom - clip.top, ins.top, clip.height - ins.bottom);
    if (dx === 0 && dy === 0) return;
    this.host.viewport.panBy(dx, dy);
  }

  /** Breadcrumb (ancestors), the ← ↑ → arrows and the neighbour widget for the active map. */
  refreshMapNav(): void {
    this.refreshNavArrows();
    this.host.refreshWorkModeBtn();
    this.refreshSideCrumbs();
    const crumbs = this.crumbsEl;
    if (!crumbs) return;
    crumbs.empty();
    const ancestors = mapAncestors(this.activeMapName, (m) => this.plugin.parentOf(m)?.map);
    // The crumbs between the first and the last fold into one "…" when the
    // row is too narrow for them (fitTopBar); its tooltip and menu list them.
    const middle = ancestors.slice(1, -1);
    ancestors.forEach((name, i) => {
      const label = this.plugin.mapLabel(name);
      const isMiddle = i > 0 && i < ancestors.length - 1;
      const crumb = crumbs.createEl("button", {
        cls: `duckmage-map-crumb${isMiddle ? " duckmage-map-crumb-mid" : ""}`,
        text: label,
        attr: { title: `Go to ${label}` },
      });
      crumb.addEventListener("click", () => this.navigateToMap(name));
      crumbs.createSpan({ cls: `duckmage-map-crumb-sep${isMiddle ? " duckmage-map-crumb-mid" : ""}`, text: "›" });
      if (i === 0 && middle.length) {
        // Stands for the folded crumbs: the tooltip names them all, a click
        // goes to the nearest of them (one up from the last crumb shown).
        const nearest = middle[middle.length - 1];
        const more = crumbs.createEl("button", {
          cls: "duckmage-map-crumb duckmage-map-crumb-more",
          text: "…",
          attr: { title: `${middle.map((m) => this.plugin.mapLabel(m)).join(" › ")}\nGo to ${this.plugin.mapLabel(nearest)}` },
        });
        more.addEventListener("click", () => this.navigateToMap(nearest));
        crumbs.createSpan({ cls: "duckmage-map-crumb-sep duckmage-map-crumb-more", text: "›" });
      }
    });
    // What the hex this map was made from is ("from: barren world"), read
    // from the parent's map data (F11: a sector's world type was nowhere
    // in the system map made from it).
    const from = parentHexTerrain(this.plugin, this.activeMapName);
    if (from) {
      crumbs.createSpan({
        cls: "duckmage-map-crumb-from",
        text: `from: ${from.terrain}`,
        attr: { title: `Made from ${from.label}, a ${from.terrain} hex` },
      });
    }
    crumbs.toggle(ancestors.length > 0);
    this.fitTopBar();
  }

  /**
   * Keep the toolbar row clear of the top +/− buttons (the breadcrumb with
   * its "from: …" crowded them on deep maps). CSS caps the row short of the
   * side-panel buttons and lets the crumbs shrink (each with an ellipsis
   * and its full name in the tooltip); when they don't fit whole, the
   * middle ones fold into "…"; when the row still reaches the centred
   * +/− buttons, those move to the second row's right side; when the row
   * is still cramped there (its buttons overflow, or a crumb or the map
   * button is squeezed below its own size: "Dem…", "D…"), it wraps onto a
   * second line (user test 2026-10-12: the Build button covered the region
   * flower). Nothing in the row ever overlaps. Whatever sits below the row
   * starts at its measured bottom (--duckmage-top-band-bottom). Classes are
   * reset first, then read; the one write comes last.
   */
  fitTopBar(): void {
    const crumbs = this.crumbsEl;
    const nav = crumbs?.parentElement;
    const controls = nav?.parentElement;
    if (!crumbs || !nav || !controls) return;
    const top = controls.querySelector(":scope > .duckmage-expand-group-top");
    const cut = (el: Element) => el.scrollWidth > el.clientWidth + 1;
    // Cut short by the row, not by its own max-width (a long name's ellipsis is fine).
    const squeezed = (el: Element) => {
      if (!el.instanceOf(HTMLElement) || el.clientWidth === 0 || !cut(el)) return false;
      const max = parseFloat(activeWindow.getComputedStyle(el).maxWidth);
      return !(Number.isFinite(max) && el.offsetWidth >= max - 1);
    };
    const mapBtn = this.host.mapBtn();
    const cramped = () =>
      cut(nav) || squeezed(crumbs) || Array.from(crumbs.children).some(squeezed) || (!!mapBtn && squeezed(mapBtn));
    const fold = () => {
      crumbs.removeClass("is-folded");
      // Folded as soon as the crumbs don't fit whole (one is cut short or the row overflows).
      if (crumbs.querySelector(".duckmage-map-crumb-mid") && (cut(crumbs) || Array.from(crumbs.children).some(cut))) crumbs.addClass("is-folded");
    };
    const band = () => {
      const b = nav.getBoundingClientRect().bottom - controls.getBoundingClientRect().top;
      controls.setCssProps({ "--duckmage-top-band-bottom": `${Math.max(42, Math.ceil(b) + 6)}px` });
    };
    // First try: the row stops short of the centred +/- buttons.
    nav.removeClass("is-wrapped");
    nav.addClass("is-centred");
    controls.removeClass("duckmage-top-crowded");
    if (!nav.isConnected || nav.clientWidth === 0 || !top) { fold(); return; }
    fold();
    const right = Math.max(...Array.from(nav.children).map((c) => c.getBoundingClientRect().right));
    if (!cramped() && right + 8 <= top.getBoundingClientRect().left) { band(); return; }
    // The row's own buttons don't fit there: it takes the width and the +/- move down.
    nav.removeClass("is-centred");
    controls.addClass("duckmage-top-crowded");
    fold();
    // Still cramped with the width: the row wraps.
    if (cramped()) {
      nav.addClass("is-wrapped");
      fold();
    }
    band();
  }

  /**
   * ← back, ↑ parent, → forward: glyphs only, always in that order. When
   * any applies all three show (the others disabled) so they never shift;
   * the target map is in the tooltip.
   */
  refreshNavArrows(): void {
    const el = this.navArrowsEl;
    if (!el) return;
    el.empty();
    const parent = this.plugin.parentOf(this.activeMapName);
    const arrows = navArrows({
      back: this.previousMapName(),
      up: parent?.map,
      forward: this.history.peekForward(this.activeMapName, (m) => !!this.plugin.getMap(m)),
    });
    el.toggle(arrows.length > 0);
    for (const a of arrows) {
      const label = !a.target
        ? { back: "Back (no previous map)", up: "Up (no parent map)", forward: "Forward (nothing to go forward to)" }[a.id]
        : a.id === "back" ? `Back to ${this.plugin.mapLabel(a.target)} (Alt+←)`
        : a.id === "up" ? `Up to ${this.plugin.mapLabel(a.target)}, hex ${hexKeyCoords(parent!.hex)} (Alt+↑)`
        : `Forward to ${this.plugin.mapLabel(a.target)} (Alt+→)`;
      const btn = el.createEl("button", {
        cls: `duckmage-map-nav-arrow duckmage-map-${a.id}-btn`,
        text: a.glyph,
        attr: { title: label, "aria-label": label, "data-nav": a.id },
      });
      btn.disabled = !a.target;
      btn.addEventListener("click", () => {
        if (a.id === "back") this.navigateBack();
        else if (a.id === "up") this.navigateUp();
        else this.navigateForward();
      });
    }
  }

  /**
   * The neighbours of the open map, one click away, always in the same
   * places: a hex flower for a region of an overworld (its six neighbouring
   * regions, empty petals where there's none yet), a d-pad for maps on a
   * world grid. Names are in the tooltips, not on the bar.
   */
  refreshSideCrumbs(): void {
    const el = this.sideCrumbsEl;
    if (!el) return;
    el.empty();
    const maps = this.plugin.settings.maps;
    const wm = this.host.wm();
    const home = wm?.regionHome(this.plugin, this.activeMapName);
    if (wm && home) {
      const petals = flowerPetals(home.layout.orientation, home.layout.parentStagger, home.px, home.py);
      const palette = this.plugin.getMapPalette(home.overworld.name);
      const flower = el.createDiv({ cls: "duckmage-region-flower", attr: { role: "group", "aria-label": "Neighbouring regions" } });
      // 22px petals, spaced so none touch (flowerLayout); the card is sized to fit them.
      const fl = flowerLayout(petals);
      flower.setCssProps({ "--duckmage-flower-w": `${fl.width}px`, "--duckmage-flower-h": `${fl.height}px` });
      // The centre petal is this region: click it to edit the region.
      const here = flower.createEl("button", {
        cls: "duckmage-region-flower-petal is-here",
        attr: { title: `Here: ${this.plugin.mapLabel(this.activeMapName)}. Click to edit this region.`, "aria-label": "Edit region" },
      });
      here.setCssProps({ "--duckmage-petal-x": "0px", "--duckmage-petal-y": "0px" });
      here.addEventListener("click", () => this.host.openEditRegion(home.px, home.py, home.overworld.name));
      const lock = wm.walkLock(this.plugin, this.activeMapName, home.overworld.name);
      petals.forEach((p, i) => {
        const key = hexKey(p.hex[0], p.hex[1]);
        const region = regionMapAt(maps, home.overworld.name, key);
        const terrain = this.plugin.mapStore.get(home.overworld.name, key)?.terrain;
        const colour = terrain ? palette.find((t) => t.name === terrain)?.color : undefined;
        // An empty petal is new land: "+" walks into it (pick or roll its biome).
        const b = neighbourButton(p.bearing, region ? { name: region.name, label: this.plugin.mapLabel(region.name) } : undefined, {
          canMake: true,
          canAdd: !lock,
          lockedHint: lock ?? "",
          inGrid: wm.inOverworldGrid(home.overworld, p.hex[0], p.hex[1]),
        });
        const petal = flower.createEl("button", {
          cls: "duckmage-region-flower-petal" + (region ? "" : " is-empty is-new") + (b.action.kind === "locked" ? " is-locked" : ""),
          text: b.plus ? "+" : "",
          attr: { title: b.title, "aria-label": b.title, "data-side": p.bearing, "data-hex": key },
        });
        petal.setCssProps({ "--duckmage-petal-x": `${fl.at[i].x}px`, "--duckmage-petal-y": `${fl.at[i].y}px` });
        if (colour && region) petal.setCssProps({ "--duckmage-petal-bg": colour });
        petal.disabled = b.disabled;
        const action = b.action;
        if (action.kind === "go") petal.addEventListener("click", () => this.navigateToMap(action.target));
        else if (action.kind === "new") {
          petal.addEventListener("click", () => this.openWalk({ overworld: home.overworld.name, px: p.hex[0], py: p.hex[1], bearing: p.bearing }));
        }
      });
      el.show();
      return;
    }
    let side = neighbourCrumbs(this.plugin.getMap(this.activeMapName), maps);
    let via: string | null = null;
    if (side.length === 0) {
      // A submap: its parent's neighbours (round 6: one click, not two).
      const up = ancestorNeighbourCrumbs(this.activeMapName, maps, (m) => this.plugin.parentOf(m)?.map);
      if (up) {
        via = up.via;
        side = up.crumbs;
      }
    }
    if (!side.length) {
      el.hide();
      return;
    }
    const pad = el.createDiv({ cls: "duckmage-map-pad", attr: { role: "group", "aria-label": "Neighbouring maps" } });
    const active = this.plugin.getMap(this.activeMapName);
    for (const { side: s, glyph } of PAD_SIDES) {
      const c = side.find((x) => x.side === s);
      // An empty side of this map's own world is new land (the hex editor's
      // flower offers the same); a submap's borrowed pad only goes places.
      const b = neighbourButton(s, c ? { name: c.name, label: this.plugin.mapLabel(c.name) } : undefined, {
        canMake: !via && !!wm && neighbourSpec(this.plugin, this.activeMapName, s).ok,
        canAdd: canAdd(active),
        lockedHint: ADD_REGION_LOCKED_HINT,
      });
      const title = c && via ? `${s[0].toUpperCase() + s.slice(1)} of ${this.plugin.mapLabel(via)}: ${this.plugin.mapLabel(c.name)}` : b.title;
      const btn = pad.createEl("button", {
        cls: `duckmage-map-pad-btn is-${s}` + (b.plus ? " is-new" : "") + (b.action.kind === "locked" ? " is-locked" : ""),
        text: padButtonText(glyph, b.plus),
        attr: { title, "aria-label": title, "data-side": s },
      });
      btn.disabled = b.disabled;
      const action = b.action;
      if (action.kind === "go") btn.addEventListener("click", () => this.navigateToMap(action.target));
      else if (action.kind === "new") btn.addEventListener("click", () => this.openWalk(s));
    }
    el.show();
  }

  /**
   * Walk into new land from the open map (a "+" on the region flower or the
   * d-pad): pick or roll its biome, preview, create, then go there. The same
   * flow as the hex editor's neighbour flower: on an overworld, Edit
   * region's new-region mode; on an older side-by-side world, WalkRegionModal.
   */
  private openWalk(to: Side | OverworldWalk): void {
    const wm = this.host.wm();
    if (!wm) return;
    const from = this.activeMapName;
    const done = (name: string) => {
      if (this.activeMapName === from) this.navigateToMap(name);
      else this.refreshSideCrumbs();
    };
    // A region of an overworld: Edit region's new-region mode (direction label, grows the overworld, Create and go).
    if (typeof to !== "string") {
      const host = { ...this.host.biomeHost(), openLocations: () => undefined };
      new wm.EditRegionModal(host, to.overworld, to.px, to.py, { walk: { from, bearing: to.bearing }, onCreated: done }).open();
      return;
    }
    new wm.WalkRegionModal(this.app, this.plugin, from, to, done).open();
  }

  /** Switch to a neighbouring region and land on one of its hexes. */
  goToRegionHex(mapName: string, x: number, y: number, openEditor = false): void {
    // Walking across keeps the hex size on screen (round 5: the zoom jumped
    // to a fixed 1.5× on arrival); the arrival hex is centred in the
    // uncovered part of the view.
    const hexWidth = this.host.viewportEl()?.querySelector<HTMLElement>(".duckmage-hex")?.getBoundingClientRect().width;
    this.navigateToMap(mapName);
    window.setTimeout(() => {
      this.host.setSelectedHex(x, y);
      this.host.centerOnHex(x, y, hexWidth);
      if (openEditor) this.host.openHexEditorModal(x, y);
    }, 80);
  }

  /** Enter a region from the overworld, centred on (and flashing) the hex that was clicked. */
  enterRegionAt(region: string, x: number, y: number): void {
    this.navigateToMap(region);
    window.requestAnimationFrame(() => {
      this.host.centerOnHex(x, y);
      window.requestAnimationFrame(() => this.flashHex(x, y));
    });
  }

}
