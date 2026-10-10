import { setIcon } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { MapData } from "../types";
import { BADGE_INFO, BADGE_SECTIONS, BADGE_SIZES, badgeHideClass, badgeSize, hiddenBadges, toggleHiddenBadge } from "./linkBadges";

// ── Abstract base ────────────────────────────────────────────────────────────

export abstract class HexSidePanel {
  protected panelEl: HTMLDivElement;
  private toggleBtn: HTMLButtonElement;
  private _isOpen = false;
  /** Called just before this panel opens — used for mutual exclusion. */
  public onBeforeOpen?: () => void;

  constructor(
    container: HTMLElement,
    iconName: string,
    rightOffset: number,
    title: string,
  ) {
    this.toggleBtn = container.createEl("button", {
      cls: "duckmage-panel-toggle-btn",
      attr: { title },
    });
    this.toggleBtn.style.right = `${rightOffset}px`;
    setIcon(this.toggleBtn, iconName);
    this.toggleBtn.addEventListener("click", () => this.toggle());

    this.panelEl = container.createDiv({ cls: "duckmage-side-panel" });
    this.panelEl.style.right = `${rightOffset - 4}px`;
    this.panelEl.hide();
    // Subclasses must call this.buildPanel(this.panelEl) after super() returns,
    // once their own fields are initialised.
  }

  protected abstract buildPanel(panel: HTMLDivElement): void;

  toggle(): void {
    if (this._isOpen) this.close();
    else this.open();
  }

  open(): void {
    this.onBeforeOpen?.();
    this._isOpen = true;
    this.panelEl.show();
    this.toggleBtn.addClass("is-active");
  }

  close(): void {
    this._isOpen = false;
    this.panelEl.hide();
    this.toggleBtn.removeClass("is-active");
  }

  get isOpen(): boolean {
    return this._isOpen;
  }

  /** The panel box (to keep hexes out from under it while it's open). */
  get element(): HTMLElement {
    return this.panelEl;
  }
}

// ── Drawing tool panel ───────────────────────────────────────────────────────

/** Callback signature the view passes in to build the drawing toolbar content. */
export type DrawingToolbarBuilder = (panel: HTMLDivElement) => void;

export class DrawingToolPanel extends HexSidePanel {
  private builder: DrawingToolbarBuilder;

  constructor(container: HTMLElement, builder: DrawingToolbarBuilder) {
    super(container, "pencil", 8, "Drawing tools");
    this.builder = builder;
    this.buildPanel(this.panelEl);
  }

  protected buildPanel(panel: HTMLDivElement): void {
    this.builder(panel);
  }
}

// ── Overlay panel ────────────────────────────────────────────────────────────

export type OverlayKey =
  | "showCoords"
  | "showHexNames"
  | "showTokenNames"
  | "showTerrainIcons"
  | "showIconOverrides"
  | "showPaths";

interface OverlayOption {
  key: OverlayKey;
  label: string;
  cssClass: string;
  /** Shown in the compact "Labels" group rather than as its own row. */
  inLabels?: boolean;
}

const OVERLAY_OPTIONS: OverlayOption[] = [
  { key: "showTerrainIcons",  label: "Show terrain icons", cssClass: "duckmage-hide-terrain-icons" },
  { key: "showIconOverrides", label: "Show icon overrides",cssClass: "duckmage-hide-icon-overrides" },
  { key: "showPaths",         label: "Show paths",         cssClass: "duckmage-hide-paths" },
  // Labels: one group, so the menu doesn't grow a row per label kind.
  { key: "showCoords",     label: "Coordinates", cssClass: "duckmage-hide-coords",      inLabels: true },
  { key: "showHexNames",   label: "Hex names",   cssClass: "duckmage-hide-hex-names",   inLabels: true },
  { key: "showTokenNames", label: "Token names", cssClass: "duckmage-hide-token-names", inLabels: true },
];

/** Optional layers-menu rows (kept out of the positional callbacks). */
export interface OverlayPanelExtras {
  /** Terrain legend toggled (a plugin-wide setting, not per map). */
  onLegendChange?: (show: boolean) => void;
  /** Badge size or the badge kinds shown changed (redraw badges + legend). */
  onBadgesChange?: () => void;
}

export class OverlayPanel extends HexSidePanel {
  private plugin: HexmakerPlugin;
  private getViewportEl: () => HTMLElement | null;
  private getActiveMap: () => MapData;
  private onFactionOverlayChange: (show: boolean) => void;
  private onRegionOverlayChange: (show: boolean) => void;
  private onGmLayerChange: (show: boolean) => void;
  private onTokensChange: (show: boolean) => void;
  private checkboxes = new Map<OverlayKey, HTMLInputElement>();
  private factionOverlayCb: HTMLInputElement | null = null;
  private regionOverlayCb: HTMLInputElement | null = null;
  private gmLayerCb: HTMLInputElement | null = null;
  private tokensCb: HTMLInputElement | null = null;
  private badgesCb: HTMLInputElement | null = null;
  private badgeChips = new Map<string, HTMLButtonElement>();
  private badgeSizeBtns = new Map<string, HTMLButtonElement>();
  private legendCb: HTMLInputElement | null = null;
  private extras: OverlayPanelExtras;

  constructor(
    container: HTMLElement,
    plugin: HexmakerPlugin,
    getViewportEl: () => HTMLElement | null,
    getActiveMap: () => MapData,
    onFactionOverlayChange: (show: boolean) => void,
    onRegionOverlayChange: (show: boolean) => void,
    onGmLayerChange: (show: boolean) => void,
    onTokensChange: (show: boolean) => void,
    extras: OverlayPanelExtras = {},
  ) {
    super(container, "layers", 44, "Map overlays");
    this.plugin = plugin;
    this.getViewportEl = getViewportEl;
    this.getActiveMap = getActiveMap;
    this.onFactionOverlayChange = onFactionOverlayChange;
    this.onRegionOverlayChange = onRegionOverlayChange;
    this.onGmLayerChange = onGmLayerChange;
    this.onTokensChange = onTokensChange;
    this.extras = extras;
    this.buildPanel(this.panelEl);
  }

  protected buildPanel(panel: HTMLDivElement): void {
    // The Labels group comes first: one heading, its toggles side by side.
    const labelGroup = panel.createDiv({ cls: "duckmage-overlay-group" });
    labelGroup.createDiv({ cls: "duckmage-overlay-group-title", text: "Labels" });
    const labelRow = labelGroup.createDiv({ cls: "duckmage-overlay-group-row" });
    for (const opt of OVERLAY_OPTIONS) {
      const row = opt.inLabels
        ? labelRow.createDiv({ cls: "duckmage-overlay-row duckmage-overlay-label-toggle" })
        : panel.createDiv({ cls: "duckmage-overlay-row" });

      const cb = row.createEl("input", { type: "checkbox" });
      cb.checked = true; // default — refreshed in syncToRegion()
      this.checkboxes.set(opt.key, cb);

      const label = row.createSpan({ text: opt.label, cls: "duckmage-overlay-label" });

      const apply = () => {
        const region = this.getActiveMap();
        region[opt.key] = cb.checked;
        void this.plugin.saveSettings();
        this.applyClass(opt, cb.checked);
      };

      cb.addEventListener("change", apply);
      label.addEventListener("click", () => {
        cb.checked = !cb.checked;
        apply();
      });
    }

    // Show tokens — default on
    const tokensRow = panel.createDiv({ cls: "duckmage-overlay-row" });
    const tokensCb = tokensRow.createEl("input", { type: "checkbox" });
    tokensCb.checked = true;
    this.tokensCb = tokensCb;

    const tokensLabel = tokensRow.createSpan({
      text: "Show tokens",
      cls: "duckmage-overlay-label",
    });

    const applyTokens = () => {
      const map = this.getActiveMap();
      map.showTokens = tokensCb.checked;
      void this.plugin.saveSettings();
      this.onTokensChange(tokensCb.checked);
    };

    tokensCb.addEventListener("change", applyTokens);
    tokensLabel.addEventListener("click", () => {
      tokensCb.checked = !tokensCb.checked;
      applyTokens();
    });

    // Faction overlay — triggers a re-render rather than a CSS class toggle
    const factionRow = panel.createDiv({ cls: "duckmage-overlay-row" });
    const factionCb = factionRow.createEl("input", { type: "checkbox" });
    factionCb.checked = false; // default — refreshed in syncToRegion()
    this.factionOverlayCb = factionCb;

    const factionLabel = factionRow.createSpan({
      text: "Show faction overlay",
      cls: "duckmage-overlay-label",
    });

    const applyFaction = () => {
      const map = this.getActiveMap();
      map.showFactionOverlay = factionCb.checked;
      void this.plugin.saveSettings();
      this.onFactionOverlayChange(factionCb.checked);
    };

    factionCb.addEventListener("change", applyFaction);
    factionLabel.addEventListener("click", () => {
      factionCb.checked = !factionCb.checked;
      applyFaction();
    });

    // Region overlay — same pattern as faction
    const regionRow = panel.createDiv({ cls: "duckmage-overlay-row" });
    const regionCb = regionRow.createEl("input", { type: "checkbox" });
    regionCb.checked = false;
    this.regionOverlayCb = regionCb;

    const regionLabel = regionRow.createSpan({
      text: "Show region overlay",
      cls: "duckmage-overlay-label",
    });

    const applyRegion = () => {
      const map = this.getActiveMap();
      map.showRegionOverlay = regionCb.checked;
      void this.plugin.saveSettings();
      this.onRegionOverlayChange(regionCb.checked);
    };

    regionCb.addEventListener("change", applyRegion);
    regionLabel.addEventListener("click", () => {
      regionCb.checked = !regionCb.checked;
      applyRegion();
    });

    // GM layer — default on (unlike the opt-in overlays above)
    const gmRow = panel.createDiv({ cls: "duckmage-overlay-row" });
    const gmCb = gmRow.createEl("input", { type: "checkbox" });
    gmCb.checked = true;
    this.gmLayerCb = gmCb;

    const gmLabel = gmRow.createSpan({
      text: "Show GM layer",
      cls: "duckmage-overlay-label",
    });

    const applyGm = () => {
      const map = this.getActiveMap();
      map.showGmLayer = gmCb.checked;
      void this.plugin.saveSettings();
      this.onGmLayerChange(gmCb.checked);
    };

    gmCb.addEventListener("change", applyGm);
    gmLabel.addEventListener("click", () => {
      gmCb.checked = !gmCb.checked;
      applyGm();
    });

    this.buildBadgeRows(panel);

    // Terrain legend — plugin-wide (also in generator previews), on by default
    const legendRow = panel.createDiv({ cls: "duckmage-overlay-row" });
    const legendCb = legendRow.createEl("input", { type: "checkbox" });
    legendCb.checked = this.plugin.settings.showTerrainLegend ?? true;
    this.legendCb = legendCb;
    const legendLabel = legendRow.createSpan({ text: "Show legend", cls: "duckmage-overlay-label" });
    const applyLegend = () => {
      this.plugin.settings.showTerrainLegend = legendCb.checked;
      void this.plugin.saveSettings();
      this.extras.onLegendChange?.(legendCb.checked);
    };
    legendCb.addEventListener("change", applyLegend);
    legendLabel.addEventListener("click", () => {
      legendCb.checked = !legendCb.checked;
      applyLegend();
    });

  }

  /**
   * Link badges: one row (master toggle + a ▸ that unfolds a compact strip
   * of per-type chips) so the menu doesn't grow a row per link type.
   * Only CSS classes on the viewport change: no re-render on toggle.
   */
  private buildBadgeRows(panel: HTMLDivElement): void {
    const row = panel.createDiv({ cls: "duckmage-overlay-row" });
    const cb = row.createEl("input", { type: "checkbox" });
    cb.checked = true;
    this.badgesCb = cb;
    const label = row.createSpan({ text: "Show link badges", cls: "duckmage-overlay-label" });
    // Badge size, per map (round 7 R8): S / M / L beside the toggle.
    const sizes = row.createDiv({ cls: "duckmage-overlay-sizes", attr: { role: "group", "aria-label": "Badge size" } });
    for (const s of BADGE_SIZES) {
      const b = sizes.createEl("button", {
        cls: "duckmage-overlay-size",
        text: s.toUpperCase(),
        attr: { "aria-label": `Badge size ${s.toUpperCase()}` },
      });
      this.badgeSizeBtns.set(s, b);
      b.addEventListener("click", () => {
        const map = this.getActiveMap();
        map.linkBadgeSize = s;
        void this.plugin.saveSettings();
        this.applyBadgeClasses(map);
        this.extras.onBadgesChange?.();
      });
    }
    const more = row.createEl("button", {
      cls: "clickable-icon duckmage-overlay-more",
      attr: { "aria-label": "Pick badge types", "aria-expanded": "false" },
    });
    setIcon(more, "chevron-right");
    const chips = panel.createDiv({ cls: "duckmage-overlay-subrow" });
    chips.hide();
    more.addEventListener("click", () => {
      const open = !chips.isShown();
      chips.toggle(open);
      more.toggleClass("is-open", open);
      more.setAttr("aria-expanded", String(open));
    });

    const apply = () => {
      const map = this.getActiveMap();
      map.showLinkBadges = cb.checked;
      void this.plugin.saveSettings();
      this.applyBadgeClasses(map);
      this.extras.onBadgesChange?.();
    };
    cb.addEventListener("change", apply);
    label.addEventListener("click", () => {
      cb.checked = !cb.checked;
      apply();
    });

    for (const s of BADGE_SECTIONS) {
      const info = BADGE_INFO[s];
      const chip = chips.createEl("button", {
        cls: `duckmage-overlay-chip duckmage-link-badge-${info.cls}`,
        attr: { "aria-label": `${info.label} badges` },
      });
      setIcon(chip, info.icon);
      this.badgeChips.set(s, chip);
      chip.addEventListener("click", () => {
        const map = this.getActiveMap();
        map.hiddenLinkBadges = toggleHiddenBadge(map.hiddenLinkBadges, s);
        void this.plugin.saveSettings();
        this.applyBadgeClasses(map);
        this.extras.onBadgesChange?.();
      });
    }
  }

  private applyBadgeClasses(map: MapData): void {
    const show = map.showLinkBadges ?? true;
    const hidden = new Set(hiddenBadges(map));
    if (this.badgesCb) this.badgesCb.checked = show;
    const size = badgeSize(map.linkBadgeSize);
    for (const [s, b] of this.badgeSizeBtns) {
      b.toggleClass("is-active", s === size);
      b.setAttr("aria-pressed", String(s === size));
    }
    for (const [s, chip] of this.badgeChips) {
      chip.toggleClass("is-off", hidden.has(s));
      chip.setAttr("aria-pressed", String(!hidden.has(s)));
    }
    const vp = this.getViewportEl();
    if (!vp) return;
    vp.toggleClass("duckmage-hide-link-badges", !show);
    for (const s of BADGE_SECTIONS) vp.toggleClass(badgeHideClass(s), hidden.has(s));
  }

  /** Read the current map's saved state and apply it to the viewport + checkboxes. */
  syncToRegion(): void {
    const map = this.getActiveMap();
    for (const opt of OVERLAY_OPTIONS) {
      // undefined → true (backwards compat)
      const value = map[opt.key];
      const show = value === undefined ? true : Boolean(value);
      const cb = this.checkboxes.get(opt.key);
      if (cb) cb.checked = show;
      this.applyClass(opt, show);
    }
    // Faction overlay — undefined → false (opt-in)
    if (this.factionOverlayCb) {
      const show = map.showFactionOverlay ?? false;
      this.factionOverlayCb.checked = show;
      this.onFactionOverlayChange(show);
    }
    // Region overlay — undefined → false (opt-in)
    if (this.regionOverlayCb) {
      const show = map.showRegionOverlay ?? false;
      this.regionOverlayCb.checked = show;
      this.onRegionOverlayChange(show);
    }
    // GM layer — undefined → true (on by default)
    if (this.gmLayerCb) {
      const show = map.showGmLayer ?? true;
      this.gmLayerCb.checked = show;
      this.onGmLayerChange(show);
    }
    // Show tokens — undefined → true (on by default)
    if (this.tokensCb) {
      const show = map.showTokens ?? true;
      this.tokensCb.checked = show;
      this.onTokensChange(show);
    }
    this.applyBadgeClasses(map);
    this.syncLegendToggle();
  }

  /** Legend checkbox ← setting (the legend's own × also turns it off). */
  syncLegendToggle(): void {
    if (this.legendCb) this.legendCb.checked = this.plugin.settings.showTerrainLegend ?? true;
  }

  private applyClass(opt: OverlayOption, show: boolean): void {
    const vp = this.getViewportEl();
    if (!vp) return;
    if (show) {
      vp.removeClass(opt.cssClass);
    } else {
      vp.addClass(opt.cssClass);
    }
  }
}
