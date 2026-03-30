import { App, TFile } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import { setSectionContent } from "../sections";
import { getTerrainFromFile } from "../frontmatter";
import { normalizeFolder } from "../utils";
import type HexmakerPlugin from "../HexmakerPlugin";
import { RandomTableModal } from "../random-tables/RandomTableModal";

export class HexCellModal extends HexmakerModal {
  private textarea: HTMLTextAreaElement | null = null;

  constructor(
    app: App,
    private title: string,
    private body: string,
    private isLink: boolean,
    private filePath?: string,
    private sectionKey?: string,
    private plugin?: HexmakerPlugin,
    private onSave?: (newContent: string) => void,
    private beforeSave?: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.titleEl.setText(this.title);
    const { contentEl } = this;
    contentEl.addClass("duckmage-cell-modal");

    if (this.isLink) {
      const list = contentEl.createEl("ul", { cls: "duckmage-cell-modal-list" });
      for (const item of this.body.split(", ")) {
        list.createEl("li", { text: item });
      }
    } else {
      this.textarea = contentEl.createEl("textarea", {
        cls: "duckmage-cell-modal-textarea",
      });
      this.textarea.value = this.body;

      const rollTableFile = this.plugin ? this.getRollTableFile() : null;
      if (rollTableFile) {
        const btnRow = contentEl.createDiv({ cls: "duckmage-cell-modal-btn-row" });
        const rollBtn = btnRow.createEl("button", {
          text: "🎲 roll on table",
          cls: "duckmage-cell-modal-roll-btn",
        });
        rollBtn.addEventListener("click", () => {
          new RandomTableModal(this.app, this.plugin!, (result) => {
            if (this.textarea!.value && !this.textarea!.value.endsWith("\n"))
              this.textarea!.value += "\n";
            this.textarea!.value += result;
          }, rollTableFile.path).open();
        });
      }
    }
  }

  private async doSave(): Promise<void> {
    if (!this.textarea || !this.filePath || !this.sectionKey) return;
    const newContent = this.textarea.value;
    await this.beforeSave?.();
    await setSectionContent(this.app, this.filePath, this.sectionKey, newContent);
    this.onSave?.(newContent.trim());
  }

  onClose(): void {
    void this.doSave();
    this.contentEl.empty();
    this.textarea = null;
  }

  private getRollTableFile(): TFile | null {
    if (!this.plugin || !this.filePath || !this.sectionKey) return null;
    const tablesFolder = normalizeFolder(this.plugin.settings.tablesFolder ?? "");
    let tablePath: string;
    if (this.sectionKey === "description") {
      const terrain = getTerrainFromFile(this.app, this.filePath);
      if (!terrain) return null;
      tablePath = tablesFolder
        ? `${tablesFolder}/terrain/description/${terrain}.md`
        : `terrain/description/${terrain}.md`;
    } else if (
      this.sectionKey === "landmark" ||
      this.sectionKey === "hidden" ||
      this.sectionKey === "secret"
    ) {
      tablePath = tablesFolder
        ? `${tablesFolder}/${this.sectionKey}.md`
        : `${this.sectionKey}.md`;
    } else {
      return null;
    }
    const file = this.app.vault.getAbstractFileByPath(tablePath);
    return file instanceof TFile ? file : null;
  }

}
