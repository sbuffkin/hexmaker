/**
 * The hex right-click menus (L2k, split out of HexMapView): a hex's items
 * (its maps first, then the common jobs, links, swap, clears), an
 * overworld hex's region items, and the Edit region dialog they open.
 * Items the map's work mode locks are left out (ModeMenu).
 */
import { TFile, type App } from "obsidian";
import type HexmakerPlugin from "../../HexmakerPlugin";
import { getHexMapsFromFile, getIconOverrideFromFile, getTerrainFromFile } from "../../frontmatter";
import { newMapItemTitle, regionMapAt, submapMenuPlan } from "../../maps/submaps";
import { moduleHexMenu } from "../../modules/runtime";
import type { WorldMapsApi } from "../../modules/world-maps/api";
import { openNoteFocused } from "../../openNote";
import type { BiomeHost } from "../../overworld/BiomeModals";
import type { OverworldLayer } from "../../overworld/overworldLayer";
import { parseVisited } from "../../play/partyTravel";
import type { MapData } from "../../types";
import type { MenuActionId, WorkMode } from "../../workMode";
import { COPY_HEX_LINK_TITLE, copyHexLink } from "../copyHexLink";
import { FolderTreePickerModal } from "../FolderTreePickerModal";
import { ModeMenu, type ModeMenuOptions } from "../modeMenu";
import type { DrawingMode } from "../toolMode";
import type { MapNavigation } from "./mapNavigation";
import type { MapToolbar } from "./mapToolbar";
import type { UndoController } from "./undoController";
import { hexKey, hexPair } from "../../hexKey";

export interface HexContextMenuHost {
  activeMapName(): string;
  viewportEl(): HTMLElement | null;
  drawingMode(): DrawingMode | null;
  overworldLayer(): OverworldLayer | undefined;
  wm(): WorldMapsApi | undefined;
  getActiveMap(): MapData;
  owView(map: MapData): "regions" | "biomes" | null;
  undos: Pick<UndoController, "currentWorkMode">;
  toolbar: Pick<MapToolbar, "handleSwapButton">;
  nav: Pick<MapNavigation, "openLinkExistingMap" | "enterRegionAt">;
  setWorkMode(mode: WorkMode): void;
  navigateToMap(name: string, opts?: { recordHistory?: boolean; offerModule?: boolean }): void;
  openLocationsList(x: number, y: number): void;
  openNewSubmapSetup(x: number, y: number): void;
  arriveAt(x: number, y: number): Promise<void>;
  createTokenAtHex(x: number, y: number): void;
  openPlayLog(x: number, y: number): void;
  setVisited(keys: string[], on: boolean): void;
  centerOnHex(x: number, y: number): void;
  linkTableToHex(x: number, y: number, tableFile: TFile): Promise<void>;
  openRandomTableAtFile(file: TFile): Promise<void>;
  onHexSwapClick(x: number, y: number): Promise<void>;
  paintOne(x: number, y: number, terrain: string | null): void;
  removeIconOverride(x: number, y: number): void;
  biomeHost(): BiomeHost;
  renderGrid(): void;
}

export class HexContextMenu {
  constructor(private plugin: HexmakerPlugin, private host: HexContextMenuHost) {}

  private get app(): App {
    return this.plugin.app;
  }

  private get activeMapName(): string {
    return this.host.activeMapName();
  }

  private get wm(): WorldMapsApi | undefined {
    return this.host.wm();
  }

  /** Options for the map view's menus: debug mode, and the God offer on God-only items. */
  modeMenuOptions(): ModeMenuOptions {
    return { store: this.app, onGod: () => this.host.setWorkMode("god") };
  }

  onHexContextMenu(evt: MouseEvent, x: number, y: number): void {
    evt.preventDefault();
    // When any tool is active, the global capture-phase contextmenu handler
    // intercepts the event and shows the painter context menu — this handler
    // only fires when drawingMode === null.
    if (this.host.drawingMode() !== null) return;

    // Items the map's work mode locks are left out, with one hint line
    // (for God-only items, an offer to switch: Swap hex).
    const menu = new ModeMenu(this.host.undos.currentWorkMode(), this.modeMenuOptions());
    // Overworlds are the big-picture view (#49): region-level items only,
    // no hex editor.
    if (this.host.owView(this.host.getActiveMap())) this.addOverworldMenuItems(menu, evt, x, y);
    else this.addHexMenuItems(menu, x, y);
    menu.showAtMouseEvent(evt);
  }

  /**
   * A hex's right-click items (also under a token's own items, F8: the
   * token covers the hex centre). `inTokenMenu` names the hex's note so it
   * isn't taken for the token's.
   */
  addHexMenuItems(menu: ModeMenu, x: number, y: number, inTokenMenu = false): void {
    const hexPath = this.plugin.hexPath(x, y, this.activeMapName);
    // Terrain, icon and submap live in the map note, and a hex can have them
    // before its hex note exists (a generated map, a submap made from this
    // menu) — gating these on the note hid "Enter submap" and "Clear
    // terrain" on such hexes (fresh-eyes N3).
    const terrain = getTerrainFromFile(this.app, hexPath);
    const iconOverride = getIconOverrideFromFile(this.app, hexPath);
    const hexMaps = this.plugin.mapStore.get(this.activeMapName, hexKey(x, y))
      ?? { locations: getHexMapsFromFile(this.app, hexPath).locations };
    const childPlan = submapMenuPlan(hexMaps);

    // Maps from this hex (K7) come first, so entering what's there is the
    // obvious pick (C11): its region, then up to two locations by name, or
    // one "Locations (n)…" item that opens the list.
    const region = childPlan.region;
    const hasRegion = !!region && !!this.plugin.getMap(region);
    if (region && hasRegion) {
      menu.add("hex.enter-region", `Enter region: ${this.plugin.mapLabel(region)}`, "log-in", () => this.host.navigateToMap(region, { offerModule: true }));
    }
    for (const loc of childPlan.open) {
      menu.add("hex.open-location", `Open: ${this.plugin.mapLabel(loc)}`, "map-pin", () => {
        if (this.plugin.getMap(loc)) this.host.navigateToMap(loc, { offerModule: true });
        else this.host.openLocationsList(x, y);
      });
    }
    if (childPlan.listCount) {
      menu.add("hex.locations", `Locations (${childPlan.listCount})…`, "list", () => this.host.openLocationsList(x, y));
    }
    // Arrival (GM4): a world set to make places makes this hex's place on
    // the spot, in any mode, when it has none yet.
    const arrive = !hasRegion && !childPlan.open.length && !childPlan.listCount && this.plugin.arrival.canArrive(this.activeMapName, x, y);
    if (arrive) menu.add("hex.arrive", "Go there", "footprints", () => void this.host.arriveAt(x, y));
    if (arrive || hasRegion || childPlan.open.length || childPlan.listCount) menu.addSeparator();

    // The common jobs next: the hex's note, a token, centring.
    menu.add("hex.open-note", inTokenMenu ? "Open hex note" : "Open note", "file-text", () => {
      void (async () => {
        const existing = this.app.vault.getAbstractFileByPath(hexPath);
        const file =
          existing instanceof TFile
            ? existing
            : await this.plugin.createHexNote(x, y, this.activeMapName);
        if (file) await openNoteFocused(this.app, file);
      })();
    });
    menu.add("hex.create-token", "Create token here", "circle-user", () => this.host.createTokenAtHex(x, y));
    // Solo play (SF3): what happened here goes to the dated play log.
    menu.add("hex.log", "Add to play log…", "notebook-pen", () => this.host.openPlayLog(x, y));
    const visited = parseVisited(this.host.getActiveMap().visited).includes(hexKey(x, y));
    menu.add("hex.visited", "Visited", "footprints", () => this.host.setVisited([hexKey(x, y)], !visited), { checked: visited, place: "MapView.hexVisited" });
    for (const it of moduleHexMenu(this.plugin, this.activeMapName, hexKey(x, y))) menu.add(it.id as MenuActionId, it.label, it.icon, it.run, { place: it.placementId });
    menu.add("hex.center", "Center on this hex", "crosshair", () => this.host.centerOnHex(x, y));
    menu.add("hex.copy-link", COPY_HEX_LINK_TITLE, "link-2", () => copyHexLink(this.plugin, this.activeMapName, x, y));

    menu.addSeparator();

    // "Add another map…" once the hex has one (C11): a hex can hold several
    // locations, but the menu doesn't invite re-making the same map.
    menu.add("hex.new-map", newMapItemTitle(hexMaps), "plus", () => this.host.openNewSubmapSetup(x, y));
    menu.add("hex.link-map", "Link existing map…", "link", () => this.host.nav.openLinkExistingMap(x, y));
    if (childPlan.open.length) {
      // Unlinking and reordering live in the list.
      menu.add("hex.manage-locations", "Manage locations…", "list", () => this.host.openLocationsList(x, y));
    }

    menu.add("hex.link-table", "Link table", "table", () => {
      new FolderTreePickerModal(
        this.app,
        this.plugin,
        this.plugin.settings.tablesFolder,
        "Link table",
        "Filter tables…",
        "No tables found.",
        (file) => void this.host.linkTableToHex(x, y, file),
        (file) => void this.host.openRandomTableAtFile(file),
      ).open();
    });

    menu.add("hex.swap", "Swap hex", "arrow-left-right", () => {
      if (this.host.drawingMode() !== "swap") this.host.toolbar.handleSwapButton();
      void this.host.onHexSwapClick(x, y);
    });

    // ── Contextual delete options ──────────────────────────────────────────
    if (terrain || iconOverride) {
      menu.addSeparator();
      if (terrain) {
        menu.add("hex.clear-terrain", "Clear terrain", "eraser", () => {
          this.host.paintOne(x, y, null);
        });
      }
      if (iconOverride) {
        menu.add("hex.remove-icon", "Remove icon override", "image-off", () => {
          this.host.removeIconOverride(x, y);
        });
      }
    }
  }

  /**
   * An overworld hex's right-click items (overworldMenu): Enter region and
   * Edit region on a region, Set biome on an empty hex, Center, and the
   * hex's Locations. In the Regions view the brick under the pointer counts.
   */
  addOverworldMenuItems(menu: ModeMenu, evt: MouseEvent, x: number, y: number): void {
    const wm = this.wm;
    if (!wm) return;
    const grid = this.host.viewportEl()?.querySelector<HTMLElement>(".duckmage-hex-map-grid");
    const cell = this.host.owView(this.host.getActiveMap()) === "regions" && grid
      ? this.host.overworldLayer()?.cellAt(grid, evt.clientX, evt.clientY) ?? null : null;
    const [px, py] = cell ? hexPair(cell.parentHex) : [x, y];
    const key = hexKey(px, py);
    const regionMap = regionMapAt(this.plugin.settings.maps, this.activeMapName, key);
    const region = regionMap?.name;
    const locations = this.plugin.mapStore.get(this.activeMapName, key)?.locations?.length ?? 0;
    const icons: Record<string, string> = { "enter-region": "log-in", "edit-region": "settings-2", reroll: "dices", lock: "lock", "set-biome": "trees", center: "crosshair", locations: "list" };
    // Reroll / Lock on a new (open) region: placed main (src/ui/placement.ts).
    const places: Record<string, string> = { reroll: "OverworldMenu.reroll", lock: "OverworldMenu.lock" };
    // Arrival (GM4): a world set to make places makes this hex's region on the spot, in any mode.
    if (!region && this.plugin.arrival.canArrive(this.activeMapName, px, py)) {
      menu.add("ow.arrive", "Go there", "footprints", () => void this.host.arriveAt(px, py));
      menu.addSeparator();
    }
    for (const it of wm.overworldMenu(this.host.getActiveMap(), !!region, locations, regionMap)) {
      const id = `ow.${it.id}` as const;
      const title = it.id === "enter-region" && region ? `Enter region: ${this.plugin.mapLabel(region)}` : it.enabled ? it.title : `${it.title} (${it.hint})`;
      menu.add(id, title, icons[it.id] ?? "dot", () => {
        if (it.id === "enter-region" && region) {
          if (cell) this.host.nav.enterRegionAt(region, cell.x, cell.y);
          else this.host.navigateToMap(region);
        } else if (it.id === "edit-region") this.openEditRegion(px, py);
        else if (it.id === "reroll") void wm.rerollRegionAt(this.host.biomeHost(), this.activeMapName, px, py);
        else if (it.id === "lock" && region) void this.plugin.arrival.lock(region).then(() => this.host.renderGrid());
        else if (it.id === "set-biome") this.openNewRegion(px, py);
        else if (it.id === "center") this.host.centerOnHex(px, py);
        else if (it.id === "locations") this.host.openLocationsList(px, py);
      }, { disabled: !it.enabled, ...(places[it.id] ? { place: places[it.id] } : {}) });
    }
    menu.add("ow.copy-link", COPY_HEX_LINK_TITLE, "link-2", () => copyHexLink(this.plugin, this.activeMapName, px, py));
    // Mark the party (or anything) on the overworld: tokens sit on its hexes.
    menu.add("ow.create-token", "Create token here", "circle-user", () => this.host.createTokenAtHex(px, py));
  }

  /**
   * An empty hex of the open overworld (an empty brick, Set biome…): Edit
   * region in new-region mode. Nothing is made until its Create.
   */
  openNewRegion(px: number, py: number): void {
    const wm = this.wm;
    if (!wm) return;
    new wm.EditRegionModal({ ...this.host.biomeHost(), openLocations: (hx, hy) => this.host.openLocationsList(hx, hy) }, this.activeMapName, px, py, {}).open();
  }

  /** Edit the region on hex (px, py) of `overworld` (default the open map; from inside a region, its overworld). */
  openEditRegion(px: number, py: number, overworld = this.activeMapName): void {
    const openLocations = (hx: number, hy: number) => {
      if (overworld === this.activeMapName) { this.host.openLocationsList(hx, hy); return; }
      // The list belongs to the overworld hex: go there first.
      this.host.navigateToMap(overworld);
      window.setTimeout(() => this.host.openLocationsList(hx, hy), 50);
    };
    const wm = this.wm;
    if (!wm) return;
    new wm.EditRegionModal({ ...this.host.biomeHost(), openLocations }, overworld, px, py).open();
  }

}
