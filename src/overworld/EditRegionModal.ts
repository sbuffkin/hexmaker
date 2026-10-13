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
 * - Neighbour influence: a weight on the biome's neighbour influence for
 *   this region only (0–2, 1 = as tuned), kept in its map note
 *   (`neighbour-influence:`) and used by every reroll and regenerate.
 *
 * New-region mode (owner 2026-10-13, newRegion.ts): opened on an empty hex
 * (an empty brick, Set biome…, New region, walking into new land) with
 * nothing written. The full suite (biome tiles, Mix biomes, Reroll, Blend,
 * borders, seed, Neighbour influence) edits a draft drawn live against
 * the made neighbours; Create makes exactly that. Cancel or × writes
 * nothing. After Create the dialog carries on as Edit region for the new
 * (open) region; a walk closes and goes there ("Create and go").
 */

import { Notice, TFile } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import { regionMapAt, regionSettingsLabel } from "../maps/submaps";
import { terrainCounts } from "../maps/mapNote";
import { readNotesSection, writeNotesSection } from "../maps/mapNoteNotes";
import { flowerPetals } from "../maps/mapNav";
import { biomeInfo, biomeNoteOf, biomeParts, biomeRef, combinedBiome, isComboId, representativeTerrain, type BiomeId } from "./biomes";
import { dominantPart, mixToParts, newPartWeight, type BiomePart } from "./biomeCombo";
import { renderShareSliders } from "../ui/shareSliders";
import { clampNeighbourWeight, NEIGHBOUR_WEIGHT } from "./neighbourWeight";
import { renderSaveStatusLine, type SaveStatusLine } from "../ui/saveStatusLine";
import { hexBiomeAt, overworldOf, planRegionAt, planRegionWithGenerator, regenerateRegion, regionBiomeStatus, setBiomeAt } from "./regionsVault";
import { renderBiomeTiles } from "./biomeChooser";
import { BiomeLibraryModal, openBiomeGenerator } from "./BiomeLibraryModal";
import { openMakeGenerator } from "./MakeGeneratorModal";
import { openBlendIntoBiome } from "./BlendIntoBiomeModal";
import { editRegionPlan, terrainCountsText } from "./overworldInput";
import { biomeTileTitle, drawRegionNow, drawRegionPlan, groupOfBiome, lockButton, mayReshape, paintableBiomes, RegionGenModal, rerollRegionAt, reshapeUndoable, type BiomeHost, type PaintableBiome } from "./BiomeModals";
import { openNoteFocused } from "../openNote";
import { confirmOverworldPath, overworldPathsAt } from "./overworldPaths";
import { canDo } from "../modeGate";
import { addGodOffer } from "../hex-map/godOffer";
import { WORK_MODE_TEXT } from "../workMode";
import { renderLabeledSlider, sliderFormat, type LabeledSlider } from "../ui/sliders";
import { REGION_WARP, type BlendWidth } from "./blendField";
import { rollBiome } from "./regionWorld";
import { createFromDraft, draftGrowth, draftLock, draftMix, newDraft, newDraftSeed, previewDraft, startBiome, type NewRegionDraft, type NewRegionWalk } from "./newRegion";

/** How Edit region opens on an empty hex: new-region mode (newRegion.ts). */
export interface NewRegionMode {
  /** Walking into new land from a region: its direction label and "Create and go". */
  walk?: NewRegionWalk;
  /** After Create: carry on as Edit region (default; a walk always closes and goes). */
  after?: "edit" | "close";
  /** Told the new region's name after Create (a walk goes there). */
  onCreated?: (name: string) => void;
}

const NEIGHBOUR_ID = "EditRegion.neighbourInfluence";

/**
 * The Neighbour influence slider: the shared labelled slider (value always
 * shown, reset to ×1), a weight on the biome's tuning for this region.
 */
function renderNeighbourSlider(parent: HTMLElement, value: number, on: { input?: (v: number) => void; change?: (v: number) => void }): LabeledSlider {
  return renderLabeledSlider(parent, {
    label: "Neighbour influence",
    help: "How strongly the regions already made around it steer this one: ×1 is as its biome is tuned, ×0 only the seams, ×2 twice as much.",
    min: NEIGHBOUR_WEIGHT.min,
    max: NEIGHBOUR_WEIGHT.max,
    step: NEIGHBOUR_WEIGHT.step,
    value: clampNeighbourWeight(value),
    format: sliderFormat.multiplier,
    reset: { value: NEIGHBOUR_WEIGHT.default },
    cls: "duckmage-edit-region-neighbour-weight",
    onInput: (v) => on.input?.(clampNeighbourWeight(v)),
    onChange: (v) => on.change?.(clampNeighbourWeight(v)),
  });
}
/** Normal Edit: the region is remade this long after the slider stops. */
const WEIGHT_APPLY_MS = 400;
const BLEND_WIDTHS: BlendWidth[] = ["narrow", "normal", "wide"];

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
  private weightTimer: number | null = null;
  /** Normal Edit: the neighbour weight waiting to be applied (run on close too). */
  private pendingWeight: (() => void) | null = null;
  /** New-region mode's draft (null in normal Edit). */
  private draft: NewRegionDraft | null = null;
  /** New-region mode: the line under the preview (border country, a roll). */
  private draftNote: HTMLElement | null = null;
  private rolled = "";

  /**
   * `fresh`: open in new-region mode (the hex has no region yet). Without
   * it, or once the hex has a region, this is the normal Edit region.
   */
  constructor(private host: EditRegionHost, private overworld: string, private px: number, private py: number, private fresh: NewRegionMode | null = null) {
    super(host.app);
  }

  /** In new-region mode (the hex has no region yet)? */
  get isNewRegion(): boolean {
    return !!this.fresh && !this.regionName;
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
    if (this.isNewRegion) {
      this.renderNew(this.fresh!);
      return;
    }
    this.fresh = null;
    this.draft = null;
    this.draftNote = null;
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
    window.setTimeout(() => enter.focus({ preventScroll: true }), 0);
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
      // A weight on the biome's neighbour influence, for this region (remade when the slider stops).
      const weight = renderNeighbourSlider(biomeSec, clampNeighbourWeight(region.neighbourInfluence), {
        change: (w) => {
          if (this.weightTimer !== null) window.clearTimeout(this.weightTimer);
          this.pendingWeight = () => void this.applyWeight(name, w);
          this.weightTimer = window.setTimeout(() => this.flushWeight(), WEIGHT_APPLY_MS);
        },
      });
      this.place(NEIGHBOUR_ID, weight.el);
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
          mixChanged();
          this.scheduleMixPreview();
        },
        onChange: (shares) => {
          shares.forEach((s, i) => (parts[i].weight = s));
          mixChanged();
          this.scheduleMixPreview();
        },
      });
    }
    let mixChanged: () => void;
    if (this.draft) {
      // New-region mode: the mix is the draft's biome (Create makes it; no Apply).
      mixChanged = () => {
        if (!this.draft) return;
        this.draft.biome = this.mixBiome();
        this.syncCreate();
      };
    } else {
      const actions = panel.createDiv({ cls: "duckmage-action-row" });
      // Plain: Enter region is this surface's one primary.
      const apply = actions.createEl("button", { text: parts.length === 1 ? "Use this biome" : "Apply mix" });
      let want: BiomeId | undefined;
      mixChanged = () => {
        want = this.mixBiome();
        apply.disabled = !want || want === current;
        apply.setAttr("title", !want ? "Pick a biome first" : want === current ? "This is the region's biome now" : `Remake the region from ${biomeRef(want)} (hand-painted hexes stay)`);
      };
      apply.addEventListener("click", () => {
        if (want && want !== current) void this.setBiome(want);
      });
    }
    mixChanged();
    this.drawMixPreview();
  }

  /** The mix as a biome id, its shares stored as small whole weights ("Alpine 2 + Taiga 1"). */
  private mixBiome(): BiomeId | undefined {
    const current = this.draft ? undefined : hexBiomeAt(this.host.plugin, this.overworld, `${this.px}_${this.py}`);
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
    if (this.draft) {
      this.drawDraftPreview();
      return;
    }
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

  // ── new-region mode ─────────────────────────────────────────────────────

  private createBtn: HTMLButtonElement | null = null;
  private createLock: string | undefined;

  /**
   * New-region mode: the draft's name, biome tiles and Mix biomes, Reroll,
   * the settings inline (Blend, Neighbour influence; borders and seed in
   * Debug), a live preview against the made neighbours, then Create.
   */
  private renderNew(fresh: NewRegionMode): void {
    const { plugin } = this.host;
    const { contentEl } = this;
    contentEl.empty();
    const walk = fresh.walk;
    this.titleEl.setText(walk ? `New land to the ${walk.bearing}` : "New region");
    this.modalEl.addClass("duckmage-edit-region-new");
    const ow = plugin.getMap(this.overworld);
    const biomes = paintableBiomes(plugin, this.overworld);
    if (!ow || !biomes.length) {
      contentEl.createEl("p", { cls: "duckmage-map-origin-desc", text: "This overworld's palette has no terrain that stands for a biome, so there's nothing to make the region from." });
      return;
    }
    if (!this.draft) {
      const d = newDraft(plugin, this.overworld, this.px, this.py, walk);
      // The start biome: the hex's (or the one walked from) when it's offered, else the first.
      if (!d.biome || (!isComboId(d.biome) && !biomes.some((b) => b.id === d.biome))) d.biome = (biomes.find((b) => b.terrain) ?? biomes[0]).id;
      this.draft = d;
      this.mix = draftMix(d);
    }
    const draft = this.draft;
    const hex = `${this.px}_${this.py}`;
    const palette = plugin.getMapPalette(this.overworld);

    // ── header: name, where it is ────────────────────────────────────────
    const head = contentEl.createDiv({ cls: "duckmage-edit-region-head" });
    const nameRow = head.createDiv({ cls: "duckmage-region-row" });
    const nameInput = nameRow.createEl("input", {
      type: "text",
      cls: "duckmage-edit-region-name",
      value: draft.name ?? "",
      attr: { "aria-label": "Region name", placeholder: plugin.mapStore.get(this.overworld, hex)?.name?.trim() || "Name (blank: one is picked)" },
    });
    nameInput.addEventListener("input", () => (draft.name = nameInput.value));
    const grows = !!draftGrowth(plugin, this.overworld, this.px, this.py);
    head.createEl("p", {
      cls: "duckmage-map-origin-desc",
      text: walk
        ? `Nothing lies ${walk.bearing} of ${plugin.mapLabel(walk.from)} yet. Pick what's out there; if it's a different biome, the new region is the border country in between.`
          + (grows ? " The overworld grows by a hex to fit it." : "")
        : `Hex ${this.px}, ${this.py} of ${plugin.mapLabel(this.overworld)}. Nothing is made until you press Create.`,
    });

    // ── biome: tiles, Mix biomes, Reroll, settings ──────────────────────
    const biomeSec = contentEl.createDiv({ cls: "duckmage-editor-section duckmage-edit-region-biome" });
    biomeSec.createEl("h4", { text: "Biome" });
    const mixing = this.mix !== null && this.mix !== undefined;
    const toggleRow = biomeSec.createDiv({ cls: "duckmage-edit-region-mix-toggle" });
    const toggle = toggleRow.createEl("button", {
      text: mixing ? "One biome" : "Mix biomes…",
      attr: { title: mixing ? "Go back to one biome" : "Pick more than one biome for this region, with a share each" },
    });
    toggle.addEventListener("click", () => {
      if (mixing) {
        // Back to one biome: the mix's biggest part.
        const top = draft.biome && isComboId(draft.biome) ? dominantPart(draft.biome) : draft.biome;
        draft.biome = top ?? draft.biome;
        this.mix = null;
      } else {
        const one = draft.biome && biomes.some((b) => b.id === draft.biome && b.terrain) ? [{ id: draft.biome, weight: 1 }] : [];
        this.mix = draft.biome && isComboId(draft.biome) ? biomeParts(draft.biome) : one;
      }
      this.renderNew(fresh);
    });
    if (mixing) toggleRow.createSpan({ cls: "setting-item-description", text: "Click biomes to add or remove them; the sliders say how much of each." });
    const offered = mixing ? biomes.filter((b) => b.terrain) : biomes;
    const parts = new Set((this.mix ?? []).map((p) => p.id));
    const grid = renderBiomeTiles(biomeSec, plugin, palette, offered, {
      cls: "duckmage-terrain-picker duckmage-edit-region-biomes",
      isSelected: (id) => (mixing ? parts.has(id) : id === draft.biome),
      title: biomeTileTitle,
      onPick: (b) => {
        if (this.mix) {
          const i = this.mix.findIndex((p) => p.id === b.id);
          if (i >= 0) this.mix.splice(i, 1);
          else this.mix.push({ id: b.id, weight: newPartWeight(this.mix) });
          grid.querySelector<HTMLElement>(`[data-biome="${b.id}"]`)?.toggleClass("is-selected", i < 0);
          this.renderMix(mixPanel, plugin, offered, undefined);
          return;
        }
        draft.biome = b.id;
        this.rolled = "";
        grid.querySelectorAll(".is-selected").forEach((el) => el.removeClass("is-selected"));
        grid.querySelector<HTMLElement>(`[data-biome="${b.id}"]`)?.addClass("is-selected");
        this.syncCreate();
        this.drawDraftPreview();
      },
    });
    const mixPanel = biomeSec.createDiv({ cls: "duckmage-edit-region-mix" });
    window.requestAnimationFrame(() => {
      const sel = grid.querySelector<HTMLElement>(".is-selected");
      if (!sel) return;
      const g = grid.getBoundingClientRect(), r = sel.getBoundingClientRect();
      if (r.bottom > g.bottom || r.top < g.top) grid.scrollTop += r.top - g.top - 4;
    });

    const row = biomeSec.createDiv({ cls: "duckmage-action-row duckmage-edit-region-gen" });
    const seedInput = createEl("input", { type: "number", cls: "duckmage-walk-seed", attr: { "aria-label": "Seed" } });
    seedInput.value = String(draft.seed);
    row.createEl("button", { text: "Reroll", attr: { title: "Same biome, new seed: a new look in the preview (nothing is made yet)" } }).addEventListener("click", () => {
      draft.seed = newDraftSeed();
      seedInput.value = String(draft.seed);
      this.rolled = "";
      this.justRerolled = true;
      this.drawDraftPreview();
    });
    if (walk) {
      row.createEl("button", { text: "Roll biome", attr: { title: "Roll what's out there (a different biome from here, if there is one) with a new seed" } }).addEventListener("click", () => {
        this.rollDraftBiome(biomes, walk);
        this.renderNew(fresh);
      });
    }
    row.createEl("button", { text: "Biomes…", attr: { title: "Add your own biomes, or edit these" } }).addEventListener("click", () => {
      this.close();
      new BiomeLibraryModal(this.app, plugin, this.overworld).open();
    });

    // Blend width with the neighbours (the region settings' Blend width): unset = the biome's own.
    const blendRow = biomeSec.createDiv({ cls: "duckmage-region-gen-row" });
    blendRow.createSpan({ cls: "duckmage-region-gen-label", text: "Blend width" });
    const blendSel = blendRow.createEl("select", { attr: { "aria-label": "Blend width" } });
    blendSel.createEl("option", { text: "Biome's default", value: "" });
    for (const w of BLEND_WIDTHS) blendSel.createEl("option", { text: w[0].toUpperCase() + w.slice(1), value: w });
    blendSel.value = draft.blend ?? "";
    blendSel.addEventListener("change", () => {
      draft.blend = (blendSel.value || undefined) as BlendWidth | undefined;
      this.drawDraftPreview();
    });

    // Neighbour influence: the shared labelled slider (always shows its value).
    const weight = renderNeighbourSlider(biomeSec, draft.neighbourWeight, {
      input: (w) => {
        draft.neighbourWeight = w;
        this.scheduleMixPreview();
      },
    });
    this.place(NEIGHBOUR_ID, weight.el);

    // ── preview ──────────────────────────────────────────────────────────
    const preview = biomeSec.createEl("canvas", {
      cls: "duckmage-edit-region-preview duckmage-edit-region-preview-new",
      attr: { role: "img", "aria-label": "The new region, its made neighbours dimmed" },
    });
    preview.width = 360;
    preview.height = 240;
    this.preview = preview;
    this.draftNote = biomeSec.createEl("p", { cls: "duckmage-map-origin-desc duckmage-edit-region-draft-note" });
    if (mixing) this.renderMix(mixPanel, plugin, offered, undefined);

    // Border wiggle and the seed: Debug (as in Region settings).
    // Unset: the biome's own tuned wiggle.
    const warpDefault = (draft.biome && !isComboId(draft.biome) ? biomeNoteOf(draft.biome)?.tuning?.wiggle : undefined) ?? REGION_WARP;
    const warp = renderLabeledSlider(createDiv(), {
      label: "Wiggly borders",
      help: "How far borders between biomes wander (0: straight seams).",
      min: 0,
      max: 0.6,
      step: 0.05,
      value: draft.warp ?? warpDefault,
      reset: { value: warpDefault },
      onInput: (v) => {
        draft.warp = v === warpDefault ? undefined : v;
        this.scheduleMixPreview();
      },
    });
    this.place("RegionGen.wigglyBorders", warp.el, () => draft.warp !== undefined);
    const seedRow = createDiv({ cls: "duckmage-region-row duckmage-wfc-map-row" });
    seedRow.createSpan({ text: "Seed", cls: "duckmage-map-origin-label" });
    seedRow.appendChild(seedInput);
    seedInput.addEventListener("change", () => {
      const n = Number(seedInput.value);
      if (!Number.isFinite(n)) return;
      draft.seed = Math.trunc(n) >>> 0;
      this.rolled = "";
      this.drawDraftPreview();
    });
    this.place(walk ? "WalkOW.seed" : "RegionGen.seed", seedRow);

    // ── Create / Cancel ──────────────────────────────────────────────────
    this.createLock = draftLock(plugin, this.overworld, walk);
    if (this.createLock) contentEl.createEl("p", { cls: "duckmage-locked-hint", text: this.createLock });
    const createText = walk ? "Create and go" : "Create";
    // The footer helper: Create first and this surface's only primary, then Cancel (writes nothing).
    const create = this.footer({
      primary: { text: createText, title: "Make this region as the preview shows it", onClick: () => void this.create(fresh, createText) },
      cancel: () => this.close(),
      cls: "duckmage-edit-region-create",
    }).primary!;
    this.createBtn = create;
    if (this.createLock) lockButton(create, this.createLock);
    this.syncCreate();
    window.setTimeout(() => { if (!create.disabled) create.focus({ preventScroll: true }); }, 0);
    this.drawDraftPreview();
  }

  /** Create is on while there's a biome and the mode allows it. */
  private syncCreate(): void {
    if (!this.createBtn || this.createLock) return;
    this.createBtn.disabled = !this.draft?.biome;
  }

  /** Walks: roll the biome beyond (never a blank one; this side of the ground: from a cave, more caves). */
  private rollDraftBiome(biomes: PaintableBiome[], walk: NewRegionWalk): void {
    const draft = this.draft;
    if (!draft) return;
    const { plugin } = this.host;
    draft.seed = newDraftSeed();
    const here = startBiome(plugin, this.overworld, this.px, this.py, walk);
    const below = (id: string | undefined) => !!id && groupOfBiome(id) === "underground";
    const hereBelow = below(here && isComboId(here) ? dominantPart(here) : here);
    draft.biome = rollBiome(biomes.filter((b) => b.terrain && (b.group === "underground") === hereBelow).map((b) => b.id), draft.seed, here)
      ?? rollBiome(biomes.filter((b) => b.terrain).map((b) => b.id), draft.seed, here) ?? draft.biome;
    this.mix = null;
    this.rolled = `Rolled ${draft.biome ? biomeInfo(draft.biome)?.label ?? draft.biome : "nothing"} (seed ${draft.seed}).`;
  }

  /** Draw the draft (newRegion.previewDraft) and say what it blends from. */
  private drawDraftPreview(): void {
    const canvas = this.preview;
    const draft = this.draft;
    if (!canvas || !draft) return;
    const { plugin } = this.host;
    const token = ++this.mixToken;
    const fresh = this.fresh;
    if (this.justRerolled) {
      canvas.removeClass("is-new");
      window.requestAnimationFrame(() => canvas.addClass("is-new"));
      this.justRerolled = false;
    }
    if (!draft.biome) {
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      this.draftNote?.setText("Pick a biome.");
      return;
    }
    const biome = draft.biome;
    void previewDraft(plugin, this.overworld, this.px, this.py, { ...draft }).then((plan) => {
      if (token !== this.mixToken) return;
      drawRegionPlan(canvas, plugin, this.overworld, this.px, this.py, plan);
      const labelOf = (id: string) => biomeInfo(id)?.label ?? id;
      const fromIds = new Set((plan?.biome?.from ?? []).filter((b) => b !== biome));
      const walk = fresh?.walk;
      const here = walk ? startBiome(plugin, this.overworld, this.px, this.py, walk) : undefined;
      if (here && here !== biome) fromIds.add(here);
      const from = [...fromIds].map(labelOf);
      this.draftNote?.setText(
        (this.rolled ? `${this.rolled} ` : "")
        + (from.length ? `Border country: ${from.join(" + ")} turning into ${labelOf(biome)}.` : walk ? `${labelOf(biome)} carries on from here.` : ""),
      );
    });
  }

  /** Create: make the region exactly as previewed, then carry on as Edit region (a walk goes there). */
  private async create(fresh: NewRegionMode, idleText: string): Promise<void> {
    const draft = this.draft;
    const btn = this.createBtn;
    if (!draft || !btn || btn.disabled) return;
    btn.disabled = true;
    btn.setText("Creating…");
    const notice = new Notice("Making the region…", 0);
    const res = await createFromDraft(this.host.plugin, this.overworld, this.px, this.py, { ...draft }, fresh.walk);
    notice.hide();
    if ("error" in res) {
      new Notice(res.error);
      btn.disabled = false;
      btn.setText(idleText);
      return;
    }
    this.host.changed();
    if (fresh.walk || fresh.after === "close") {
      this.close();
      fresh.onCreated?.(res.name);
      return;
    }
    fresh.onCreated?.(res.name);
    // Carry on as Edit region for the new (open) region: Reroll, Lock, notes, Enter.
    this.fresh = null;
    this.draft = null;
    this.mix = undefined;
    this.justRerolled = true;
    this.modalEl.removeClass("duckmage-edit-region-new");
    this.render();
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

  private flushWeight(): void {
    if (this.weightTimer !== null) { window.clearTimeout(this.weightTimer); this.weightTimer = null; }
    const run = this.pendingWeight;
    this.pendingWeight = null;
    run?.();
  }

  /** Normal Edit: store the region's neighbour weight and remake it with its seed (undoable). */
  private async applyWeight(name: string, w: number): Promise<void> {
    const { plugin } = this.host;
    const region = plugin.getMap(name);
    if (!region || clampNeighbourWeight(region.neighbourInfluence) === w) return;
    if (!mayReshape(this.host, this.overworld, this.px, this.py)) return;
    await reshapeUndoable(plugin, this.overworld, this.px, this.py, () => regenerateRegion(plugin, name, { neighbourWeight: w }));
    this.host.changed();
    if (this.preview?.isConnected) drawRegionNow(this.preview, plugin, this.overworld, this.px, this.py);
  }

  private async reroll(): Promise<void> {
    if (!(await rerollRegionAt(this.host, this.overworld, this.px, this.py))) return;
    await this.saveNotes();
    this.justRerolled = true;
    this.render();
  }

  onClose(): void {
    if (this.mixTimer !== null) { window.clearTimeout(this.mixTimer); this.mixTimer = null; }
    this.flushWeight();
    void this.saveNotes();
    this.stopKeepInViewport?.();
    this.stopKeepInViewport = null;
    this.contentEl.empty();
  }
}
