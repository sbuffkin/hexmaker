/**
 * "Edit region…" (owner, #49): one modal for an overworld region, opened
 * from a region's right-click menu on the overworld (both views), in every
 * work mode. The overworld is the big-picture view, so it offers this
 * instead of the per-hex editor.
 *
 * - header: the region's name (editable, as Map properties' Name) and the
 *   overworld hex it sits on; Enter region, Open map note;
 * - biome: God shows a scrolling picker like the hex editor's terrain
 *   strip, with Reroll and Settings… (RegionGenModal: options, blend, seed,
 *   live preview). Build and Play show it read-only with one line saying
 *   how to change it (editRegionPlan);
 * - facts: size and shape, palette, terrain counts (the map note Summary's
 *   counts), neighbouring regions (the nav flower's), locations;
 * - notes: the region map note's `## Notes` section, editable in every
 *   mode (note text is never locked).
 */

import { Notice, TFile } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import { regionMapAt, regionSettingsLabel } from "../maps/submaps";
import { terrainCounts } from "../maps/mapNote";
import { readNotesSection, writeNotesSection } from "../maps/mapNoteNotes";
import { flowerPetals } from "../maps/mapNav";
import { biomeInfo, type BiomeId } from "../overworld/biomes";
import { hexBiomeAt, overworldOf, regenerateRegion, regionBiomeStatus, setBiomeAt } from "../overworld/regionsVault";
import { openBiomeGenerator } from "./BiomeLibraryModal";
import { editRegionPlan, terrainCountsText } from "../overworld/overworldInput";
import { biomeTileTitle, mayReshape, paintableBiomes, RegionGenModal, reshapeUndoable, type BiomeHost } from "./BiomeModals";
import { openNoteFocused } from "../openNote";
import { createIconEl, getIconUrl } from "../utils";

export interface EditRegionHost extends BiomeHost {
  /** The overworld hex's Locations list. */
  openLocations(px: number, py: number): void;
}

const NOTES_SAVE_MS = 800;

export class EditRegionModal extends HexmakerModal {
  private stopKeepInViewport: (() => void) | null = null;
  private notesTimer: number | null = null;
  /** Notes typed and not written yet (null: nothing pending). */
  private pendingNotes: string | null = null;
  private notesStatus: HTMLElement | null = null;

  constructor(private host: EditRegionHost, private overworld: string, private px: number, private py: number) {
    super(host.app);
  }

  private get regionName(): string | undefined {
    return regionMapAt(this.host.plugin.settings.maps, this.overworld, `${this.px}_${this.py}`)?.name;
  }

  onOpen(): void {
    this.makeDraggable();
    this.modalEl.addClass("duckmage-edit-region-modal");
    this.stopKeepInViewport = this.keepInViewport();
    this.render();
  }

  private render(): void {
    const { plugin } = this.host;
    const name = this.regionName;
    const region = name ? plugin.getMap(name) : undefined;
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText("Edit region");
    if (!name || !region) {
      contentEl.createEl("p", { text: "There's no region on this hex any more." });
      return;
    }
    const overworld = plugin.getMap(this.overworld);
    const plan = editRegionPlan(overworld);

    // ── header: name, where it is, enter / open note ─────────────────────
    const head = contentEl.createDiv({ cls: "duckmage-edit-region-head" });
    const nameRow = head.createDiv({ cls: "duckmage-region-row" });
    const nameInput = nameRow.createEl("input", {
      type: "text",
      cls: "duckmage-edit-region-name",
      value: plugin.mapLabel(name),
      attr: { "aria-label": "Region name" },
    });
    const saveName = () => {
      const typed = nameInput.value.trim();
      if (!typed || typed === plugin.mapLabel(name)) return;
      void plugin.setMapDisplayName(name, typed).then(() => {
        nameInput.value = plugin.mapLabel(name);
        this.host.changed();
      });
    };
    nameInput.addEventListener("change", saveName);
    nameInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") nameInput.blur();
    });
    head.createEl("p", {
      cls: "duckmage-map-origin-desc",
      text: `Hex ${this.px}, ${this.py} of ${plugin.mapLabel(this.overworld)}.`,
    });
    const actions = head.createDiv({ cls: "duckmage-token-modal-buttons duckmage-edit-region-actions" });
    const enter = actions.createEl("button", { text: "Enter region", cls: "mod-cta" });
    enter.addEventListener("click", () => {
      this.close();
      this.host.enter(name);
    });
    // Focus the primary action, not the name box (a stray key would rename).
    window.setTimeout(() => enter.focus(), 0);
    actions.createEl("button", { text: "Open map note" }).addEventListener("click", () => {
      const file = plugin.app.vault.getAbstractFileByPath(plugin.mapStore.notePath(name));
      if (!(file instanceof TFile)) {
        new Notice("This region's map note isn't written yet.");
        return;
      }
      this.close();
      void openNoteFocused(plugin.app, file);
    });

    // ── biome ─────────────────────────────────────────────────────────────
    const terrain = plugin.mapStore.get(this.overworld, `${this.px}_${this.py}`)?.terrain;
    const palette = plugin.getMapPalette(this.overworld);
    const current = hexBiomeAt(plugin, this.overworld, `${this.px}_${this.py}`);
    const biomeSec = contentEl.createDiv({ cls: "duckmage-editor-section duckmage-edit-region-biome" });
    biomeSec.createEl("h4", { text: "Biome" });
    const status = regionBiomeStatus(plugin, name);
    if (status && "unknown" in status) {
      biomeSec.createEl("p", { cls: "duckmage-locked-hint", text: `Unknown biome: ${status.unknown} (its note is gone). The region keeps its terrain.` });
    }
    const editGenerator = (row: HTMLElement) => {
      if (!current) return;
      row.createEl("button", { text: "Edit generator…", attr: { title: "Tune how this biome's regions are made" } }).addEventListener("click", () => {
        this.close();
        void openBiomeGenerator(plugin, current);
      });
    };
    const biomes = paintableBiomes(plugin, this.overworld);
    if (plan.biome === "pick") {
      const grid = biomeSec.createDiv({ cls: "duckmage-terrain-picker duckmage-edit-region-biomes" });
      for (const b of biomes) {
        const tile = grid.createDiv({
          cls: `duckmage-terrain-option${b.id === current ? " is-selected" : ""}`,
          attr: { title: biomeTileTitle(b), "data-biome": b.id, role: "button", tabindex: "0" },
        });
        const preview = tile.createDiv({ cls: "duckmage-terrain-preview" });
        preview.setCssProps({ "--duckmage-bg": b.color });
        const entry = palette.find((t) => t.name === b.terrain);
        if (entry?.icon) createIconEl(preview, getIconUrl(plugin, entry.icon), b.label, entry.iconColor, "duckmage-terrain-preview-icon");
        tile.createSpan({ text: b.label, cls: "duckmage-terrain-option-name" });
        const pick = () => {
          if (b.id === current) return;
          void this.setBiome(b.id);
        };
        tile.addEventListener("click", pick);
        tile.addEventListener("keydown", (e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
        });
      }
      // Scroll the current biome into the strip's view (it may be past row two).
      window.requestAnimationFrame(() => {
        const sel = grid.querySelector<HTMLElement>(".is-selected");
        if (!sel) return;
        const g = grid.getBoundingClientRect(), r = sel.getBoundingClientRect();
        if (r.bottom > g.bottom || r.top < g.top) grid.scrollTop += r.top - g.top - 4;
      });
      const row = biomeSec.createDiv({ cls: "duckmage-token-modal-buttons duckmage-edit-region-gen" });
      if (plan.reroll) {
        row.createEl("button", { text: "Reroll", attr: { title: "Remake the region with a new seed (hand-painted hexes stay)" } })
          .addEventListener("click", () => void this.reroll(name));
      }
      if (plan.settings) {
        row.createEl("button", { text: "Settings…", attr: { title: "Biome, blend, seed, with a live preview" } }).addEventListener("click", () => {
          this.close();
          new RegionGenModal(this.host, this.overworld, this.px, this.py).open();
        });
      }
      editGenerator(row);
    } else {
      const shown = biomes.find((b) => b.id === current);
      const row = biomeSec.createDiv({ cls: "duckmage-edit-region-biome-show" });
      const swatch = row.createSpan({ cls: "duckmage-biome-swatch" });
      if (shown) swatch.setCssProps({ "--duckmage-biome-color": shown.color });
      row.createSpan({ text: shown?.label ?? (current ? biomeInfo(current)?.label ?? current : terrain ?? "None") });
      if (plan.hint) biomeSec.createEl("p", { cls: "duckmage-locked-hint", text: plan.hint });
      editGenerator(biomeSec.createDiv({ cls: "duckmage-token-modal-buttons duckmage-edit-region-gen" }));
    }

    // ── facts ─────────────────────────────────────────────────────────────
    const facts = contentEl.createDiv({ cls: "duckmage-editor-section duckmage-edit-region-facts" });
    facts.createEl("h4", { text: "Region" });
    const dl = facts.createEl("dl", { cls: "duckmage-edit-region-dl" });
    const fact = (label: string): HTMLElement => {
      dl.createEl("dt", { text: label });
      return dl.createEl("dd");
    };
    const ow = overworldOf(plugin, this.overworld);
    const { cols, rows } = region.gridSize;
    fact("Size").setText(ow ? regionSettingsLabel(ow.settings) : `${cols} × ${rows}`);
    fact("Palette").setText(region.paletteName ?? plugin.mapPaletteName(name) ?? "none");
    const { counts, blank } = terrainCounts(plugin.mapStore.all(name), region);
    fact("Terrain").setText(terrainCountsText(counts, blank));

    const near = fact("Next to");
    const layout = ow?.layout;
    const neighbours = layout
      ? flowerPetals(layout.orientation, layout.parentStagger, this.px, this.py)
          .map((p) => ({ bearing: p.bearing, region: regionMapAt(plugin.settings.maps, this.overworld, `${p.hex[0]}_${p.hex[1]}`)?.name }))
          .filter((n): n is { bearing: string; region: string } => !!n.region)
      : [];
    if (!neighbours.length) near.setText("None yet");
    for (const n of neighbours) {
      const link = near.createEl("a", {
        cls: "duckmage-edit-region-neighbour",
        text: plugin.mapLabel(n.region),
        attr: { href: "#", title: `${n.bearing[0].toUpperCase()}${n.bearing.slice(1)}: go to ${plugin.mapLabel(n.region)}` },
      });
      link.addEventListener("click", (e) => {
        e.preventDefault();
        this.close();
        this.host.enter(n.region);
      });
    }

    let inside = 0;
    for (const h of plugin.mapStore.all(name).values()) inside += h.locations?.length ?? 0;
    const onHex = plugin.mapStore.get(this.overworld, `${this.px}_${this.py}`)?.locations?.length ?? 0;
    const locs = fact("Locations");
    locs.setText(`${inside} inside` + (onHex ? `, ${onHex} on this hex ` : " "));
    const list = locs.createEl("a", { text: "List…", attr: { href: "#", title: "This hex's locations: open, link, reorder" } });
    list.addEventListener("click", (e) => {
      e.preventDefault();
      this.close();
      this.host.openLocations(this.px, this.py);
    });

    // ── notes (never locked) ──────────────────────────────────────────────
    const notesSec = contentEl.createDiv({ cls: "duckmage-editor-section duckmage-edit-region-notes" });
    const notesHead = notesSec.createDiv({ cls: "duckmage-edit-region-notes-head" });
    notesHead.createEl("h4", { text: "Notes" });
    this.notesStatus = notesHead.createSpan({ cls: "duckmage-edit-region-notes-status" });
    const notes = notesSec.createEl("textarea", {
      cls: "duckmage-edit-region-notes-input",
      attr: { rows: "4", placeholder: "What's this region like? Kept in its map note.", "aria-label": "Region notes" },
    });
    notes.disabled = true;
    void plugin.mapStore.readNoteText(name).then((text) => {
      notes.value = text === null ? "" : readNotesSection(text);
      notes.disabled = false;
    });
    notes.addEventListener("input", () => {
      this.pendingNotes = notes.value;
      this.notesStatus?.setText("");
      if (this.notesTimer !== null) window.clearTimeout(this.notesTimer);
      this.notesTimer = window.setTimeout(() => void this.saveNotes(), NOTES_SAVE_MS);
    });
    notes.addEventListener("blur", () => void this.saveNotes());
  }

  /** Write typed notes into the region map note's Notes section. */
  private async saveNotes(): Promise<void> {
    if (this.notesTimer !== null) { window.clearTimeout(this.notesTimer); this.notesTimer = null; }
    const text = this.pendingNotes;
    const name = this.regionName;
    if (text === null || !name) return;
    this.pendingNotes = null;
    const ok = await this.host.plugin.mapStore.editNoteText(name, (c) => writeNotesSection(c, text));
    if (!ok) new Notice("This region's map note isn't written yet; notes not saved.");
    else this.notesStatus?.setText("Saved");
  }

  private async setBiome(biome: BiomeId): Promise<void> {
    if (!mayReshape(this.host, this.overworld, this.px, this.py)) return;
    const notice = new Notice("Remaking the region…", 0);
    const res = await reshapeUndoable(this.host.plugin, this.overworld, this.px, this.py, () => setBiomeAt(this.host.plugin, this.overworld, this.px, this.py, biome));
    notice.hide();
    if ("error" in res) new Notice(res.error);
    this.host.changed();
    await this.saveNotes();
    this.render();
  }

  private async reroll(name: string): Promise<void> {
    if (!mayReshape(this.host, this.overworld, this.px, this.py)) return;
    await reshapeUndoable(this.host.plugin, this.overworld, this.px, this.py, () => regenerateRegion(this.host.plugin, name, { seed: Math.floor(Math.random() * 1e9) }));
    this.host.changed();
    await this.saveNotes();
    this.render();
  }

  onClose(): void {
    void this.saveNotes();
    this.stopKeepInViewport?.();
    this.stopKeepInViewport = null;
    this.contentEl.empty();
  }
}
