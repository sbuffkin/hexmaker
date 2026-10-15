/**
 * The map view's tool state (L2h, split out of HexMapView): which drawing
 * tool is on and what it paints, and the transitions between tools (the
 * pickers that start a tool, leaving one for another, putting it down).
 * MapToolbar (mapToolbar.ts) extends it with the buttons and the mode bar.
 */
import { Notice } from "obsidian";
import type HexmakerPlugin from "../../HexmakerPlugin";
import type { WorldMapsApi } from "../../modules/world-maps/api";
import type { MapData, PathType } from "../../types";
import { impassableNames } from "../../impassable";
import { TOOL_ACTIONS, type ModeAction } from "../../workMode";
import { FactionPickerModal } from "../FactionPickerModal";
import { FolderTreePickerModal } from "../FolderTreePickerModal";
import { GeoRegionPickerModal } from "../GeoRegionPickerModal";
import type { DrawingToolPanel, OverlayPanel } from "../HexSidePanel";
import { IconPickerModal } from "../IconPickerModal";
import { PathPickerModal } from "../PathPickerModal";
import { pathListSummary, type PathTool } from "../pathTool";
import { SubmapPickerModal } from "../SubmapPickerModal";
import { TerrainPickerModal } from "../TerrainPickerModal";
import { TokenModal } from "../TokenModal";
import type { DrawingMode } from "../toolMode";
import type { TokenSnap } from "../undoItems";
import type { PathOverlay } from "./pathOverlay";
import type { UndoController } from "./undoController";
import { hexPair } from "../../hexKey";

/** The link tools: each paints one note (or map) chosen in its picker. */
const LINK_TOOLS = {
  tableLink: "paintTablePath",
  submapLink: "paintSubmapName",
  factionLink: "paintFactionPath",
  regionLink: "paintRegionPath",
} as const;
export type LinkTool = keyof typeof LINK_TOOLS;
export function isLinkTool(mode: DrawingMode): mode is LinkTool {
  return mode in LINK_TOOLS;
}

export interface ToolHost {
  plugin: HexmakerPlugin;
  activeMapName(): string;
  viewportEl(): HTMLElement | null;
  getActiveMap(): MapData;
  wm(): WorldMapsApi | undefined;
  owView(map: MapData): "regions" | "biomes" | null;
  /** May the open map do `action` in its mode? (says which mode would, when not) */
  modeAllows(action: ModeAction): boolean;
  pathTool: PathTool;
  mapPathTypes(): PathType[];
  undos: Pick<UndoController, "commitTerrainStroke" | "updateUndoButton">;
  pathLayer: Pick<PathOverlay, "updatePathOverlay" | "updateGmIcons">;
  overlayPanel(): OverlayPanel | null;
  toolsPanel(): DrawingToolPanel | null;
  centerOnHex(x: number, y: number): void;
  /** Show the tools the map's mode allows (after the toolbar is built). */
  applyWorkModeUi(): void;
  finishBiomeStroke(): Promise<void>;
  updateBrushHighlight(x: number | null, y: number | null): void;
  /** Show an overworld's Regions view (the terrain brush paints there). */
  showOverworldRegions(): void;
  nextTokenFill(): string;
  renderGrid(): void;
}

export abstract class ToolState {
  drawingMode: DrawingMode | null = null;
  isErasingMode = false;
  paintTerrainName: string | null = null;
  paintIconName: string | null = null;
  paintIconGmOnly = false;
  terrainPickMode = false;
  paintBrushSize: 1 | 3 | 7 = 1;
  paintTablePath: string | null = null;
  paintSubmapName: string | null = null;
  paintFactionPath: string | null = null;
  paintRegionPath: string | null = null;
  /** The biome brush's biome (overworlds only). */
  paintBiomeId: string | null = null;
  pendingTokenNotePath: string | null = null;
  pendingTokenPlaceData: NonNullable<TokenSnap["look"]> | null = null;
  swapSource: { x: number; y: number } | null = null;
  swapDest: { x: number; y: number } | null = null;

  constructor(protected host: ToolHost) {}

  /** Refresh the buttons and the mode bar for the current tool. */
  abstract updateToolbarButtonStates(): void;
  /** Remove the swap tool's hex highlights. */
  abstract clearSwapHighlights(): void;

  /** Start link tool `mode` painting `value` (a picker's pick). */
  private enterLinkTool(mode: LinkTool, value: string): void {
    this.leaveOtherToolFor(mode);
    this.drawingMode = mode;
    this.isErasingMode = false;
    this[LINK_TOOLS[mode]] = value;
    this.updateToolbarButtonStates();
  }

  /** Put link tool `mode` down (no-op when another tool is on). */
  private exitLinkMode(mode: LinkTool): void {
    if (this.drawingMode !== mode) return;
    this.drawingMode = null;
    this[LINK_TOOLS[mode]] = null;
    this.isErasingMode = false;
    this.updateToolbarButtonStates();
  }

  /**
   * Called when a picker's choice switches to tool `next`: properly leave a
   * different active tool first (commits its pending stroke). Staying in the
   * same tool keeps its state.
   */
  leaveOtherToolFor(next: DrawingMode): void {
    if (this.drawingMode !== null && this.drawingMode !== next) this.exitCurrentMode();
  }

  exitCurrentMode(): void {
    this.isErasingMode = false;
    if (this.drawingMode === "terrain") this.exitTerrainMode();
    else if (this.drawingMode === "icon") this.exitIconMode();
    else if (this.drawingMode && isLinkTool(this.drawingMode)) this.exitLinkMode(this.drawingMode);
    else if (this.drawingMode === "swap") this.exitSwapMode();
    else if (this.drawingMode === "placeToken") this.exitTokenMode();
    else if (this.drawingMode === "biome") this.exitBiomeMode();
    else {
      if (this.drawingMode === "path") this.exitPathMode();
      this.drawingMode = null;
      this.updateToolbarButtonStates();
      this.host.pathLayer.updatePathOverlay();
    }
  }

  exitPathMode(): void {
    this.host.pathTool.reset();
  }

  openTerrainPicker(): void {
    this.host.toolsPanel()?.open();
    this.handleTerrainButton();
  }

  protected handleTerrainButton(): void {
    if (this.drawingMode !== "terrain" && !this.host.modeAllows(TOOL_ACTIONS.terrain)) return;
    if (this.host.owView(this.host.getActiveMap()) === "biomes") {
      new Notice(this.host.wm()!.TERRAIN_IN_BIOMES_HINT);
      return;
    }
    // Keep the current tool while the picker is open: closing it without a
    // pick (Escape, clicking away, or after only changing the brush size)
    // must leave painting exactly as it was. It used to exit terrain mode
    // here first, so any of those turned the tool off.
    if (this.drawingMode === "terrain") this.host.undos.commitTerrainStroke();

    // Show crosshair on the viewport while the picker is open
    this.host.viewportEl()?.addClass("duckmage-terrain-picking");

    // On an overworld the brush paints its regions' hexes, so it offers
    // the regions' palette, and picking a terrain shows the Regions view.
    const wm = this.host.wm();
    const owInfo = wm?.overworldOf(this.host.plugin, this.host.activeMapName());
    // Always open the picker — even if already active, so user can switch terrain
    new TerrainPickerModal(
      this.host.plugin.app,
      this.host.plugin,
      wm && owInfo ? wm.regionPalette(this.host.plugin, owInfo.map) : this.host.plugin.getMapPalette(this.host.activeMapName()),
      (terrainName: string | null) => {
        this.host.viewportEl()?.removeClass("duckmage-terrain-picking");
        this.leaveOtherToolFor("terrain");
        this.drawingMode = "terrain";
        this.isErasingMode = false;
        this.terrainPickMode = false;
        this.paintTerrainName = terrainName;
        this.paintIconName = null;
        this.updateToolbarButtonStates();
        this.host.showOverworldRegions();
      },
      () => {
        // Eyedropper: enter terrain mode in pick-from-map state
        this.host.viewportEl()?.removeClass("duckmage-terrain-picking");
        this.leaveOtherToolFor("terrain");
        this.drawingMode = "terrain";
        this.isErasingMode = false;
        this.terrainPickMode = true;
        this.paintTerrainName = null;
        this.updateToolbarButtonStates();
        this.host.showOverworldRegions();
      },
      () => {
        // Dismissed without selecting
        this.host.viewportEl()?.removeClass("duckmage-terrain-picking");
      },
      this.paintBrushSize,
      (size) => {
        this.paintBrushSize = size;
      },
    ).open();
  }

  /** The biome brush's button: pick a biome in the palette, then paint overworld hexes. */
  protected handleBiomeButton(): void {
    const wm = this.host.wm();
    if (!wm || !this.host.owView(this.host.getActiveMap())) return;
    if (this.drawingMode !== "biome" && !this.host.modeAllows(TOOL_ACTIONS.biome)) return;
    new wm.BiomePaletteModal(this.host.plugin.app, this.host.plugin, this.host.activeMapName(), this.paintBiomeId, (biome) => {
      this.leaveOtherToolFor("biome");
      this.drawingMode = "biome";
      this.isErasingMode = false;
      this.paintBiomeId = biome;
      this.updateToolbarButtonStates();
    }).open();
  }

  exitBiomeMode(): void {
    if (this.drawingMode !== "biome") return;
    void this.host.finishBiomeStroke();
    this.drawingMode = null;
    this.paintBiomeId = null;
    this.updateToolbarButtonStates();
  }

  exitTerrainMode(): void {
    if (this.drawingMode !== "terrain") return;
    this.host.undos.commitTerrainStroke();
    this.drawingMode = null;
    this.paintTerrainName = null;
    this.terrainPickMode = false;
    this.isErasingMode = false;
    this.host.updateBrushHighlight(null, null);
    this.updateToolbarButtonStates();
  }

  protected handleIconButton(): void {
    if (this.drawingMode !== "icon" && !this.host.modeAllows(TOOL_ACTIONS.icon)) return;
    // Like Terrain: the button always opens the picker, even with the tool
    // on, to switch icons; closing it without a pick keeps the tool as it
    // was. Esc, ✕ or right-click → Exit tool leave it (fresh-eyes F6).
    this.openIconPicker();
  }

  /**
   * Pick an icon to paint. Like the terrain picker, the current tool stays
   * active until an icon is actually picked, so dismissing it changes nothing.
   */
  protected openIconPicker(): void {
    new IconPickerModal(
      this.host.plugin.app,
      this.host.plugin,
      (iconName: string | null, gmOnly: boolean) => {
        this.leaveOtherToolFor("icon");
        this.drawingMode = "icon";
        this.isErasingMode = false;
        this.paintIconName = iconName;
        this.paintIconGmOnly = gmOnly;
        this.paintTerrainName = null;
        // The terrain brush size is kept: icons always paint one hex
        // (getBrushHexes), so switching to icons and back doesn't reset it.
        // Auto-enable the GM layer when the user picks a GM-only paint —
        // otherwise their painted icons are silently invisible because the
        // layer is hidden. Mirrors the showFactionOverlay-on-paint
        // auto-enable in onHexFactionPaintClick.
        if (gmOnly) {
          const map = this.host.getActiveMap();
          if (!(map.showGmLayer ?? true)) {
            map.showGmLayer = true;
            void this.host.plugin.saveSettings();
            this.host.overlayPanel()?.syncToRegion();
            this.host.pathLayer.updateGmIcons();
          }
        }
        this.updateToolbarButtonStates();
      },
      this.paintIconGmOnly,
    ).open();
  }

  exitIconMode(): void {
    if (this.drawingMode !== "icon") return;
    this.drawingMode = null;
    this.paintIconName = null;
    // NB: do NOT reset paintIconGmOnly here — the user's preference for
    // GM-vs-regular icon paint persists across mode toggles. Otherwise
    // every re-open of the icon picker reverts to "regular" and the GM
    // checkbox starts off, even for a user who's been working in GM
    // mode for the whole session.
    this.isErasingMode = false;
    this.host.updateBrushHighlight(null, null);
    this.updateToolbarButtonStates();
  }

  /** `keep`: opened from the tool's own right-click menu; stay in the tool unless something is picked. */
  protected handleTableLinkButton(keep = false): void {
    if (this.drawingMode !== "tableLink" && !this.host.modeAllows(TOOL_ACTIONS.tableLink)) return;
    if (!keep && this.drawingMode === "tableLink") { this.exitLinkMode("tableLink"); return; }
    new FolderTreePickerModal(
      this.host.plugin.app,
      this.host.plugin,
      this.host.plugin.settings.tablesFolder,
      "Select table",
      "Filter tables…",
      "No tables found.",
      (file) => {
        this.enterLinkTool("tableLink", file.path);
      },
    ).open();
  }

  protected handleSubmapLinkButton(keep = false): void {
    if (this.drawingMode !== "submapLink" && !this.host.modeAllows(TOOL_ACTIONS.submapLink)) return;
    if (!keep && this.drawingMode === "submapLink") { this.exitLinkMode("submapLink"); return; }
    new SubmapPickerModal(
      this.host.plugin.app,
      this.host.plugin,
      undefined,
      (mapName) => {
        this.enterLinkTool("submapLink", mapName);
      },
      undefined,
    ).open();
  }

  protected handleFactionLinkButton(): void {
    if (this.drawingMode !== "factionLink" && !this.host.modeAllows(TOOL_ACTIONS.factionLink)) return;
    new FactionPickerModal(this.host.plugin.app, this.host.plugin, (filePath) => {
      this.enterLinkTool("factionLink", filePath);
    }, () => {
      this.drawingMode = "factionLink";
      this.isErasingMode = true;
      this.updateToolbarButtonStates();
    }).open();
  }

  protected handleRegionLinkButton(): void {
    if (this.drawingMode !== "regionLink" && !this.host.modeAllows(TOOL_ACTIONS.regionLink)) return;
    new GeoRegionPickerModal(this.host.plugin.app, this.host.plugin, (filePath) => {
      this.enterLinkTool("regionLink", filePath);
      // Auto-enable region overlay when entering paint mode
      if (!this.host.getActiveMap().showRegionOverlay) {
        this.host.getActiveMap().showRegionOverlay = true;
        void this.host.plugin.saveSettings();
        this.host.overlayPanel()?.syncToRegion();
      }
    }, () => {
      this.drawingMode = "regionLink";
      this.isErasingMode = true;
      this.updateToolbarButtonStates();
    }).open();
  }

  protected handleTokenButton(keep = false): void {
    if (this.drawingMode !== "placeToken" && !this.host.modeAllows(TOOL_ACTIONS.placeToken)) return;
    if (!keep && this.drawingMode === "placeToken") {
      this.exitTokenMode();
      return;
    }
    new TokenModal(
      this.host.plugin.app,
      this.host.plugin,
      undefined,
      "",
      { color: this.host.nextTokenFill() },
      (notePath, data) => {
        this.leaveOtherToolFor("placeToken");
        this.pendingTokenNotePath  = notePath;
        this.pendingTokenPlaceData = { ...data };
        this.drawingMode = "placeToken";
        this.isErasingMode = false;
        this.updateToolbarButtonStates();
      },
    ).open();
  }

  exitTokenMode(): void {
    if (this.drawingMode !== "placeToken") return;
    this.drawingMode = null;
    this.pendingTokenNotePath = null;
    this.pendingTokenPlaceData = null;
    this.updateToolbarButtonStates();
  }

  handleSwapButton(): void {
    if (this.drawingMode !== "swap" && !this.host.modeAllows(TOOL_ACTIONS.swap)) return;
    if (this.drawingMode === "swap") {
      this.exitSwapMode();
    } else {
      this.drawingMode = "swap";
      this.isErasingMode = false;
      this.swapSource = null;
      this.swapDest = null;
      this.updateToolbarButtonStates();
    }
  }

  exitSwapMode(): void {
    if (this.drawingMode !== "swap") return;
    this.drawingMode = null;
    this.clearSwapHighlights();
    this.swapSource = null;
    this.swapDest = null;
    this.updateToolbarButtonStates();
  }

  /**
   * Open the path-type picker. Clicking the Path button while drawing reopens
   * it (like Terrain) instead of silently turning the tool off (fresh-eyes
   * T7); leave the tool with right-click → Exit tool, Esc, or the mode bar.
   */
  protected handlePathButton(): void {
    if (this.drawingMode !== "path" && !this.host.modeAllows(TOOL_ACTIONS.path)) return;
    new PathPickerModal(
      this.host.plugin.app,
      this.host.plugin,
      this.host.plugin.mapPaletteName(this.host.activeMapName()),
      this.host.pathTool.typeName,
      (typeName) => {
        this.leaveOtherToolFor("path");
        // A new type ends the branch being drawn; re-picking the type keeps it going.
        if (this.drawingMode !== "path") this.exitPathMode();
        this.host.pathTool.setType(typeName);
        this.drawingMode = "path";
        this.isErasingMode = false;
        this.updateToolbarButtonStates();
        this.host.pathLayer.updatePathOverlay();
      },
      () => {
        if (this.drawingMode !== "path") this.updateToolbarButtonStates();
      },
      () => {
        this.drawingMode = "path";
        this.isErasingMode = true;
        this.updateToolbarButtonStates();
        this.host.pathLayer.updatePathOverlay();
      },
      {
        value: this.host.pathTool.autoRoute,
        onChange: (on) => this.host.pathTool.setAutoRoute(on),
        noImpassable: impassableNames(this.host.plugin.getMapPalette(this.host.activeMapName())).length === 0,
      },
      {
        list: (() => {
          // Ends, forks and size from the resolved routes (#48), so similar
          // names (Road 2 … Road 6) can be told apart. Names stay the user's.
          const resolved = this.host.plugin.paths.resolved(this.host.activeMapName());
          const types = this.host.plugin.getMapPathTypes(this.host.activeMapName()).map((t) => t.name);
          return this.host.plugin.mapStore.paths(this.host.activeMapName()).map((p) => ({ name: p.name, typeName: p.typeName, summary: pathListSummary(p, resolved, types) }));
        })(),
        selected: this.host.pathTool.selected,
        onPick: (name) => {
          this.leaveOtherToolFor("path");
          this.drawingMode = "path";
          this.isErasingMode = false;
          this.host.pathTool.selectPath(name);
          // Show it: the list is for paths that are hard to find on the map.
          const first = this.host.plugin.mapStore.paths(this.host.activeMapName()).find((q) => q.name === name)?.branches[0]?.anchors[0];
          if (first) { const [hx, hy] = hexPair(first); this.host.centerOnHex(hx, hy); }
          this.updateToolbarButtonStates();
          this.host.pathLayer.updatePathOverlay();
        },
      },
    ).open();
  }

}
