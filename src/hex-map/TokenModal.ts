import { App, Notice, Setting, TFile } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { TokenShape, TokenSize } from "../types";
import { normalizeFolder, getIconUrl, iconLabel } from "../utils";

export interface TokenModalResult {
  icon: string | undefined;
  shape: TokenShape;
  size: TokenSize;
  color: string | undefined;
  border: string | undefined;
  description: string | undefined;
}

export class TokenModal extends HexmakerModal {
  private pendingNoteTitle: string;
  private pendingNoteFile: TFile | undefined;
  private pendingIcon: string | undefined;
  private pendingShape: TokenShape;
  private pendingSize: TokenSize;
  private pendingColor: string;
  private pendingBorder: string | undefined;
  private pendingDescription: string | undefined;
  private hasBorder: boolean;

  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    /** undefined = create mode; string path = edit mode */
    private editPath: string | undefined,
    private initialTitle: string,
    initialData: Partial<TokenModalResult>,
    private onSave: (notePath: string, data: TokenModalResult) => void,
    private onDelete?: () => void,
    /** Overrides the create-mode save button label ("Next: place on map").
     *  Used by "Create token here", where the hex is already chosen. */
    private saveLabel?: string,
  ) {
    super(app);
    this.pendingNoteTitle   = initialTitle;
    this.pendingIcon        = initialData.icon;
    this.pendingShape       = initialData.shape ?? "circle";
    this.pendingSize        = initialData.size  ?? "md";
    this.pendingColor       = initialData.color ?? "#4a90e2";
    this.pendingBorder      = initialData.border;
    this.pendingDescription = initialData.description;
    this.hasBorder          = !!initialData.border;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("duckmage-hex-editor");
    // Scoped hook for the fixed-height icon strip + whole-modal scrollbar
    // (short screens scroll the modal instead of squishing the selector).
    this.modalEl.addClass("duckmage-token-modal");
    this.makeDraggable();

    const isEdit = !!this.editPath;

    // ── Title row with inline token preview ───────────────────────────────
    const titleRow = contentEl.createDiv({ cls: "duckmage-token-modal-title-row" });
    titleRow.createEl("h2", { text: isEdit ? "Edit token" : "New token" });
    const tokenPreviewEl = titleRow.createDiv({ cls: "duckmage-token-modal-inline-preview" });

    const refreshPreview = () => {
      tokenPreviewEl.className = `duckmage-token duckmage-token-${this.pendingShape} duckmage-token-size-${this.pendingSize} duckmage-token-modal-inline-preview`;
      tokenPreviewEl.style.setProperty("--token-color", this.pendingColor);
      if (this.pendingBorder) tokenPreviewEl.style.setProperty("--token-border", this.pendingBorder);
      else tokenPreviewEl.style.removeProperty("--token-border");
      tokenPreviewEl.empty();
      if (this.pendingIcon) {
        const img = tokenPreviewEl.createEl("img", { cls: "duckmage-token-icon" });
        img.src = getIconUrl(this.plugin, this.pendingIcon);
        img.alt = "";
      } else {
        const letter = isEdit
          ? this.initialTitle.charAt(0).toUpperCase()
          : (this.pendingNoteTitle.charAt(0).toUpperCase() || "?");
        tokenPreviewEl.createSpan({ cls: "duckmage-token-label", text: letter });
      }
    };
    refreshPreview();

    // Note field (create mode only)
    if (!isEdit) {
      let noteInputEl: HTMLInputElement | undefined;

      new Setting(contentEl)
        .setName("Note")
        .setDesc("Search for an existing note, or type a name to create one.")
        .addText((text) => {
          noteInputEl = text.inputEl;
          text
            .setPlaceholder("Search notes…")
            .setValue(this.pendingNoteTitle)
            .onChange((v) => {
              this.pendingNoteTitle = v.trim();
              this.pendingNoteFile = undefined;
              this.refreshNoteResults(resultsEl, v.trim(), noteInputEl!);
              refreshPreview();
            });
        });

      // Inline results list — rendered in flow below the setting so it stays
      // within the modal's scroll container (never clips outside).
      const resultsEl = contentEl.createDiv({ cls: "duckmage-note-picker-results" });
      resultsEl.hide();

      if (noteInputEl) {
        const el = noteInputEl;

        el.addEventListener("focus", () => {
          this.refreshNoteResults(resultsEl, el.value.trim(), el);
          resultsEl.show();
        });

        el.addEventListener("blur", () => {
          // Delay hide so a mousedown on a result fires before the list vanishes.
          window.setTimeout(() => resultsEl.hide(), 150);
        });
      }
    } else {
      contentEl.createEl("p", {
        text: this.initialTitle,
        cls: "duckmage-token-modal-title",
      });
    }

    // ── Icon palette ──────────────────────────────────────────────────────
    const hidden = new Set(this.plugin.settings.hiddenIcons ?? []);
    const visibleIcons = this.plugin.availableIcons.filter((i) => !hidden.has(i));
    contentEl.createEl("p", { text: "Icon", cls: "duckmage-icon-inline-label" });
    const iconGrid = contentEl.createDiv({ cls: "duckmage-icon-picker duckmage-icon-picker-inline" });
    this.chainWheelToModal(iconGrid);

    const makeIconTile = (icon: string | null) => {
      const label = icon
        ? iconLabel(icon)
        : "no icon";
      const tile = iconGrid.createDiv({
        cls: `duckmage-icon-option${this.pendingIcon === icon ? " is-selected" : ""}`,
      });
      const preview = tile.createDiv({
        cls: `duckmage-icon-preview${!icon ? " duckmage-icon-preview-clear" : ""}`,
      });
      if (icon) {
        const img = preview.createEl("img", { cls: "duckmage-icon-preview-img" });
        img.src = getIconUrl(this.plugin, icon);
        img.alt = label;
      }
      tile.createSpan({ text: label, cls: "duckmage-icon-option-name" });
      tile.dataset["icon"] = icon ?? "";
      tile.addEventListener("click", () => {
        this.pendingIcon = icon ?? undefined;
        iconGrid.querySelectorAll(".duckmage-icon-option").forEach((el) =>
          el.toggleClass("is-selected", (el as HTMLElement).dataset["icon"] === (icon ?? "")),
        );
        refreshPreview();
      });
    };
    makeIconTile(null);
    for (const icon of visibleIcons) makeIconTile(icon);
    this.addIconFilter(iconGrid, this.plugin.vaultIconsSet);

    // ── Shape ─────────────────────────────────────────────────────────────
    new Setting(contentEl)
      .setName("Shape")
      .addDropdown((dd) => {
        dd.addOption("circle", "Circle");
        dd.addOption("square", "Square");
        dd.setValue(this.pendingShape === "hexagon" ? "circle" : this.pendingShape);
        dd.onChange((v) => { this.pendingShape = v as TokenShape; refreshPreview(); });
      });

    // ── Size — horizontal radio group ─────────────────────────────────────
    const sizeSetting = new Setting(contentEl).setName("Size");
    const sizeGroup = sizeSetting.controlEl.createDiv({ cls: "duckmage-token-size-group" });
    for (const { value, label } of [
      { value: "sm" as TokenSize, label: "Small" },
      { value: "md" as TokenSize, label: "Medium" },
      { value: "lg" as TokenSize, label: "Large" },
    ]) {
      const opt = sizeGroup.createEl("label", { cls: "duckmage-token-size-option" });
      const radio = opt.createEl("input");
      radio.type  = "radio";
      radio.name  = "duckmage-token-size";
      radio.value = value;
      radio.checked = this.pendingSize === value;
      radio.addEventListener("change", () => { if (radio.checked) { this.pendingSize = value; refreshPreview(); } });
      opt.createSpan({ text: label });
    }

    // ── Fill color (always active) ────────────────────────────────────────
    const colorSetting = new Setting(contentEl)
      .setName("Fill color")
      .setDesc("Background color behind the icon.")
      .addColorPicker((p) => {
        p.setValue(this.pendingColor).onChange((v) => {
          this.pendingColor = v;
          refreshPreview();
        });
      });
    colorSetting.controlEl.querySelector<HTMLInputElement>('input[type="color"]')
      ?.addEventListener("input", (e) => {
        const v = (e.target as HTMLInputElement).value;
        this.pendingColor = v;
        tokenPreviewEl.style.setProperty("--token-color", v);
      });

    // ── Border color ──────────────────────────────────────────────────────
    let borderPicker: import("obsidian").ColorComponent | undefined;
    let lastBorder = this.pendingBorder ?? "#ffffff";
    const borderSetting = new Setting(contentEl)
      .setName("Border color")
      .setDesc("Ring color around the token.")
      .addToggle((t) => {
        t.setValue(this.hasBorder).onChange((on) => {
          this.hasBorder = on;
          this.pendingBorder = on ? lastBorder : undefined;
          borderPicker?.setDisabled(!on);
          refreshPreview();
        });
      })
      .addColorPicker((p) => {
        borderPicker = p;
        p.setValue(lastBorder)
          .setDisabled(!this.hasBorder)
          .onChange((v) => {
            lastBorder = v;
            if (this.hasBorder) { this.pendingBorder = v; refreshPreview(); }
          });
      });
    borderSetting.controlEl.querySelector<HTMLInputElement>('input[type="color"]')
      ?.addEventListener("input", (e) => {
        const v = (e.target as HTMLInputElement).value;
        lastBorder = v;
        if (this.hasBorder) {
          this.pendingBorder = v;
          tokenPreviewEl.style.setProperty("--token-border", v);
        }
      });

    // Description
    new Setting(contentEl)
      .setName("Description")
      .setDesc("Saved to the note's frontmatter.")
      .addTextArea((ta) => {
        ta.setValue(this.pendingDescription ?? "")
          .onChange((v) => { this.pendingDescription = v.trim() || undefined; });
        ta.inputEl.rows = 3;
        ta.inputEl.addClass("duckmage-token-desc-textarea");
      });

    // Buttons
    const btnRow = contentEl.createDiv({ cls: "duckmage-token-modal-buttons" });

    if (isEdit && this.onDelete) {
      btnRow.createEl("button", { text: "Remove token", cls: "mod-warning" })
        .addEventListener("click", () => {
          this.close();
          this.onDelete!();
        });
    }

    btnRow.createEl("button", {
      text: isEdit ? "Save" : this.saveLabel ?? "Next: place on map",
      cls: "mod-cta",
    }).addEventListener("click", () => {
      if (!isEdit && !this.pendingNoteTitle) {
        new Notice("Please enter a note name.");
        return;
      }
      void (async () => {
        let notePath: string | null;
        if (isEdit) {
          notePath = this.editPath!;
        } else {
          const resolved = this.pendingNoteFile
            ? this.pendingNoteFile.path
            : await this.resolveOrCreateNote(this.pendingNoteTitle);
          if (!resolved) return;
          notePath = await this.maybeCreateProxy(resolved);
        }
        if (!notePath) return;
        this.close();
        this.onSave(notePath, {
          icon:        this.pendingIcon,
          shape:       this.pendingShape,
          size:        this.pendingSize,
          color:       this.pendingColor,
          border:      this.pendingBorder,
          description: this.pendingDescription,
        });
      })();
    });

    btnRow.createEl("button", { text: "Cancel" })
      .addEventListener("click", () => this.close());
  }

  private getNoteMatches(query: string): TFile[] {
    const s = this.plugin.settings;
    const folders = [
      s.worldFolder,
      s.townsFolder,
      s.dungeonsFolder,
      s.featuresFolder,
      s.questsFolder,
      s.factionsFolder,
      s.regionsFolder,
    ]
      .map(normalizeFolder)
      .filter(Boolean);

    const q = query.toLowerCase();
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => {
        if (f.basename.startsWith("_")) return false;
        if (folders.length > 0 && !folders.some((folder) => f.path.startsWith(folder + "/"))) return false;
        return !q || f.path.toLowerCase().contains(q);
      })
      .sort((a, b) => a.basename.localeCompare(b.basename))
      .slice(0, 50);
  }

  private refreshNoteResults(
    container: HTMLElement,
    query: string,
    inputEl: HTMLInputElement,
  ): void {
    container.empty();
    const files = this.getNoteMatches(query);
    if (files.length === 0) {
      container.createDiv({ cls: "duckmage-note-picker-empty", text: "No matching notes" });
      return;
    }
    for (const file of files) {
      const row = container.createDiv({ cls: "duckmage-note-picker-item" });
      row.createSpan({ text: file.basename });
      row.createEl("small", { text: file.path, cls: "duckmage-suggestion-path" });
      row.addEventListener("mousedown", (e) => {
        e.preventDefault(); // keep focus on input until selection committed
        this.pendingNoteTitle = file.basename;
        this.pendingNoteFile  = file;
        inputEl.value         = file.basename;
        container.hide();
      });
    }
  }

  private async maybeCreateProxy(originalPath: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(originalPath);
    if (!(file instanceof TFile)) return originalPath;
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache?.frontmatter?.["token"]) return originalPath;

    // The target note already has a token — create a numbered proxy note.
    const world  = normalizeFolder(this.plugin.settings.worldFolder) || "world";
    const folder = `${world}/tokens`;
    const base   = file.basename;
    let n = 2;
    while (this.app.vault.getAbstractFileByPath(`${folder}/${base}-${n}.md`)) n++;
    const proxyPath = `${folder}/${base}-${n}.md`;
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      try { await this.app.vault.createFolder(folder); } catch { /* race */ }
    }
    await this.app.vault.create(proxyPath, `---\ntoken-link: ${originalPath}\n---\n# ${base}-${n}\n`);
    return proxyPath;
  }

  private async resolveOrCreateNote(title: string): Promise<string | null> {
    // 1. Exact path match
    const byPath = this.app.vault.getAbstractFileByPath(title);
    if (byPath instanceof TFile) return byPath.path;

    // 2. Basename match (case-insensitive)
    const match = this.app.vault.getMarkdownFiles()
      .find((f) => f.basename.toLowerCase() === title.toLowerCase());
    if (match) return match.path;

    // 3. Create new note in worldFolder/tokens/
    const world = normalizeFolder(this.plugin.settings.worldFolder) || "world";
    const folder = `${world}/tokens`;
    const path   = `${folder}/${title}.md`;
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      try { await this.app.vault.createFolder(folder); } catch { /* race */ }
    }
    if (!this.app.vault.getAbstractFileByPath(path)) {
      await this.app.vault.create(path, `# ${title}\n`);
    }
    return path;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
