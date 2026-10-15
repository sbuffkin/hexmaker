/**
 * The map's drawing toolbar (L2h, split out of HexMapView): the tool
 * buttons and their previews, the on-map mode bar naming the tool that's
 * on, the tool's right-click menu, and which tools the map's work mode
 * shows. The state and transitions it shows are ToolState's (toolState.ts).
 */
import { Notice } from "obsidian";
import { Disclosure } from "../../ui/disclosure";
import { isDebugMode } from "../../ui/debugMode";
import { getIconUrl, iconLabel } from "../../utils";
import { canDo } from "../../modeGate";
import { allows, lockedSummary, TOOL_ACTIONS, type ModeAction, type WorkMode } from "../../workMode";
import { GotoHexModal } from "../GotoHexModal";
import { PainterContextMenu, type PainterContextMenuOption } from "../PainterContextMenu";
import { REGION_AREAS_TOOL, toolModeLabel } from "../toolMode";
import { ToolState, type LinkTool } from "./toolState";

/** Name of the note a link tool paints, from its path. */
const noteName = (path: string, fallback: string) => path.split("/").pop()?.replace(/.md$/, "") ?? fallback;

/** Each link tool's button: its idle text, and what it says while on (null: the idle text). */
const LINK_LABELS: Record<LinkTool, { idle: string; active: (t: ToolState, erasing: boolean, mapLabel: (name: string) => string) => string | null }> = {
  tableLink: {
    idle: "Link table",
    active: (t, erasing) => (t.paintTablePath ? (erasing ? "Erase: " : "Link: ") + noteName(t.paintTablePath, "Table") : null),
  },
  submapLink: {
    idle: "Link submap",
    active: (t, erasing, mapLabel) =>
      erasing ? "Erase submap" : t.paintSubmapName ? "Link: " + mapLabel(t.paintSubmapName) : "Link submap",
  },
  factionLink: {
    idle: "Factions",
    active: (t, erasing) => (t.paintFactionPath ? (erasing ? "Erase: " : "Link: ") + noteName(t.paintFactionPath, "Faction") : null),
  },
  regionLink: {
    idle: REGION_AREAS_TOOL,
    active: (t, erasing) => (t.paintRegionPath ? (erasing ? "Erase: " : "Paint: ") + noteName(t.paintRegionPath, "Area") : null),
  },
};

export class MapToolbar extends ToolState {
  private pathToolbarBtn: HTMLButtonElement | null = null;
  private pathBtnSwatch: HTMLElement | null = null;
  private terrainToolbarBtn: HTMLButtonElement | null = null;
  private terrainBtnPreview: HTMLSpanElement | null = null;
  private iconToolbarBtn: HTMLButtonElement | null = null;
  private iconBtnPreview: HTMLImageElement | null = null;
  /** The link tools' buttons and labels. */
  private linkButtons = new Map<LinkTool, { btn: HTMLButtonElement; label: HTMLSpanElement }>();
  private swapBtn: HTMLButtonElement | null = null;
  /** The biome brush (overworlds only): its button and swatch. */
  private biomeToolbarBtn: HTMLButtonElement | null = null;
  private biomeBtnPreview: HTMLSpanElement | null = null;
  private tokenBtn: HTMLButtonElement | null = null;
  /** The drawing panel's one line naming the mode that unlocks the hidden tools. */
  private toolsLockedEl: HTMLElement | null = null;
  /** On-map "which tool is on" bar (fresh-eyes T3); text set in updateModeBar. */
  modeBarEl: HTMLElement | null = null;
  private modeBarTextEl: HTMLElement | null = null;
  /** Path tool controls in the mode bar (shown while drawing a path). */
  private modeBarRouteEl: HTMLElement | null = null;
  /** The open (or last) right-click tool menu, so Esc can close it first. */
  painterMenu: PainterContextMenu | null = null;

  /**
   * Mode bar: paint/draw tools are sticky, so say which one is on and how
   * to stop it (fresh-eyes T3). Hidden while no tool is active.
   */
  buildModeBar(controlsEl: HTMLElement): HTMLElement {
    this.modeBarEl = controlsEl.createDiv({
      cls: "duckmage-mode-bar",
      attr: { role: "status", "aria-live": "polite" },
    });
    this.modeBarTextEl = this.modeBarEl.createSpan({ cls: "duckmage-mode-bar-text" });
    this.modeBarRouteEl = this.modeBarEl.createSpan({ cls: "duckmage-mode-bar-route" });
    this.modeBarRouteEl.hide();
    this.modeBarEl.createSpan({
      cls: "duckmage-mode-bar-hint",
      text: "Right-click: options · Esc: stop",
    });
    const modeBarStop = this.modeBarEl.createEl("button", {
      cls: "duckmage-mode-bar-stop",
      text: "✕",
      attr: { title: "Stop this tool", "aria-label": "Stop this tool" },
    });
    modeBarStop.addEventListener("click", () => this.exitCurrentMode());
    this.modeBarEl.hide();
    return this.modeBarEl;
  }

  /** A link tool's button (its label kept by updateToolbarButtonStates). */
  private makeLinkButton(toolbar: HTMLElement, mode: LinkTool): HTMLButtonElement {
    const btn = toolbar.createEl("button", {
      cls: "duckmage-draw-btn duckmage-draw-btn-tablelink",
    });
    const label = btn.createSpan({
      text: LINK_LABELS[mode].idle,
    });
    btn.addEventListener("click", () => {
      if (mode === "tableLink") this.handleTableLinkButton();
      else if (mode === "submapLink") this.handleSubmapLinkButton();
      else if (mode === "factionLink") this.handleFactionLinkButton();
      else this.handleRegionLinkButton();
    });
    this.linkButtons.set(mode, { btn, label });
    return btn;
  }

  /**
   * Show only the tools the map's mode allows, with one line naming the
   * mode that unlocks the rest. Overworlds: the biome brush, and the
   * terrain tool only in the Regions view (MM1).
   */
  applyMode(mode: WorkMode, owView: "regions" | "biomes" | null): void {
    const tools: [HTMLElement | null | undefined, ModeAction][] = [
      [this.terrainToolbarBtn, TOOL_ACTIONS.terrain],
      [this.iconToolbarBtn, TOOL_ACTIONS.icon],
      [this.pathToolbarBtn, TOOL_ACTIONS.path],
      [this.linkButtons.get("tableLink")?.btn, TOOL_ACTIONS.tableLink],
      [this.linkButtons.get("submapLink")?.btn, TOOL_ACTIONS.submapLink],
      [this.linkButtons.get("factionLink")?.btn, TOOL_ACTIONS.factionLink],
      [this.linkButtons.get("regionLink")?.btn, TOOL_ACTIONS.regionLink],
      [this.tokenBtn, TOOL_ACTIONS.placeToken],
    ];
    const locked: ModeAction[] = [];
    for (const [btn, action] of tools) {
      const ok = allows(mode, action);
      btn?.toggle(ok);
      if (!ok) locked.push(action);
    }
    const biomeOk = allows(mode, TOOL_ACTIONS.biome);
    this.biomeToolbarBtn?.toggle(!!owView && biomeOk);
    if (owView && !biomeOk) locked.push(TOOL_ACTIONS.biome);
    if (this.terrainToolbarBtn) {
      const off = owView === "biomes";
      this.terrainToolbarBtn.disabled = off;
      this.terrainToolbarBtn.toggleClass("is-locked", off);
      this.terrainToolbarBtn.setAttr("title", off ? this.host.wm()!.TERRAIN_IN_BIOMES_HINT : "");
      if (off && this.drawingMode === "terrain") this.exitTerrainMode();
    }
    if (!owView && this.drawingMode === "biome") this.exitBiomeMode();
    const hint = lockedSummary(locked);
    if (this.toolsLockedEl) {
      this.toolsLockedEl.setText(hint ?? "");
      this.toolsLockedEl.toggle(!!hint);
    }
  }

  /**
   * The drawing tools panel. The common jobs come first (paint terrain,
   * icons, paths, tokens), then factions and Center hex; the link tools
   * (Link table, Link submap, Region areas) sit in the panel's Advanced
   * dropdown (placement: DrawingPanel.*). The Link table tool's table picker
   * (MapView.tableLinkToolPicker) is only reached from it, so it goes with it.
   */
  buildDrawingToolbarContent(toolbar: HTMLElement): void {
    const disclosure = new Disclosure(this.host.plugin.app, "DrawingPanel", () => toolbar);

    this.terrainToolbarBtn = toolbar.createEl("button", {
      cls: "duckmage-draw-btn duckmage-draw-btn-terrain",
    });
    this.terrainToolbarBtn.createSpan({ text: "Terrain" });
    this.terrainBtnPreview = this.terrainToolbarBtn.createSpan({
      cls: "duckmage-terrain-btn-preview",
    });
    this.terrainToolbarBtn.addEventListener("click", () =>
      this.handleTerrainButton(),
    );

    // Overworlds only (shown by applyWorkModeUi): paint biomes, regions made as you go.
    this.biomeToolbarBtn = toolbar.createEl("button", {
      cls: "duckmage-draw-btn duckmage-draw-btn-terrain duckmage-draw-btn-biome",
    });
    this.biomeToolbarBtn.createSpan({ text: "Biome" });
    this.biomeBtnPreview = this.biomeToolbarBtn.createSpan({ cls: "duckmage-terrain-btn-preview" });
    this.biomeBtnPreview.hide();
    this.biomeToolbarBtn.addEventListener("click", () => this.handleBiomeButton());

    this.iconToolbarBtn = toolbar.createEl("button", {
      cls: "duckmage-draw-btn duckmage-draw-btn-terrain",
    });
    this.iconToolbarBtn.createSpan({ text: "Icon" });
    this.iconBtnPreview = this.iconToolbarBtn.createEl("img", {
      cls: "duckmage-icon-btn-preview",
    });
    this.iconToolbarBtn.addEventListener("click", () =>
      this.handleIconButton(),
    );

    this.pathToolbarBtn = toolbar.createEl("button", {
      cls: "duckmage-draw-btn duckmage-draw-btn-path",
    });
    this.pathToolbarBtn.createSpan({ text: "Path" });
    this.pathBtnSwatch = this.pathToolbarBtn.createSpan({
      cls: "duckmage-path-btn-swatch",
    });
    this.pathToolbarBtn.addEventListener("click", () =>
      this.handlePathButton(),
    );

    this.tokenBtn = toolbar.createEl("button", {
      cls: "duckmage-draw-btn duckmage-draw-btn-token",
      text: "Token",
    });
    this.tokenBtn.addEventListener("click", () => this.handleTokenButton());

    this.makeLinkButton(toolbar, "factionLink");

    const centerHexBtn = toolbar.createEl("button", {
      cls: "duckmage-draw-btn duckmage-center-hex-btn",
      text: "Center hex",
    });
    centerHexBtn.addEventListener("click", () => {
      new GotoHexModal(this.host.plugin.app, (x, y) => this.host.centerOnHex(x, y)).open();
    });

    // Tools the map's mode locks are hidden; this line says how to get them.
    this.toolsLockedEl = toolbar.createDiv({ cls: "duckmage-tools-locked" });
    this.toolsLockedEl.hide();

    const tableLinkBtn = this.makeLinkButton(toolbar, "tableLink");
    disclosure.place("DrawingPanel.linkTable", tableLinkBtn);

    const submapLinkBtn = this.makeLinkButton(toolbar, "submapLink");
    disclosure.place("DrawingPanel.linkSubmap", submapLinkBtn);

    const regionLinkBtn = this.makeLinkButton(toolbar, "regionLink");
    disclosure.place("DrawingPanel.regionAreas", regionLinkBtn);

    this.host.applyWorkModeUi();
  }

  showPainterContextMenu(
    clientX: number,
    clientY: number,
    hexX: number | null,
    hexY: number | null,
    pathItems: PainterContextMenuOption[] = [],
  ): void {
    const mode = this.drawingMode;
    let onSwitch: (() => void) | null = null;
    let switchLabel = "Switch";
    const extra: { label: string; onClick: () => void }[] = [];
    const erasing = this.isErasingMode;

    const toggleEraseMode = () => {
      this.isErasingMode = !erasing;
      this.updateToolbarButtonStates();
    };

    if (mode === "terrain") {
      onSwitch = () => this.handleTerrainButton();
      switchLabel = "Switch terrain";
      extra.push({ label: erasing ? "Paint mode" : "Erase mode", onClick: toggleEraseMode });
    } else if (mode === "icon") {
      onSwitch = () => this.openIconPicker();
      switchLabel = "Switch icon";
      extra.push({ label: erasing ? "Paint mode" : "Erase mode", onClick: toggleEraseMode });
    } else if (mode === "tableLink") {
      onSwitch = () => this.handleTableLinkButton(true);
      switchLabel = "Switch table";
      extra.push({ label: erasing ? "Link mode" : "Erase mode", onClick: toggleEraseMode });
    } else if (mode === "submapLink") {
      onSwitch = () => this.handleSubmapLinkButton(true);
      switchLabel = "Switch submap";
      extra.push({ label: erasing ? "Link mode" : "Erase mode", onClick: toggleEraseMode });
    } else if (mode === "factionLink") {
      onSwitch = () => this.handleFactionLinkButton();
      switchLabel = "Switch faction";
      extra.push({ label: erasing ? "Link mode" : "Erase mode", onClick: toggleEraseMode });
    } else if (mode === "regionLink") {
      onSwitch = () => this.handleRegionLinkButton();
      switchLabel = "Switch region";
      extra.push({ label: erasing ? "Link mode" : "Erase mode", onClick: toggleEraseMode });
    } else if (mode === "path") {
      onSwitch = () => this.handlePathButton();
      switchLabel = "Switch path type";
      extra.push({ label: erasing ? "Draw mode" : "Erase mode", onClick: toggleEraseMode });
      // No "New path" here (PainterMenu.newPath, dropped): the mode bar has it.
    } else if (mode === "placeToken") {
      onSwitch = () => this.handleTokenButton(true);
      switchLabel = "Switch token";
    } else if (mode === "biome") {
      onSwitch = () => this.handleBiomeButton();
      switchLabel = "Switch biome";
    }
    // swap: no picker → onSwitch stays null, menu shows only "Exit tool"

    this.painterMenu?.close();
    // The path under the pointer comes first, above a separator (#48).
    // Its Advanced items (Split here, Reverse) are in an "Advanced ▸" row at its end.
    this.painterMenu = new PainterContextMenu(onSwitch, () => this.exitCurrentMode(), switchLabel, extra, mode === "path" ? pathItems : [], isDebugMode(this.host.plugin.app));
    this.painterMenu.open(clientX, clientY);
  }

  // Remove all swap overlay spans from the viewport DOM
  clearSwapHighlights(): void {
    this.host.viewportEl()
      ?.querySelectorAll(".duckmage-hex-swap-source, .duckmage-hex-swap-dest")
      .forEach((el) => el.remove());
  }

  updateToolbarButtonStates(): void {
    const erasing = this.isErasingMode;
    this.pathToolbarBtn?.toggleClass("is-active", this.drawingMode === "path");
    this.pathToolbarBtn?.toggleClass("is-erase", erasing && this.drawingMode === "path");
    // Update path button swatch color to show active type
    if (this.pathBtnSwatch) {
      const current = this.host.pathTool.currentType();
      const activeType = current
        ? this.host.mapPathTypes().find((p) => p.name === current)
        : this.host.mapPathTypes()[0];
      if (activeType) {
        this.pathBtnSwatch.setCssProps({
          "--duckmage-bg": activeType.color,
        });
        this.pathBtnSwatch.show();
      } else {
        this.pathBtnSwatch.hide();
      }
    }
    this.terrainToolbarBtn?.toggleClass(
      "is-active",
      this.drawingMode === "terrain",
    );
    this.iconToolbarBtn?.toggleClass("is-active", this.drawingMode === "icon");
    for (const [mode, { btn }] of this.linkButtons) btn.toggleClass("is-active", this.drawingMode === mode);
    this.swapBtn?.toggleClass("is-active", this.drawingMode === "swap");
    this.tokenBtn?.toggleClass("is-active", this.drawingMode === "placeToken");
    this.biomeToolbarBtn?.toggleClass("is-active", this.drawingMode === "biome");
    if (this.biomeBtnPreview) {
      const colour = this.drawingMode === "biome" && this.paintBiomeId ? this.host.wm()?.biomeNoteOf(this.paintBiomeId)?.color : undefined;
      if (colour) {
        this.biomeBtnPreview.setCssProps({ "--duckmage-bg": colour });
        this.biomeBtnPreview.show();
      } else this.biomeBtnPreview.hide();
    }
    this.host.viewportEl()?.toggleClass(
      "duckmage-draw-mode",
      this.drawingMode !== null,
    );
    this.host.viewportEl()?.toggleClass(
      "duckmage-terrain-paint",
      this.drawingMode === "terrain" && !this.terrainPickMode,
    );

    // Icon button preview
    if (this.drawingMode === "icon" && this.paintIconName) {
      if (this.iconBtnPreview) {
        this.iconBtnPreview.src = getIconUrl(this.host.plugin, this.paintIconName);
        this.iconBtnPreview.show();
      }
    } else {
      if (this.iconBtnPreview) this.iconBtnPreview.hide();
    }
    if (this.drawingMode === "terrain") {
      if (this.terrainPickMode) {
        // Eyedropper waiting for a click — show ⌖ as the preview
        this.terrainToolbarBtn?.removeClass("is-terrain-preview");
        this.terrainToolbarBtn?.addClass("is-eyedropper-active");
        if (this.terrainBtnPreview) {
          this.terrainBtnPreview.setCssProps({ "--duckmage-bg": "" });
          this.terrainBtnPreview.show();
          this.terrainBtnPreview.textContent = "⌖";
        }
      } else {
        if (this.terrainBtnPreview) this.terrainBtnPreview.textContent = "";
        this.terrainToolbarBtn?.removeClass("is-eyedropper-active");
        const entry = this.paintTerrainName
          ? this.host.plugin
              .getMapPalette(this.host.activeMapName())
              .find((p) => p.name === this.paintTerrainName)
          : undefined;
        if (entry) {
          if (this.terrainToolbarBtn) {
            this.terrainToolbarBtn.addClass("is-terrain-preview");
            this.terrainToolbarBtn.setCssProps({
              "--duckmage-border-color": entry.color,
            });
          }
          if (this.terrainBtnPreview) {
            this.terrainBtnPreview.setCssProps({
              "--duckmage-bg": entry.color,
            });
            this.terrainBtnPreview.show();
          }
        } else {
          // Clear mode — show active state without a color
          this.terrainToolbarBtn?.removeClass("is-terrain-preview");
          if (this.terrainBtnPreview) {
            this.terrainBtnPreview.hide();
          }
        }
      }
    } else {
      this.terrainToolbarBtn?.removeClass("is-terrain-preview");
      this.terrainToolbarBtn?.removeClass("is-eyedropper-active");
      if (this.terrainBtnPreview) {
        this.terrainBtnPreview.hide();
      }
    }

    // The link tools' buttons name what they paint (or erase).
    for (const [mode, { btn, label }] of this.linkButtons) {
      const text = this.drawingMode === mode ? LINK_LABELS[mode].active(this, erasing, (n) => this.host.plugin.mapLabel(n)) : null;
      label.setText(text ?? LINK_LABELS[mode].idle);
      btn.toggleClass("is-erase", erasing && this.drawingMode === mode);
    }

    // Terrain / icon erase visual feedback
    this.terrainToolbarBtn?.toggleClass("is-erase", erasing && this.drawingMode === "terrain");
    this.iconToolbarBtn?.toggleClass("is-erase", erasing && this.drawingMode === "icon");

    this.updateModeBar();
  }

  /** Show which tool is on (and how to stop it) on the map itself. */
  updateModeBar(): void {
    if (!this.modeBarEl || !this.modeBarTextEl) return;
    const label = toolModeLabel({
      mode: this.drawingMode,
      erasing: this.isErasingMode,
      terrainName: this.paintTerrainName,
      terrainPick: this.terrainPickMode,
      regionHexes: this.host.owView(this.host.getActiveMap()) === "regions",
      // The icon's name as the picker shows it ("village", not "place-village": F6).
      iconName: this.paintIconName ? iconLabel(this.paintIconName) : this.paintIconName,
      iconGmOnly: this.paintIconGmOnly,
      pathTypeName: this.host.pathTool.currentType(),
      pathAuto: this.host.pathTool.autoRoute,
      pathDrawing: this.host.pathTool.labelState().drawing,
      pathSelected: this.host.pathTool.labelState().selected,
      pathSummary: this.host.pathTool.labelState().summary,
      pathNew: this.host.pathTool.labelState().forceNew,
      pathNote: this.host.pathTool.labelState().note,
      tablePath: this.paintTablePath,
      submapName: this.paintSubmapName,
      factionPath: this.paintFactionPath,
      regionPath: this.paintRegionPath,
      biomeName: this.paintBiomeId ? this.host.wm()?.biomeInfo(this.paintBiomeId)?.label ?? this.paintBiomeId : null,
    });
    this.renderRouteControls();
    const changed = this.modeBarTextEl.getText() !== (label ?? "");
    this.modeBarTextEl.setText(label ?? "");
    this.modeBarEl.toggle(label !== null);
    // The path tool says more and has more controls: its text wraps instead of being cut off.
    this.modeBarEl.toggleClass("is-path", this.drawingMode === "path");
    this.modeBarTextEl.setAttr("title", label ?? "");
    if (label === null || !changed) return;
    // A tool just started or changed: pulse the bar so it's noticed
    // (round 4: a tester never saw it). The map does NOT move here: a tool
    // is on now, and a slide under the cursor sends the next click to the
    // wrong hex (round 5, see mayAutoPan).
    const bar = this.modeBarEl;
    bar.removeClass("is-new");
    window.requestAnimationFrame(() => bar.addClass("is-new"));
  }

  /** The path tool's controls in the mode bar (src/hex-map/pathTool.ts). */
  private renderRouteControls(): void {
    const el = this.modeBarRouteEl;
    if (!el) return;
    el.empty();
    const show = this.drawingMode === "path" && !this.isErasingMode;
    el.toggle(show);
    if (show) this.host.pathTool.renderBarControls(el);
    // An overworld's selected path: confirm it into its regions from the bar too.
    const selected = show ? this.host.pathTool.labelState().selected : null;
    const confirm = this.overworldPathItems(selected)[0];
    if (confirm) {
      const btn = el.createEl("button", {
        text: confirm.label,
        cls: "duckmage-mode-bar-route-toggle duckmage-path-confirm-btn",
        attr: { title: "Put this path into every region it crosses, joined at the seams (one undo step)." },
      });
      btn.addEventListener("click", confirm.onClick);
    }
  }

  /**
   * An overworld path's region actions (path menu, mode bar): "Confirm into
   * regions" for a draft, "Update regions" + "Remove from regions" for a
   * confirmed one. None on other maps, or when the mode doesn't allow it.
   */
  overworldPathItems(pathName: string | null): { label: string; onClick: () => void }[] {
    const mapName = this.host.activeMapName();
    const wm = this.host.wm();
    if (!wm || !pathName || !wm.isPathOverworld(this.host.plugin, mapName) || !canDo(mapName, "edit-path")) return [];
    const p = this.host.plugin.mapStore.paths(mapName).find((q) => q.name === pathName);
    if (!p) return [];
    const run = (remove: boolean) => () => void this.runPathProjection(pathName, remove);
    return wm.isApplied(p)
      ? [{ label: "Update regions", onClick: run(false) }, { label: "Remove from regions", onClick: run(true) }]
      : [{ label: "Confirm into regions", onClick: run(false) }];
  }

  /** Confirm (or remove) an overworld path into its regions, and say what happened. */
  async runPathProjection(pathName: string, remove: boolean): Promise<void> {
    const mapName = this.host.activeMapName();
    const wm = this.host.wm();
    if (!wm) return;
    const res = remove ? await wm.removeOverworldPath(this.host.plugin, mapName, pathName) : await wm.confirmOverworldPath(this.host.plugin, mapName, pathName);
    if ("error" in res) {
      new Notice(res.error);
      return;
    }
    const n = res.regions.length;
    const where = n === 1 ? "1 region" : `${n} regions`;
    const msg = remove ? `${pathName}: taken out of ${where}.` : `${pathName}: ${n ? `in ${where}` : "crosses no regions yet"}.`;
    const skipped = res.skipped.length ? ` ${res.skipped.length} still loading: confirm again in a moment.` : "";
    new Notice(msg + skipped);
    this.host.undos.updateUndoButton();
    this.host.renderGrid();
    this.updateModeBar();
  }

}
