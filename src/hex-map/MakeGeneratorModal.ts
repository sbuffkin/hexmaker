/**
 * "Make generator from this region…" (PR1): new generator (a name) or
 * overwrite an existing one, picked from a list with the most fitting
 * first (the region's own biome's generator, its parent biomes', ones
 * learned from this region, related biomes'). Opened from Edit region and
 * from a map's right-click menu in the Maps window. See
 * src/worldgen/regionGenerator.ts.
 */

import { App, Notice } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import { makeRegionGenerator, overwriteTargets, type OverwriteCandidate } from "../worldgen/regionGenerator";
import { hasFeature } from "../featureLevel";
import { withFeature } from "../advancedHints";
import { slugify } from "../utils";

/** Open the dialog (an Advanced feature: in Simple, offers to turn Generators on first). */
export function openMakeGenerator(app: App, plugin: HexmakerPlugin, mapName: string): void {
  if (!hasFeature(plugin.settings, "generators")) {
    withFeature(plugin, "generators", () => openMakeGenerator(app, plugin, mapName));
    return;
  }
  new MakeGeneratorModal(app, plugin, mapName).open();
}

export class MakeGeneratorModal extends HexmakerModal {
  private mode: "new" | "overwrite" = "new";
  private name = "";
  private picked: string | null = null;

  constructor(app: App, private plugin: HexmakerPlugin, private mapName: string) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.modalEl.addClass("duckmage-make-generator-modal");
    this.titleEl.setText(`Make generator from ${this.plugin.mapLabel(this.mapName)}`);
    this.name = this.plugin.mapLabel(this.mapName);
    void this.render();
  }

  private async render(): Promise<void> {
    const { contentEl, plugin } = this;
    contentEl.empty();
    const { candidates, biome } = await overwriteTargets(plugin, this.mapName);
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: `Learns how this map's terrain fits together.` +
        (biome ? ` A new generator gets its own biome that starts as a copy of ${biome.label} (climate, islands, transitions, shore, mix).` : ""),
    });

    const choice = contentEl.createDiv({ cls: "duckmage-make-generator-choice" });
    const radio = (value: "new" | "overwrite", label: string): HTMLInputElement => {
      const row = choice.createEl("label", { cls: "duckmage-make-generator-option" });
      const input = row.createEl("input", { type: "radio", attr: { name: "duckmage-make-generator", value } });
      input.checked = this.mode === value;
      row.createSpan({ text: label });
      input.addEventListener("change", () => {
        if (!input.checked) return;
        this.mode = value;
        void this.render();
      });
      return input;
    };

    radio("new", "New generator");
    if (this.mode === "new") {
      const nameInput = choice.createEl("input", {
        type: "text",
        cls: "duckmage-make-generator-name",
        value: this.name,
        attr: { "aria-label": "Generator name", placeholder: "Name" },
      });
      nameInput.addEventListener("input", () => { this.name = nameInput.value; });
      window.setTimeout(() => nameInput.focus(), 0);
    }

    const over = radio("overwrite", "Overwrite existing");
    over.disabled = !candidates.length;
    if (!candidates.length) choice.createEl("p", { cls: "setting-item-description", text: "No generators yet." });
    if (this.mode === "overwrite" && candidates.length) {
      if (!this.picked || !candidates.some((c) => c.path === this.picked)) this.picked = candidates[0].path;
      this.renderList(choice, candidates);
      choice.createEl("p", { cls: "setting-item-description", text: "The old generator is backed up first. Biomes that use it keep using it." });
    }

    const buttons = contentEl.createDiv({ cls: "duckmage-token-modal-buttons" });
    const go = buttons.createEl("button", { text: this.mode === "new" ? "Make generator" : "Overwrite", cls: this.mode === "new" ? "mod-cta" : "mod-warning" });
    go.addEventListener("click", () => void this.make(go));
    buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
  }

  private renderList(el: HTMLElement, candidates: OverwriteCandidate[]): void {
    const list = el.createDiv({ cls: "duckmage-make-generator-list", attr: { role: "listbox", "aria-label": "Generator to overwrite" } });
    for (const c of candidates) {
      const row = list.createDiv({
        cls: "duckmage-make-generator-row" + (c.path === this.picked ? " is-selected" : "") + (c.reason !== "other" ? " is-suggested" : ""),
        attr: { role: "option", tabindex: "0", "aria-selected": String(c.path === this.picked), title: c.path },
      });
      row.createSpan({ cls: "duckmage-make-generator-row-name", text: c.name });
      if (c.why) row.createSpan({ cls: "duckmage-make-generator-row-why", text: c.why });
      const pick = () => {
        this.picked = c.path;
        for (const r of Array.from(list.children)) {
          r.removeClass("is-selected");
          r.setAttr("aria-selected", "false");
        }
        row.addClass("is-selected");
        row.setAttr("aria-selected", "true");
      };
      row.addEventListener("click", pick);
      row.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
      });
    }
  }

  private async make(btn: HTMLButtonElement): Promise<void> {
    const { plugin } = this;
    if (this.mode === "new" && !slugify(this.name)) {
      new Notice("Enter a generator name.");
      return;
    }
    if (this.mode === "overwrite" && !this.picked) return;
    btn.disabled = true;
    const res = await makeRegionGenerator(plugin, this.mapName, this.mode === "new" ? { kind: "new", name: this.name } : { kind: "overwrite", path: this.picked! });
    if ("error" in res) {
      new Notice(res.error);
      btn.disabled = false;
      return;
    }
    const parts = [`${this.mode === "new" ? "Made" : "Overwrote"} generator "${res.file.basename}" from ${plugin.mapLabel(this.mapName)}`];
    if (res.backup) parts.push(`the old one is in ${res.backup}`);
    if (res.biome) parts.push(`new biome "${res.biome}" uses it`);
    new Notice(parts.join("; ") + ".", 8000);
    this.close();
    await plugin.openTerrainGenerator({ mapName: this.mapName, generatorPath: res.file.path, paletteName: plugin.getMap(this.mapName)?.paletteName });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
