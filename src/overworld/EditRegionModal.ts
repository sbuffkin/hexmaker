/**
 * "Edit region…" (owner, #49): one modal for an overworld region, opened
 * from a region's right-click menu on the overworld (both views), in every
 * work mode. The overworld is the big-picture view, so it offers this
 * instead of the per-hex editor.
 *
 * - header: the region's name (editable, as Map properties' Name) and the
 *   overworld hex it sits on; Enter region, Open map note;
 * - biome: where the region may be changed (Build while it's new, God
 *   once it's locked) a scrolling picker like the hex editor's terrain
 *   strip, with Reroll and Settings… (RegionGenModal: options, blend, seed,
 *   live preview), and Lock while it's new. Elsewhere it's read-only with
 *   one line saying how to change it (editRegionPlan);
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
import { biomeInfo, biomeParts, biomeRef, combinedBiome, isComboId, representativeTerrain, type BiomeId } from "./biomes";
import { mixToParts, newPartWeight, type BiomePart } from "./biomeCombo";
import { renderShareSliders } from "../ui/shareSliders";
import { renderSaveStatusLine, type SaveStatusLine } from "../ui/saveStatusLine";
import { hexBiomeAt, overworldOf, planRegionAt, planRegionWithGenerator, regionBiomeStatus, setBiomeAt } from "./regionsVault";
import { renderBiomeTiles } from "./biomeChooser";
import { openBiomeGenerator } from "./BiomeLibraryModal";
import { openMakeGenerator } from "./MakeGeneratorModal";
import { openBlendIntoBiome } from "./BlendIntoBiomeModal";
import { editRegionPlan, terrainCountsText } from "./overworldInput";
import { biomeTileTitle, drawRegionNow, drawRegionPlan, mayReshape, paintableBiomes, RegionGenModal, rerollRegionAt, reshapeUndoable, type BiomeHost, type PaintableBiome } from "./BiomeModals";
import { openNoteFocused } from "../openNote";
import { confirmOverworldPath, overworldPathsAt } from "./overworldPaths";
import { canDo } from "../modeGate";
import { addGodOffer } from "../hex-map/godOffer";
import { WORK_MODE_TEXT } from "../workMode";

export interface EditRegionHost extends BiomeHost {
  /** The overworld hex's Locations list. */
  openLocations(px: number, py: number): void;
}

const NOTES_SAVE_MS = 800;
/** The mix's live preview redraws at most this often while a slider moves. */
const MIX_PREVIEW_MS = 120;

export class EditRegionModal extends HexmakerModal {
  private stopKeepInViewport: (() => void) | null = null;
  private notesTimer: number | null = null;
  /** Notes typed and not written yet (null: nothing pending). */
  private pendingNotes: string | null = null;
  /** The shared autosave line beside the notes. */
  private notesStatus: SaveStatusLine | null = null;
  /** The next render follows a Reroll: its preview is marked new. */
  private justRerolled = false;
  /** The biomes being mixed (Mix biomes…), or null when picking one; undefined until the first render. */
  private mix: BiomePart[] | null | undefined = undefined;
  /** The biome section's preview canvas (the mix's live preview draws into it). */
  private preview: HTMLCanvasElement | null = null;
  private mixToken = 0;
  private mixTimer: number | null = null;

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
    const plan = editRegionPlan(overworld, region);

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
    const actions = head.createDiv({ cls: "duckmage-action-row duckmage-edit-region-actions" });
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
      // A mix has no generator of its own: each part's is edited on its biome.
      if (current && !isComboId(current)) {
        row.createEl("button", { text: "Edit generator…", attr: { title: "Tune how this biome's regions are made" } }).addEventListener("click", () => {
          this.close();
          void openBiomeGenerator(plugin, current);
        });
      }
      // PR1: learn a generator from this region as painted (new, or over an existing one).
      row.createEl("button", { text: "Make generator…", attr: { title: "Learn a generator from this region's terrain; its biome starts as a copy of this one" } }).addEventListener("click", () => {
        this.close();
        openMakeGenerator(plugin.app, plugin, name);
      });
      // Fold this region, as hand-edited, back into its biome (Advanced; Build or God).
      const biome = current ? plugin.biomeStore.get(current) : undefined;
      if (biome && !biome.blank) {
        const blend = row.createEl("button", { text: `Blend into ${biome.label}…`, attr: { title: "Learn from this region and blend it into its biome's generator (or the biome's own settings)" } });
        blend.addEventListener("click", () => {
          this.close();
          void openBlendIntoBiome(plugin.app, plugin, name);
        });
        this.place("EditRegion.blendIntoBiome", blend);
      }
    };
    const biomes = paintableBiomes(plugin, this.overworld);
    // Mixing several biomes: starts on when the region already is a mix.
    if (this.mix === undefined) this.mix = current && isComboId(current) ? biomeParts(current) : null;
    const mixing = plan.biome === "pick" && this.mix !== null;
    if (plan.biome === "pick") {
      const head = biomeSec.createDiv({ cls: "duckmage-edit-region-mix-toggle" });
      const toggle = head.createEl("button", {
        text: mixing ? "One biome" : "Mix biomes…",
        attr: { title: mixing ? "Go back to picking one biome (nothing changes until you pick one)" : "Pick more than one biome for this region, with a share each" },
      });
      toggle.addEventListener("click", () => {
        this.mix = mixing ? null : (current ? biomeParts(current) : []);
        this.render();
      });
      if (mixing) head.createSpan({ cls: "setting-item-description", text: "Click biomes to add or remove them; the sliders say how much of each." });
      // Blank biomes start empty: there's nothing of them to mix.
      const offered = mixing ? biomes.filter((b) => b.terrain) : biomes;
      const parts = new Set((this.mix ?? []).map((p) => p.id));
      const grid = renderBiomeTiles(biomeSec, plugin, palette, offered, {
        cls: "duckmage-terrain-picker duckmage-edit-region-biomes",
        isSelected: (id) => (mixing ? parts.has(id) : id === current),
        title: biomeTileTitle,
        onPick: (b) => {
          if (this.mix) {
            const i = this.mix.findIndex((p) => p.id === b.id);
            if (i >= 0) this.mix.splice(i, 1);
            else this.mix.push({ id: b.id, weight: newPartWeight(this.mix) });
            grid.querySelector<HTMLElement>(`[data-biome="${b.id}"]`)?.toggleClass("is-selected", i < 0);
            this.renderMix(mixPanel, plugin, offered, current);
            return;
          }
          if (b.id === current) return;
          void this.setBiome(b.id);
        },
      });
      const mixPanel = biomeSec.createDiv({ cls: "duckmage-edit-region-mix" });
      if (mixing) this.renderMix(mixPanel, plugin, offered, current);
      // Scroll the current biome into the strip's view (it may be past row two).
      window.requestAnimationFrame(() => {
        const sel = grid.querySelector<HTMLElement>(".is-selected");
        if (!sel) return;
        const g = grid.getBoundingClientRect(), r = sel.getBoundingClientRect();
        if (r.bottom > g.bottom || r.top < g.top) grid.scrollTop += r.top - g.top - 4;
      });
      const row = biomeSec.createDiv({ cls: "duckmage-action-row duckmage-edit-region-gen" });
      if (plan.reroll) {
        row.createEl("button", { text: "Reroll", attr: { title: "Remake the region with a new seed (hand-painted hexes stay)" } })
          .addEventListener("click", () => void this.reroll());
      }
      if (plan.settings) {
        row.createEl("button", { text: "Settings…", attr: { title: "Biome, blend, seed, with a live preview" } }).addEventListener("click", () => {
          this.close();
          new RegionGenModal(this.host, this.overworld, this.px, this.py).open();
        });
      }
      if (plan.lock) this.addLock(row, name);
      editGenerator(row);
    } else {
      // A mix shows as its parts with their weights ("Alpine 2 + Taiga"), in its dominant part's colour.
      const shown = biomes.find((b) => b.id === (current && isComboId(current) ? biomeParts(current)[0]?.id : current));
      const row = biomeSec.createDiv({ cls: "duckmage-edit-region-biome-show" });
      const swatch = row.createSpan({ cls: "duckmage-biome-swatch" });
      if (shown) swatch.setCssProps({ "--duckmage-biome-color": shown.color });
      row.createSpan({ text: current && isComboId(current) ? biomeRef(current) : shown?.label ?? (current ? biomeInfo(current)?.label ?? current : terrain ?? "None") });
      if (plan.hint) {
        const hint = biomeSec.createEl("p", { cls: "duckmage-locked-hint", text: plan.hint });
        // Changing a placed biome is God's: offer the switch right here (godOffer.ts).
        addGodOffer(hint, plugin, this.overworld, plan.hint, () => this.render());
      }
      const genRow = biomeSec.createDiv({ cls: "duckmage-action-row duckmage-edit-region-gen" });
      if (plan.lock) this.addLock(genRow, name);
      editGenerator(genRow);
    }
    // The region as it is now, its neighbours dimmed: this dialog covers
    // most of the map, so a Reroll (or a new biome) shows its result here.
    const preview = biomeSec.createEl("canvas", {
      cls: "duckmage-edit-region-preview",
      attr: { role: "img", "aria-label": `${plugin.mapLabel(name)} as it is now` },
    });
    preview.width = 240;
    preview.height = 150;
    this.preview = preview;
    // While mixing, it previews the mix instead (live, as Settings… does).
    if (mixing && (this.mix?.length ?? 0) > 0) this.drawMixPreview();
    else drawRegionNow(preview, plugin, this.overworld, this.px, this.py);
    if (this.justRerolled) {
      preview.addClass("is-new");
      this.justRerolled = false;
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

    // Overworld paths through this hex: drafts can be confirmed into the regions from here.
    const through = overworldPathsAt(plugin, this.overworld, `${this.px}_${this.py}`);
    if (through.length) {
      const ul = fact("Paths").createEl("ul", { cls: "duckmage-edit-region-paths" });
      const mayConfirm = canDo(this.overworld, "edit-path");
      for (const p of through) {
        const li = ul.createEl("li");
        li.createSpan({ text: p.name });
        li.createSpan({ cls: "duckmage-edit-region-path-state", text: p.applied ? "in the regions" : "draft" });
        if (!mayConfirm) continue;
        li.createEl("button", {
          text: p.applied ? "Update regions" : "Confirm into regions",
          attr: { title: "Put this path into every region it crosses, joined at the seams (one undo step)" },
        }).addEventListener("click", () => void this.confirmPath(p.name));
      }
    }

    // ── notes (never locked) ──────────────────────────────────────────────
    const notesSec = contentEl.createDiv({ cls: "duckmage-editor-section duckmage-edit-region-notes" });
    const notesHead = notesSec.createDiv({ cls: "duckmage-edit-region-notes-head" });
    notesHead.createEl("h4", { text: "Notes" });
    this.notesStatus = renderSaveStatusLine(notesHead, { cls: "duckmage-edit-region-notes-status", title: "Saves a moment after you stop typing, and when you close this. There is no Save button." });
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
      this.notesStatus?.pending();
      if (this.notesTimer !== null) window.clearTimeout(this.notesTimer);
      this.notesTimer = window.setTimeout(() => void this.saveNotes(), NOTES_SAVE_MS);
    });
    notes.addEventListener("blur", () => void this.saveNotes());
    // The simple job first (UI worksheet: name, enter, notes are Simple):
    // notes sit right under the header, above the biome and the facts.
    head.after(notesSec);
  }

  /**
   * The mix's rows (the shared zero-sum sliders: one per biome, adding up to
   * 100%, each with a remove button) and its Apply button, then the live
   * preview, redrawn as you drag. Changes nothing until Apply.
   */
  private renderMix(panel: HTMLElement, plugin: EditRegionHost["plugin"], offered: PaintableBiome[], current: BiomeId | undefined): void {
    panel.empty();
    const parts = this.mix ?? [];
    if (!parts.length) panel.createEl("p", { cls: "setting-item-description", text: "No biomes picked yet: click the ones to mix." });
    else {
      renderShareSliders(panel, {
        items: parts.map((p) => {
          const b = offered.find((x) => x.id === p.id);
          return { label: b?.label ?? biomeInfo(p.id)?.label ?? p.id, color: b?.color ?? "#888" };
        }),
        weights: parts.map((p) => p.weight),
        extra: (row, i) => {
          const p = parts[i];
          const label = offered.find((x) => x.id === p.id)?.label ?? biomeInfo(p.id)?.label ?? p.id;
          const remove = row.createEl("button", { text: "×", cls: "clickable-icon", attr: { "aria-label": `Remove ${label}`, title: `Remove ${label}` } });
          remove.addEventListener("click", () => {
            this.mix = parts.filter((x) => x !== p);
            panel.parentElement?.querySelector<HTMLElement>(`[data-biome="${p.id}"]`)?.removeClass("is-selected");
            this.renderMix(panel, plugin, offered, current);
          });
        },
        onInput: (shares) => {
          shares.forEach((s, i) => (parts[i].weight = s));
          showApply();
          this.scheduleMixPreview();
        },
        onChange: (shares) => {
          shares.forEach((s, i) => (parts[i].weight = s));
          showApply();
          this.scheduleMixPreview();
        },
      });
    }
    const actions = panel.createDiv({ cls: "duckmage-action-row" });
    // Plain: Enter region is this surface's one primary.
    const apply = actions.createEl("button", { text: parts.length === 1 ? "Use this biome" : "Apply mix" });
    let want: BiomeId | undefined;
    const showApply = () => {
      want = this.mixBiome();
      apply.disabled = !want || want === current;
      apply.setAttr("title", !want ? "Pick a biome first" : want === current ? "This is the region's biome now" : `Remake the region from ${biomeRef(want)} (hand-painted hexes stay)`);
    };
    showApply();
    apply.addEventListener("click", () => {
      if (want && want !== current) void this.setBiome(want);
    });
    this.drawMixPreview();
  }

  /** The mix as a biome id, its shares stored as small whole weights ("Alpine 2 + Taiga 1"). */
  private mixBiome(): BiomeId | undefined {
    const current = hexBiomeAt(this.host.plugin, this.overworld, `${this.px}_${this.py}`);
    const parts = mixToParts(this.mix ?? [], current ? biomeParts(current) : undefined);
    return parts.length ? combinedBiome(parts) : undefined;
  }

  /** Redraw the mix preview at most every MIX_PREVIEW_MS while a slider moves. */
  private scheduleMixPreview(): void {
    if (this.mixTimer !== null) return;
    this.mixTimer = window.setTimeout(() => {
      this.mixTimer = null;
      this.drawMixPreview();
    }, MIX_PREVIEW_MS);
  }

  /** Preview the mix on the region (its own seed, so Apply makes what's shown). */
  private drawMixPreview(): void {
    const canvas = this.preview;
    const biome = this.mixBiome();
    if (!canvas || !biome) return;
    const { plugin } = this.host;
    const token = ++this.mixToken;
    const opts = { biome, hexTerrain: representativeTerrain(biome, plugin.getMapPalette(this.overworld)) };
    void planRegionWithGenerator(plugin, this.overworld, this.px, this.py, opts)
      .catch(() => planRegionAt(plugin, this.overworld, this.px, this.py, opts))
      .then((plan) => {
        if (token === this.mixToken) drawRegionPlan(canvas, plugin, this.overworld, this.px, this.py, plan);
      });
  }

  /** Write typed notes into the region map note's Notes section. */
  private async saveNotes(): Promise<void> {
    if (this.notesTimer !== null) { window.clearTimeout(this.notesTimer); this.notesTimer = null; }
    const text = this.pendingNotes;
    const name = this.regionName;
    if (text === null || !name) return;
    this.pendingNotes = null;
    const work = this.host.plugin.mapStore.editNoteText(name, (c) => writeNotesSection(c, text)).then((ok) => {
      if (ok) return;
      new Notice("This region's map note isn't written yet; notes not saved.");
      throw new Error("region note not written");
    });
    if (this.notesStatus) await this.notesStatus.track(work);
    else await work.catch(() => {});
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

  private async confirmPath(pathName: string): Promise<void> {
    const res = await confirmOverworldPath(this.host.plugin, this.overworld, pathName);
    if ("error" in res) new Notice(res.error);
    else new Notice(`${pathName}: in ${res.regions.length === 1 ? "1 region" : `${res.regions.length} regions`}.`);
    this.host.changed();
    await this.saveNotes();
    this.render();
  }

  /** Lock: keep this new region as it is (changing it then needs God; GM4's lock, ArrivalService.lock). */
  private addLock(row: HTMLElement, name: string): void {
    row.createEl("button", { text: "Lock", attr: { title: `Keep this region as it is (changing or rerolling it then needs ${WORK_MODE_TEXT.god.label} mode)` } })
      .addEventListener("click", () => void this.host.plugin.arrival.lock(name).then(() => {
        this.host.changed();
        this.render();
      }));
  }

  private async reroll(): Promise<void> {
    if (!(await rerollRegionAt(this.host, this.overworld, this.px, this.py))) return;
    await this.saveNotes();
    this.justRerolled = true;
    this.render();
  }

  onClose(): void {
    if (this.mixTimer !== null) { window.clearTimeout(this.mixTimer); this.mixTimer = null; }
    void this.saveNotes();
    this.stopKeepInViewport?.();
    this.stopKeepInViewport = null;
    this.contentEl.empty();
  }
}
