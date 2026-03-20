import { App, TFile } from "obsidian";
import { DuckmageModal } from "../DuckmageModal";
import { setSectionContent } from "../sections";
import { getTerrainFromFile } from "../frontmatter";
import { normalizeFolder } from "../utils";
import type DuckmagePlugin from "../DuckmagePlugin";
import { RandomTableModal } from "../random-tables/RandomTableModal";

export class HexCellModal extends DuckmageModal {
  constructor(
    app: App,
    private title: string,
    private body: string,
    private isLink: boolean,
    private filePath?: string,
    private sectionKey?: string,
    private plugin?: DuckmagePlugin,
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
      const list = contentEl.createEl("ul", {
        cls: "duckmage-cell-modal-list",
      });
      for (const item of this.body.split(", ")) {
        list.createEl("li", { text: item });
      }
    } else {
      const textarea = contentEl.createEl("textarea", {
        cls: "duckmage-cell-modal-textarea",
      });
      textarea.value = this.body;

      const btnRow = contentEl.createDiv({ cls: "duckmage-cell-modal-btn-row" });

      const rollTableFile = this.plugin ? this.getRollTableFile() : null;
      if (rollTableFile) {
        const rollBtn = btnRow.createEl("button", {
          text: "🎲 Roll on table",
          cls: "duckmage-cell-modal-roll-btn",
        });
        rollBtn.addEventListener("click", () => {
          new RandomTableModal(this.app, this.plugin!, (result) => {
            if (textarea.value && !textarea.value.endsWith("\n"))
              textarea.value += "\n";
            textarea.value += result;
          }, rollTableFile.path).open();
        });
      }

      const saveBtn = btnRow.createEl("button", {
        text: "Save",
        cls: "duckmage-cell-modal-save mod-cta",
      });
      saveBtn.addEventListener("click", async () => {
        const newContent = textarea.value;
        if (this.filePath && this.sectionKey) {
          await this.beforeSave?.();
          await setSectionContent(
            this.app,
            this.filePath,
            this.sectionKey,
            newContent,
          );
          this.onSave?.(newContent.trim());
        }
        this.close();
      });
    }
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

  onClose(): void {
    this.contentEl.empty();
  }
}
