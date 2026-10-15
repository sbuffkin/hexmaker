/**
 * The hex editor's neighbour flower (title row): the six hexes around this
 * one, coloured by terrain. A click moves the editor to a neighbour, steps
 * into a neighbouring region, or walks into new land past the map's edge;
 * the centre dot copies a link to this hex.
 */

import { getTerrainFromFile } from "../../frontmatter";
import type { MapData, TerrainColor } from "../../types";
import { resolveHex, type Side } from "../../worldgen/world";
import { neighbourSpec } from "../../worldgen/neighbours";
import { worldMaps } from "../../modules/runtime";
import { flowerPetals, neighbourButton, PETAL_SIZE } from "../../maps/mapNav";
import { RegionNavigateModal } from "../RegionNavigateModal";
import { copyHexLink } from "../copyHexLink";
import { EditorPart, type EditorHexHost } from "./host";

export interface NeighbourFlowerHost extends EditorHexHost {
  /** Move the editor to hex (nx, ny) of this map. */
  navigate(nx: number, ny: number): void;
  close(): void;
}

/** Which side of the map an off-map hex lies past (east/west first at corners). */
function offMapSide(map: MapData, x: number, y: number): Side {
  const { x: ox, y: oy } = map.gridOffset;
  if (x < ox) return "west";
  if (x >= ox + map.gridSize.cols) return "east";
  return y < oy ? "north" : "south";
}

export class NeighbourFlower extends EditorPart<NeighbourFlowerHost> {
  private close(): void {
    this.host.close();
  }

  private isOnMap(nx: number, ny: number): boolean {
    const region = this.plugin.getOrCreateMap(this.mapName);
    const { gridOffset, gridSize } = region;
    return (
      nx >= gridOffset.x &&
      nx < gridOffset.x + gridSize.cols &&
      ny >= gridOffset.y &&
      ny < gridOffset.y + gridSize.rows
    );
  }

  renderNeighborWidget(
    container: HTMLElement,
    x: number,
    y: number,
  ): void {
    const isFlat = this.plugin.settings.hexOrientation === "flat";
    const stagger =
      this.plugin.getMap(this.mapName)?.staggerOffset
      ?? this.plugin.settings.staggerOffset
      ?? "odd";
    // notShifted = the hex sits on the non-staggered (un-shifted) row/col.
    const notShifted = (n: number) =>
      stagger === "odd" ? n % 2 === 0 : n % 2 !== 0;
    // First-wins on duplicate-named palette entries — matches HexMapView's
    // .find() behaviour so the neighbor preview agrees with the main grid.
    const paletteMap = new Map<string, TerrainColor>();
    for (const p of this.plugin.getMapPalette(this.mapName)) {
      if (!paletteMap.has(p.name)) paletteMap.set(p.name, p);
    }
    const widget = container.createDiv({ cls: "duckmage-neighbor-widget" });

    type NeighborDef = { l: number; t: number; nx: number; ny: number };
    const defs: NeighborDef[] = isFlat
      ? [
          { l: 22, t: 2, nx: x, ny: y - 1 }, // N
          { l: 42, t: 13, nx: x + 1, ny: notShifted(x) ? y - 1 : y }, // NE
          { l: 42, t: 32, nx: x + 1, ny: notShifted(x) ? y : y + 1 }, // SE
          { l: 22, t: 40, nx: x, ny: y + 1 }, // S
          { l: 2, t: 32, nx: x - 1, ny: notShifted(x) ? y : y + 1 }, // SW
          { l: 2, t: 13, nx: x - 1, ny: notShifted(x) ? y - 1 : y }, // NW
        ]
      : [
          { l: 10, t: 1, nx: notShifted(y) ? x - 1 : x, ny: y - 1 }, // NW
          { l: 34, t: 1, nx: notShifted(y) ? x : x + 1, ny: y - 1 }, // NE
          { l: 0, t: 18, nx: x - 1, ny: y }, // W
          { l: 44, t: 18, nx: x + 1, ny: y }, // E
          { l: 10, t: 35, nx: notShifted(y) ? x - 1 : x, ny: y + 1 }, // SW
          { l: 34, t: 35, nx: notShifted(y) ? x : x + 1, ny: y + 1 }, // SE
        ];

    // World maps' walking (regions of an overworld, new land next door);
    // undefined in a build without it.
    const wm = worldMaps();
    // Tiles were laid out at 16px; drawn at the toolbar flower's 22px (user test
    // 2026-10-12: too small to hit), so every offset scales with them.
    const S = PETAL_SIZE / 16;
    widget.setCssProps({
      "--duckmage-nb-w": `${Math.ceil(Math.max(...defs.map((d) => d.l)) * S + PETAL_SIZE)}px`,
      "--duckmage-nb-h": `${Math.ceil(Math.max(...defs.map((d) => d.t)) * S + PETAL_SIZE)}px`,
    });
    for (const { l, t, nx, ny } of defs) {
      const onMap = this.isOnMap(nx, ny);
      const tile = widget.createDiv({
        cls: `duckmage-neighbor-tile${onMap ? "" : " duckmage-neighbor-tile-offmap"}`,
      });
      tile.setCssProps({ left: `${(l * S).toFixed(1)}px`, top: `${(t * S).toFixed(1)}px` });

      if (onMap) {
        tile.title = `Hex ${nx}, ${ny}`;
        const nPath = this.plugin.hexPath(nx, ny, this.mapName);
        const terrain = getTerrainFromFile(this.app, nPath);
        const entry = terrain ? paletteMap.get(terrain) : undefined;
        if (entry) tile.setCssProps({ "--duckmage-bg": entry.color });
        tile.addEventListener("click", () => this.host.navigate(nx, ny));
      } else {
        // Past the edge: a neighbouring region's hex, if one sits there.
        const here = this.plugin.getMap(this.mapName);
        const across = here ? resolveHex(this.plugin.settings.maps, here, nx, ny) : null;
        if (across && across.map.name !== this.mapName) {
          const target = { map: across.map.name, x: across.x, y: across.y };
          tile.addClass("duckmage-neighbor-tile-region");
          tile.removeClass("duckmage-neighbor-tile-offmap");
          tile.title = `${target.map}: hex ${target.x}, ${target.y}`;
          const t = getTerrainFromFile(this.app, this.plugin.hexPath(target.x, target.y, target.map));
          const color = t ? this.plugin.getMapPalette(target.map).find((p) => p.name === t)?.color : undefined;
          if (color) tile.setCssProps({ "--duckmage-bg": color });
          tile.addEventListener("click", () => {
            new RegionNavigateModal(this.app, this.plugin, target, () => {
              this.close();
              this.options.onCrossToRegion?.(target.map, target.x, target.y);
            }).open();
          });
        } else if (here && wm?.regionHome(this.plugin, this.mapName)) {
          // A region of an overworld: past the edge is the overworld hex
          // next door, with no region yet. Same walk as the map toolbar's
          // region flower (pick or roll its biome; Build and God only).
          const home = wm.regionHome(this.plugin, this.mapName)!;
          const [px, py] = wm.parentOf(home.layout, nx, ny);
          const bearing = flowerPetals(home.layout.orientation, home.layout.parentStagger, home.px, home.py)
            .find((p) => p.hex[0] === px && p.hex[1] === py)?.bearing ?? offMapSide(here, nx, ny);
          const lock = wm.walkLock(this.plugin, this.mapName, home.overworld.name);
          const b = neighbourButton(bearing, undefined, { canMake: true, canAdd: !lock, lockedHint: lock ?? "" });
          tile.addClass("duckmage-neighbor-tile-new");
          tile.removeClass("duckmage-neighbor-tile-offmap");
          if (b.action.kind === "locked") tile.addClass("is-locked");
          tile.title = b.title;
          if (b.action.kind === "new") {
            tile.addEventListener("click", () => {
              // Edit region's new-region mode: preview, mix, reroll, then Create and go.
              const host = {
                app: this.app,
                plugin: this.plugin,
                enter: (name: string) => this.options.onCrossToRegion?.(name, nx, ny),
                changed: () => this.plugin.refreshHexMap(),
                openLocations: () => undefined,
              };
              new wm.EditRegionModal(host, home.overworld.name, px, py, {
                walk: { from: this.mapName, bearing },
                onCreated: (name) => {
                  this.close();
                  this.options.onCrossToRegion?.(name, nx, ny);
                },
              }).open();
            });
          }
        } else if (here && wm && neighbourSpec(this.plugin, this.mapName, offMapSide(here, nx, ny)).ok) {
          // Nothing there yet: walk into new land (pick or roll its biome).
          const side = offMapSide(here, nx, ny);
          tile.addClass("duckmage-neighbor-tile-new");
          tile.removeClass("duckmage-neighbor-tile-offmap");
          tile.title = `New land to the ${side}…`;
          tile.addEventListener("click", () => {
            new wm.WalkRegionModal(this.app, this.plugin, this.mapName, side, () => {
              const now = this.plugin.getMap(this.mapName);
              const arrived = now ? resolveHex(this.plugin.settings.maps, now, nx, ny) : null;
              if (!arrived || arrived.map.name === this.mapName) return;
              this.close();
              this.options.onCrossToRegion?.(arrived.map.name, arrived.x, arrived.y);
            }).open();
          });
        } else {
          tile.title = "Off map";
        }
      }
    }

    // Centre dot: this hex. A click copies a link to it that a note can
    // use: it opens the map centred on this hex (src/hexLink.ts). Entering
    // the hex's region or locations is the Maps strip's job.
    const centre = widget.createEl("button", {
      cls: "duckmage-neighbor-centre duckmage-neighbor-centre--linked duckmage-neighbor-centre--copy",
      attr: { title: "Copy link to this hex (opens the map centred here)", "aria-label": "Copy link to this hex" },
    });
    // Flower centre at 16px scale: flat-top (30,30), pointy-top (30,26); the dot is 16×16.
    centre.setCssProps({ left: `${(30 * S - 8).toFixed(1)}px`, top: `${((isFlat ? 30 : 26) * S - 8).toFixed(1)}px` });
    const own = getTerrainFromFile(this.app, this.plugin.hexPath(x, y, this.mapName));
    const ownColor = own ? paletteMap.get(own)?.color : undefined;
    if (ownColor) centre.setCssProps({ "--duckmage-bg": ownColor });
    centre.addEventListener("click", () => this.copyHexLink());
  }

  /** "Copy link to this hex": a Markdown link that opens the map centred on it (src/hexLink.ts). */
  private copyHexLink(): void {
    copyHexLink(this.plugin, this.mapName, this.x, this.y);
  }
}
