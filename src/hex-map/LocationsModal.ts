import { App } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import { filterByQuery, moveItem } from "../maps/submaps";

export interface LocationsModalActions {
  open: (map: string) => void;
  newLocation: () => void;
  linkExisting: () => void;
  /** Called after an unlink or reorder (the map redraws its badge). */
  changed: () => void;
}

/**
 * Every Location of one hex (K7): search, open, unlink, drag to reorder
 * (the order is kept in the map note), plus new / link existing. Opened from
 * the hex's right-click menu once it has more than two locations, and from
 * the hex editor's Maps strip.
 */
export class LocationsModal extends HexmakerModal {
  private query = "";
  private dragFrom: number | null = null;

  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private mapName: string,
    private x: number,
    private y: number,
    private actions: LocationsModalActions,
  ) {
    super(app);
  }

  private locations(): string[] {
    return [...(this.plugin.mapStore.get(this.mapName, `${this.x}_${this.y}`)?.locations ?? [])];
  }

  onOpen(): void {
    this.makeDraggable();
    this.modalEl.addClass("duckmage-locations-modal");
    this.titleEl.setText(`Locations: hex ${this.x}, ${this.y}`);
    const search = this.contentEl.createEl("input", {
      type: "search",
      cls: "duckmage-rt-search duckmage-locations-search",
      attr: { placeholder: "Find a location…", "aria-label": "Find a location" },
    });
    search.addEventListener("input", () => {
      this.query = search.value;
      this.drawList();
    });
    this.contentEl.createDiv({ cls: "duckmage-locations-list" });
    const foot = this.contentEl.createDiv({ cls: "duckmage-locations-foot" });
    foot.createEl("button", { text: "New location…" }).addEventListener("click", () => {
      this.close();
      this.actions.newLocation();
    });
    foot.createEl("button", { text: "Link existing map…" }).addEventListener("click", () => {
      this.close();
      this.actions.linkExisting();
    });
    this.drawList();
    window.setTimeout(() => search.focus(), 0);
  }

  private drawList(): void {
    const list = this.contentEl.querySelector<HTMLElement>(".duckmage-locations-list");
    if (!list) return;
    list.empty();
    const all = this.locations();
    const items = all.map((name, index) => ({ name, label: this.plugin.mapLabel(name), index }));
    const shown = filterByQuery(items, this.query);
    if (!all.length) list.createDiv({ cls: "duckmage-picker-list-empty", text: "No locations yet." });
    else if (!shown.length) list.createDiv({ cls: "duckmage-picker-list-empty", text: "No location matches." });
    // Reordering only makes sense on the whole list.
    const canDrag = !this.query.trim() && all.length > 1;
    for (const it of shown) {
      const map = this.plugin.getMap(it.name);
      const row = list.createDiv({ cls: "duckmage-locations-row" });
      if (canDrag) {
        row.draggable = true;
        row.createSpan({ cls: "duckmage-locations-grip", text: "⋮⋮", attr: { "aria-hidden": "true" } });
        row.addEventListener("dragstart", () => { this.dragFrom = it.index; row.addClass("is-dragging"); });
        row.addEventListener("dragend", () => row.removeClass("is-dragging"));
        row.addEventListener("dragover", (e) => { e.preventDefault(); row.addClass("is-drop-target"); });
        row.addEventListener("dragleave", () => row.removeClass("is-drop-target"));
        row.addEventListener("drop", (e) => {
          e.preventDefault();
          if (this.dragFrom === null || this.dragFrom === it.index) return;
          this.plugin.setHexLocations(this.mapName, this.x, this.y, moveItem(this.locations(), this.dragFrom, it.index));
          this.dragFrom = null;
          this.actions.changed();
          this.drawList();
        });
      }
      const terrain = map?.terrainType ? this.plugin.getMapPalette(it.name).find((t) => t.name === map.terrainType) : undefined;
      const swatch = row.createSpan({ cls: "duckmage-map-terrain-swatch" });
      if (terrain?.color) {
        swatch.setCssProps({ "--duckmage-bg": terrain.color });
        swatch.addClass("duckmage-map-terrain-swatch--set");
      }
      const name = row.createEl("a", { cls: "duckmage-locations-name", text: it.label });
      name.addEventListener("click", () => this.openMap(it.name));
      row.createSpan({
        cls: "duckmage-locations-size",
        text: map ? `${map.gridSize.cols}×${map.gridSize.rows}` : "missing",
        attr: { title: map ? "Size" : "No map with this name (fix it in the map note's Locations column)" },
      });
      const open = row.createEl("button", { text: "Open", attr: { "aria-label": `Open ${it.label}` } });
      open.disabled = !map;
      open.addEventListener("click", () => this.openMap(it.name));
      const unlink = row.createEl("button", { text: "✕", cls: "duckmage-locations-unlink", attr: { "aria-label": `Unlink ${it.label}`, title: "Unlink from this hex (the map itself stays)" } });
      unlink.addEventListener("click", () => {
        void this.plugin.unlinkSubmap(this.mapName, this.x, this.y, it.name).then(() => {
          this.actions.changed();
          this.drawList();
        });
      });
    }
  }

  private openMap(name: string): void {
    if (!this.plugin.getMap(name)) return;
    this.close();
    this.actions.open(name);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
