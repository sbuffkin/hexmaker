import { App, Notice, Setting, TFile } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import { renderSaveStatusLine } from "../ui/saveStatusLine";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { HexmakerPluginSettings } from "../types";
import { normalizeFolder } from "../utils";
import type { OverlayStyle } from "../frontmatter";
import { addOverlayPatternControls, renderHexPreview } from "./overlayPatternControls";
import { addPickerFilter, emptyState, filterText } from "../ui/pickers";

/**
 * A kind of painted area note (factions, areas): where its notes live, the
 * words the picker uses, and the frontmatter functions for its colour and
 * overlay style (frontmatter.ts).
 */
export interface AreaNoteKind {
  /** The picker's title. */
  title: string;
  /** The configured folder for this kind of note. */
  folder(settings: HexmakerPluginSettings): string;
  noFolderText: string;
  noNotesText(folder: string): string;
  /** Tooltip on a tile's edit button. */
  editTitle: string;
  /** What the picker filter calls the notes ("factions"). */
  filterThings: string;
  newPlaceholder: string;
  existsText(name: string): string;
  getColor(app: App, path: string): string | null;
  setColor(app: App, path: string, color: string | null): Promise<boolean>;
  getStyle(app: App, path: string): OverlayStyle;
  setStyle(app: App, path: string, style: Partial<OverlayStyle>): Promise<boolean>;
  /** After a new note is written (before its editor opens). */
  afterCreate?(plugin: HexmakerPlugin, name: string): void;
}

// ── Area note editor sub-modal ───────────────────────────────────────────────

class AreaNoteEditorModal extends HexmakerModal {
  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private kind: AreaNoteKind,
    private file: TFile,
    private initialColor: string | null,
    /**
     * Called on save with the (possibly updated) color, basename, and full
     * overlay style. We pass the style directly because the metadata cache
     * may not yet reflect the just-written frontmatter.
     */
    private onSaved: (
      color: string | null,
      newBasename: string,
      style: OverlayStyle,
    ) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.file.basename);
    this.makeDraggable();
    const { contentEl } = this;

    let pendingColor = this.initialColor ?? "#888888";
    let pendingName = this.file.basename;

    // ── Open-note link ────────────────────────────────────────────────────────
    const headerRow = contentEl.createDiv({ cls: "duckmage-faction-editor-header" });
    const openBtn = headerRow.createEl("button", {
      text: "Open note →",
      cls: "duckmage-faction-editor-open-btn",
    });
    openBtn.addEventListener("click", () => {
      void this.app.workspace.getLeaf().openFile(this.file);
      this.close();
    });

    // ── Description (async read from note body) ───────────────────────────────
    const descWrap = contentEl.createDiv({ cls: "duckmage-faction-editor-desc" });
    descWrap.createSpan({ text: "Description", cls: "duckmage-faction-editor-desc-label" });
    const descText = descWrap.createEl("p", {
      text: "Loading…",
      cls: "duckmage-faction-editor-desc-text",
    });

    void (async () => {
      const raw = await this.app.vault.read(this.file);
      // Strip YAML frontmatter
      const body = raw.replace(/^---[\s\S]*?---\n?/, "").trim();
      // First non-empty paragraph
      const para = (body.split(/\n{2,}/).find((p) => p.trim()) ?? "").trim();
      const preview = para.length > 400 ? para.slice(0, 400) + "…" : para;
      descText.setText(preview || "(no description)");
    })();

    // ── Name ──────────────────────────────────────────────────────────────────
    new Setting(contentEl).setName("Name").addText((text) =>
      text.setValue(pendingName).onChange((v) => {
        pendingName = v.trim() || pendingName;
      }),
    );

    // ── Color ─────────────────────────────────────────────────────────────────
    new Setting(contentEl)
      .setName("Color")
      .addColorPicker((cp) =>
        cp.setValue(pendingColor).onChange((v) => {
          pendingColor = v;
          refreshPreview();
        }),
      );

    // ── Pattern + scale + opacity ─────────────────────────────────────────────
    const initialStyle = this.kind.getStyle(this.app, this.file.path);
    const { state: styleState, refreshPreview } = addOverlayPatternControls(
      contentEl,
      initialStyle,
      () => pendingColor,
      this.plugin.settings.hexOrientation,
    );

    // Autosaves (owner Q5, audit C3): × closes and saves what changed; no Save button.
    const startStyle = JSON.stringify(styleState);
    this.commit = async () => {
      const renamed = !!pendingName && pendingName !== this.file.basename;
      const changed = renamed || pendingColor !== (this.initialColor ?? "#888888") || JSON.stringify(styleState) !== startStyle;
      if (!changed) return;
      // Rename first so this.file.path is updated before the color write
      let newBasename = this.file.basename;
      if (renamed) {
        const folder = this.file.parent?.path ?? "";
        const newPath = folder ? `${folder}/${pendingName}.md` : `${pendingName}.md`;
        await this.app.fileManager.renameFile(this.file, newPath);
        newBasename = pendingName;
      }
      // this.file.path is updated in-place by Obsidian after rename
      await this.kind.setColor(this.app, this.file.path, pendingColor);
      await this.kind.setStyle(this.app, this.file.path, styleState);
      this.onSaved(pendingColor, newBasename, styleState);
    };
    renderSaveStatusLine(contentEl, { title: "Saves when you close this (×). There is no Save button." });
    this.footer({
      secondary: [{
        text: "Clear color",
        cls: "duckmage-faction-editor-clear",
        disabled: !this.initialColor,
        onClick: () => {
          this.commit = null;
          void (async () => {
            await this.kind.setColor(this.app, this.file.path, null);
            this.onSaved(null, this.file.basename, styleState);
            this.close();
          })();
        },
      }],
    });
  }

  /** The autosave run on close (null once Clear color has written). */
  private commit: (() => Promise<void>) | null = null;

  onClose(): void {
    void this.commit?.();
    this.commit = null;
    this.contentEl.empty();
  }
}

// ── Area note palette picker ─────────────────────────────────────────────────

/** Pick an area note to paint with (or Remove), edit one's colour and style, or make a new one. */
export class AreaNotePickerModal extends HexmakerModal {
  private pendingColorOverrides = new Map<string, string>();

  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private kind: AreaNoteKind,
    private onPicked: (filePath: string) => void,
    private onErase?: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.kind.title);
    this.makeDraggable();
    this.buildPalette();
  }

  private buildPalette(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("duckmage-faction-picker");

    const folder = normalizeFolder(this.kind.folder(this.plugin.settings));

    if (!folder) {
      emptyState(contentEl, this.kind.noFolderText);
      return;
    }

    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => this.plugin.isLinkableNote(f) && f.path.startsWith(folder + "/"))
      .sort((a, b) => a.basename.localeCompare(b.basename));

    if (files.length === 0) {
      emptyState(contentEl, this.kind.noNotesText(folder));
    } else {
      const grid = contentEl.createDiv({ cls: "duckmage-faction-palette" });

      if (this.onErase) {
        const removeBtn = grid.createDiv({ cls: "duckmage-faction-tile duckmage-faction-tile-remove" });
        const removePreview = removeBtn.createDiv({ cls: "duckmage-faction-tile-preview duckmage-faction-tile-preview-remove" });
        removePreview.setText("✕");
        removeBtn.createSpan({ text: "Remove", cls: "duckmage-faction-tile-name" });
        removeBtn.addEventListener("click", () => {
          this.onErase!();
          this.close();
        });
      }

      const orientation = this.plugin.settings.hexOrientation;
      const TILE_HEX_PX = 48;

      for (const file of files) {
        let color = this.pendingColorOverrides.get(file.path) ?? this.kind.getColor(this.app, file.path);
        let style = this.kind.getStyle(this.app, file.path);

        const tile = grid.createDiv({ cls: "duckmage-faction-tile" });

        const preview = tile.createDiv({ cls: "duckmage-faction-tile-preview" });
        if (color) {
          renderHexPreview(preview, { color, style, orientation, hexSizePx: TILE_HEX_PX });
        } else {
          preview.addClass("duckmage-faction-tile-preview-empty");
        }

        // Edit button — top-right corner, shown on hover via CSS
        const editBtn = tile.createEl("button", {
          cls: "duckmage-faction-tile-edit",
          attr: { title: this.kind.editTitle },
        });
        editBtn.setText("✏");

        // Name label — kept as a reference so rename can update it
        const nameEl = tile.createSpan({
          text: file.basename,
          cls: "duckmage-faction-tile-name",
        });
        filterText(tile, file.basename);

        editBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          new AreaNoteEditorModal(
            this.app,
            this.plugin,
            this.kind,
            file, // TFile mutated in-place by Obsidian on rename
            color,
            (newColor, newBasename, newStyle) => {
              color = newColor;
              style = newStyle;
              preview.replaceChildren();
              if (newColor) {
                preview.removeClass("duckmage-faction-tile-preview-empty");
                renderHexPreview(preview, {
                  color: newColor,
                  style: newStyle,
                  orientation,
                  hexSizePx: TILE_HEX_PX,
                });
              } else {
                preview.addClass("duckmage-faction-tile-preview-empty");
              }
              nameEl.setText(newBasename);
              filterText(tile, newBasename);
            },
          ).open();
        });

        // Main tile click → select the note for painting (file.path reflects renames)
        tile.addEventListener("click", () => {
          this.onPicked(file.path);
          this.close();
        });
      }
      // The shared picker filter (src/ui/pickers.ts), once the list is long.
      addPickerFilter(grid, { things: this.kind.filterThings, count: files.length });
    }

    // ── New note row ──────────────────────────────────────────────────────────
    const addRow = contentEl.createDiv({ cls: "duckmage-faction-picker-add" });
    const nameInput = addRow.createEl("input", {
      cls: "duckmage-faction-picker-add-input",
      attr: { type: "text", placeholder: this.kind.newPlaceholder },
    });
    const createBtn = addRow.createEl("button", {
      text: "Create",
      cls: "mod-cta duckmage-faction-picker-add-btn",
    });

    const doCreate = () => void this.createNote(nameInput.value.trim(), folder);
    createBtn.addEventListener("click", doCreate);
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doCreate();
    });
  }

  private async createNote(name: string, folder: string): Promise<void> {
    if (!name || name.startsWith("_")) return;

    const filePath = `${folder}/${name}.md`;

    if (this.app.vault.getAbstractFileByPath(filePath)) {
      new Notice(this.kind.existsText(name));
      return;
    }

    // Ensure folder exists
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder);
    }

    const file = await this.app.vault.create(filePath, "");
    this.kind.afterCreate?.(this.plugin, name);

    new AreaNoteEditorModal(this.app, this.plugin, this.kind, file, null, (newColor) => {
      if (newColor) this.pendingColorOverrides.set(file.path, newColor);
      this.buildPalette();
    }).open();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
