/**
 * The Biomes list and the New biome form (#50).
 *
 * - BiomeLibraryModal: every biome note (swatch, name, what makes its
 *   regions) with Edit… (opens the biome page, THE biome editor: owner
 *   Q14, 2026-10-13) and, for a biome made by a generator, Edit
 *   generator…; and New biome…. Opened from the overworld's Biomes view
 *   and the biome picker.
 * - NewBiomeModal: only the basics (name, colour, a biome to start from or
 *   nothing), then it writes the note and opens the biome page, where
 *   everything else is edited (and autosaved).
 *
 * Adding and editing biomes follows the overworld's work mode: Build and
 * God (canAdd), not Play.
 */

import { App, Notice, TFile } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import { canAdd } from "../workMode";
import type { BiomeNoteFields } from "./biomeNote";
import { biomeGroupOf, groupBiomes } from "./biomeGroups";
import { biomeNameProblem, generatorName, routeNote } from "./biomeForm";
import { lockButton } from "./BiomeModals";

/** Why biomes can't be added or edited from this overworld now, or undefined. */
export function biomeEditLock(plugin: HexmakerPlugin, overworldName: string): string | undefined {
  return canAdd(plugin.getMap(overworldName)) ? undefined : "Switch to Build to add or edit biomes.";
}

/** Whether the generator page can open a biome (`openTerrainGenerator({ biome })`). */
const GENERATOR_PAGE_TAKES_BIOMES = true;

/**
 * "Edit generator…" for a biome, in one place: a biome with a generator
 * link opens that generator; otherwise the generator page opens the biome
 * when it can, else the biome's note opens.
 */
export async function openBiomeGenerator(plugin: HexmakerPlugin, biome: string): Promise<void> {
  const b = plugin.biomeStore.get(biome);
  if (!b) { new Notice(`No biome called ${biome}.`); return; }
  if (b.generator) {
    const file = plugin.app.metadataCache.getFirstLinkpathDest(b.generator, "");
    if (file) { await plugin.openTerrainGenerator({ generatorPath: file.path }); return; }
    new Notice(`Generator ${generatorName(b.generator)} wasn't found; opening the biome's note.`);
  } else if (GENERATOR_PAGE_TAKES_BIOMES) {
    await plugin.openTerrainGenerator({ biome: b.id });
    return;
  }
  const path = plugin.biomeStore.pathOf(b.id);
  const file = path ? plugin.app.vault.getAbstractFileByPath(path) : null;
  if (file instanceof TFile) await plugin.app.workspace.getLeaf("tab").openFile(file);
}

export class BiomeLibraryModal extends HexmakerModal {
  private off: (() => void) | undefined;

  constructor(app: App, private plugin: HexmakerPlugin, private overworldName: string) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.modalEl.addClass("duckmage-biome-library-modal");
    this.titleEl.setText("Biomes");
    this.off = this.plugin.biomeStore.onChange(() => this.render());
    this.render();
  }

  private render(): void {
    const { contentEl, plugin } = this;
    contentEl.empty();
    const lock = biomeEditLock(plugin, this.overworldName);
    contentEl.createEl("p", { cls: "setting-item-description", text: `Each biome is a note in ${plugin.biomeStore.folder()}. Edit it here or as text.` });
    if (lock) contentEl.createEl("p", { cls: "duckmage-locked-hint", text: lock });
    const list = contentEl.createDiv({ cls: "duckmage-biome-list" });
    // Grouped like the pickers (Surface, Mountains, Water, Underground, Blank).
    const groups = groupBiomes(plugin.biomeStore.list(), biomeGroupOf);
    for (const b of groups.flatMap((g) => g.items)) {
      const g = groups.find((x) => x.items[0] === b);
      if (g && groups.length > 1) list.createDiv({ cls: "duckmage-biome-group-head", text: g.label });
      const row = list.createDiv({ cls: "duckmage-biome-row" });
      row.createSpan({ cls: "duckmage-biome-swatch" }).setCssProps({ "--duckmage-biome-color": b.color ?? "" });
      const text = row.createDiv({ cls: "duckmage-biome-row-text" });
      text.createSpan({ cls: "duckmage-biome-row-name", text: b.label });
      text.createSpan({ cls: "duckmage-biome-row-note", text: routeNote(b) ?? "Blend (built-in mixing)" });
      // Edit… opens the biome page, the one biome editor (it autosaves).
      const edit = row.createEl("button", { text: "Edit…" });
      if (lock) lockButton(edit, lock);
      edit.addEventListener("click", () => {
        if (biomeEditLock(plugin, this.overworldName)) return;
        this.close();
        void plugin.openTerrainGenerator({ biome: b.id });
      });
      if (b.generator) {
        row.createEl("button", { text: "Edit generator…" }).addEventListener("click", () => {
          this.close();
          void openBiomeGenerator(plugin, b.id);
        });
      }
    }
    const add = this.footer({
      primary: { text: "New biome…", onClick: () => {
        if (biomeEditLock(plugin, this.overworldName)) return;
        new NewBiomeModal(this.app, plugin, this.overworldName, () => this.close()).open();
      } },
    }).primary!;
    if (lock) lockButton(add, lock);
  }

  onClose(): void {
    this.off?.();
    this.contentEl.empty();
  }
}


/** "Nothing": a new biome with an empty mix (set it on the biome page). */
const START_EMPTY = "";

/**
 * The fields of a new biome: a copy of `from` (its mix, tuning, climate…;
 * not its id, name or colour; `parent` says where it came from), or an
 * empty one. Pure.
 */
export function newBiomeFields(label: string, color: string, from?: BiomeNoteFields): Omit<BiomeNoteFields, "id"> {
  if (!from) return { label: label.trim(), color, mix: [], transitions: [] };
  const copy = structuredClone(from) as Partial<BiomeNoteFields>;
  delete copy.id;
  return { ...(copy as Omit<BiomeNoteFields, "id">), label: label.trim(), color, parent: from.label };
}

/**
 * New biome: the basics only (owner Q14). Name, colour and what to start
 * from; Create and open writes the note and opens the biome page.
 */
export class NewBiomeModal extends HexmakerModal {
  protected surfaceId = "NewBiome";

  constructor(app: App, private plugin: HexmakerPlugin, private overworldName: string, private onCreated: () => void = () => {}) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.modalEl.addClass("duckmage-biome-form-modal");
    this.titleEl.setText("New biome");
    const { contentEl, plugin } = this;
    const form = contentEl.createDiv({ cls: "duckmage-region-gen-form" });
    const field = (label: string) => {
      const row = form.createDiv({ cls: "duckmage-region-gen-row" });
      row.createSpan({ cls: "duckmage-region-gen-label", text: label });
      return row;
    };
    const name = field("Name").createEl("input", { type: "text", attr: { "aria-label": "Name", placeholder: "Glass wastes" } });
    const colour = field("Colour").createEl("input", { type: "color", attr: { "aria-label": "Colour" } });
    colour.value = "#7a9a5a";
    const from = field("Start from").createEl("select", { attr: { "aria-label": "Start from" } });
    from.createEl("option", { text: "Nothing (set its mix next)", value: START_EMPTY });
    const groups = groupBiomes(plugin.biomeStore.list(), biomeGroupOf);
    for (const g of groups) {
      const parent = groups.length > 1 ? from.createEl("optgroup", { attr: { label: g.label } }) : from;
      for (const b of g.items) parent.createEl("option", { text: b.label, value: b.id });
    }
    from.addEventListener("change", () => {
      const b = plugin.biomeStore.get(from.value);
      if (b?.color && /^#[0-9a-f]{6}$/i.test(b.color)) colour.value = b.color;
    });
    form.createEl("p", { cls: "setting-item-description", text: "Then its page opens to set its mix, climate and the rest. It saves as you go." });
    const problem = contentEl.createEl("p", { cls: "duckmage-locked-hint" });
    const check = () => {
      const p = biomeNameProblem(name.value, plugin.biomeStore.list());
      problem.setText(name.value.trim() ? (p ?? "") : "");
      if (!create.hasClass("is-locked")) create.disabled = !!p;
      return p;
    };
    const go = async () => {
      if (biomeEditLock(plugin, this.overworldName) || check()) return;
      const start = from.value === START_EMPTY ? undefined : plugin.biomeStore.get(from.value);
      const res = await plugin.biomeStore.create(newBiomeFields(name.value, colour.value.toLowerCase(), start));
      if ("error" in res) { new Notice(res.error); return; }
      this.close();
      this.onCreated();
      await plugin.openTerrainGenerator({ biome: res.id });
    };
    const create = this.footer({ primary: { text: "Create and open", onClick: () => void go() }, cancel: () => this.close() }).primary!;
    const lock = biomeEditLock(plugin, this.overworldName);
    if (lock) lockButton(create, lock);
    name.addEventListener("input", check);
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") void go(); });
    check();
    name.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
