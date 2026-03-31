import { App, Notice, TFile } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { HexmakerModal } from "../HexmakerModal";
import { normalizeFolder } from "../utils";
import { addLinkToSection, addBacklinkToFile } from "../sections";
import type { LinkSection } from "../types";

export class LinkPickerModal extends HexmakerModal {
  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private hexPath: string,
    private section: LinkSection,
    private sourceFolder: string,
    private onLinked: () => void,
    private createTemplate = "",
  ) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    const { contentEl } = this;
    this.titleEl.setText(`Add ${this.section}`);
    contentEl.addClass("duckmage-link-picker-modal");

    const normalized = normalizeFolder(this.sourceFolder);
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => !normalized || f.path.startsWith(normalized + "/"))
      .filter((f) => !f.basename.startsWith("_"))
      .sort((a, b) => a.basename.localeCompare(b.basename));

    if (files.length > 0) {
      contentEl.createEl("p", {
        text: "Select existing:",
        cls: "duckmage-link-picker-heading",
      });
      const list = contentEl.createEl("ul", {
        cls: "duckmage-link-picker-list",
      });
      for (const file of files) {
        const li = list.createEl("li", { cls: "duckmage-link-picker-item" });
        li.setText(file.basename);
        li.addEventListener("click", () => { void this.addLink(file); });
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
    input.placeholder = `${this.section.slice(0, -1)} name…`;
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

  private async addLink(file: TFile): Promise<void> {
    await this.ensureHexNote();
    const linkText = `[[${this.app.metadataCache.fileToLinktext(file, this.hexPath)}]]`;
    await addLinkToSection(this.app, this.hexPath, this.section, linkText);
    await addBacklinkToFile(this.app, file.path, this.hexPath);
    this.onLinked();
    this.close();
  }

  private async createAndLink(name: string): Promise<void> {
    if (!name) return;
    const folder = normalizeFolder(this.sourceFolder);
    const newPath = folder ? `${folder}/${name}.md` : `${name}.md`;
    let file = this.app.vault.getAbstractFileByPath(newPath);
    if (!(file instanceof TFile)) {
      try {
        if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
          await this.app.vault.createFolder(folder);
        }
        file = await this.app.vault.create(newPath, this.createTemplate);
      } catch (err) {
        new Notice(`Could not create ${newPath}: ${String(err)}`);
        return;
      }
    }
    if (!(file instanceof TFile)) return;
    await this.addLink(file);
  }

  private async ensureHexNote(): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(this.hexPath);
    if (existing instanceof TFile) return;
    const folder = this.hexPath.includes("/")
      ? this.hexPath.slice(0, this.hexPath.lastIndexOf("/"))
      : "";
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder);
    }
    await this.app.vault.create(this.hexPath, "");
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
