import { App, TFile } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { HexmakerModal } from "../HexmakerModal";
import { Fold } from "../ui/disclosure";
import { normalizeFolder } from "../utils";
import type { LinkSection } from "../types";
import { groupTableFiles } from "../random-tables/tablePickerGroups";
import { MAP_MADE_GROUP_LABEL } from "../random-tables/resolve";

/** The hex a picker links into. */
export interface PickerHex {
  x: number;
  y: number;
  mapName: string;
}

export class LinkPickerModal extends HexmakerModal {
  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private hex: PickerHex,
    private linkSection: LinkSection,
    private sourceFolder: string,
    private onLinked: () => void,
    private createTemplate = "",
  ) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    const { contentEl } = this;
    this.titleEl.setText(`Add ${this.linkSection}`);
    contentEl.addClass("duckmage-link-picker-modal");

    const normalized = normalizeFolder(this.sourceFolder);
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => !normalized || f.path.startsWith(normalized + "/"))
      .filter((f) => this.plugin.isLinkableNote(f))
      .sort((a, b) => a.basename.localeCompare(b.basename));

    // Tables: the user's own first; the terrain and region tables the map
    // made sit in a collapsed "Made by the map" group after them.
    const { own, mapMade } = this.linkSection === "Encounters Table"
      ? groupTableFiles(this.app, files)
      : { own: files, mapMade: [] as TFile[] };
    const addItems = (list: HTMLElement, items: TFile[]) => {
      for (const file of items) {
        const li = list.createEl("li", { cls: "duckmage-link-picker-item" });
        li.setText(file.basename);
        li.addEventListener("click", () => { void this.addLink(file); });
      }
    };
    if (files.length > 0) {
      contentEl.createEl("p", {
        text: "Select existing:",
        cls: "duckmage-link-picker-heading",
      });
      if (own.length) addItems(contentEl.createEl("ul", { cls: "duckmage-link-picker-list" }), own);
      if (mapMade.length) {
        const group = new Fold(contentEl, {
          title: `${MAP_MADE_GROUP_LABEL} (${mapMade.length})`,
          key: MAP_MADE_GROUP_LABEL,
          open: false,
          store: this.app,
          surface: "LinkPicker",
          cls: "duckmage-link-picker-map-made",
        });
        addItems(group.body.createEl("ul", { cls: "duckmage-link-picker-list" }), mapMade);
      }
    }

    contentEl.createEl("p", {
      text: "Or create new:",
      cls: "duckmage-link-picker-heading",
    });
    const row = contentEl.createDiv({ cls: "duckmage-link-picker-create-row" });
    const input = row.createEl("input", {
      type: "text",
      cls: "duckmage-link-picker-input",
    });
    input.placeholder = `${this.linkSection.slice(0, -1)} name…`;
    const createBtn = row.createEl("button", {
      text: "Create",
      cls: "mod-cta",
    });
    createBtn.addEventListener(
      "click",
      () => void this.createAndLink(input.value.trim()),
    );
    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") void this.createAndLink(input.value.trim());
    });
  }

  /** Link a note into the hex (its note made from the template first if it has none: HexNotesService). */
  private async addLink(file: TFile): Promise<void> {
    const { x, y, mapName } = this.hex;
    if ((await this.plugin.hexNotes.linkNoteToHex(file, x, y, mapName, this.linkSection)) === null) return;
    this.onLinked();
    this.close();
  }

  /** Make the note (from `createTemplate`, else the section's template) and link it. */
  private async createAndLink(name: string): Promise<void> {
    if (!name) return;
    const { x, y, mapName } = this.hex;
    const linked = await this.plugin.hexNotes.createAndLinkNote({
      x, y, mapName, section: this.linkSection, folder: this.sourceFolder, name, template: this.createTemplate,
    });
    if (linked === null) return;
    this.onLinked();
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
