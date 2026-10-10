import { App, Notice, Setting, TFile } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import { normalizeFolder } from "../utils";
import {
  getRegionColorFromFile,
  setRegionColorInFile,
  getRegionStyleFromFile,
  setRegionStyleInFile,
  type OverlayStyle,
} from "../frontmatter";
import { addOverlayPatternControls, renderHexPreview } from "./overlayPatternControls";

// ── Region editor sub-modal ───────────────────────────────────────────────────

class GeoRegionEditorModal extends HexmakerModal {
  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private file: TFile,
    private initialColor: string | null,
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
      const body = raw.replace(/^---[\s\S]*?---\n?/, "").trim();
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
    const initialStyle = getRegionStyleFromFile(this.app, this.file.path);
    const { state: styleState, refreshPreview } = addOverlayPatternControls(
      contentEl,
      initialStyle,
      () => pendingColor,
      this.plugin.settings.hexOrientation,
    );

    // ── Buttons ───────────────────────────────────────────────────────────────
    const btnRow = contentEl.createDiv({ cls: "duckmage-faction-editor-btns" });

    const saveBtn = btnRow.createEl("button", {
      text: "Save",
      cls: "mod-cta duckmage-faction-editor-save",
    });
    saveBtn.addEventListener("click", () => {
      void (async () => {
        let newBasename = this.file.basename;
        if (pendingName && pendingName !== this.file.basename) {
          const folder = this.file.parent?.path ?? "";
          const newPath = folder ? `${folder}/${pendingName}.md` : `${pendingName}.md`;
          await this.app.fileManager.renameFile(this.file, newPath);
          newBasename = pendingName;
        }
        await setRegionColorInFile(this.app, this.file.path, pendingColor);
        await setRegionStyleInFile(this.app, this.file.path, styleState);
        this.onSaved(pendingColor, newBasename, styleState);
        this.close();
      })();
    });

    const clearBtn = btnRow.createEl("button", {
      text: "Clear color",
      cls: "duckmage-faction-editor-clear",
    });
    if (!this.initialColor) clearBtn.disabled = true;
    clearBtn.addEventListener("click", () => {
      void (async () => {
        await setRegionColorInFile(this.app, this.file.path, null);
        this.onSaved(null, this.file.basename, styleState);
        this.close();
      })();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// ── Region palette picker ─────────────────────────────────────────────────────

export class GeoRegionPickerModal extends HexmakerModal {
  private pendingColorOverrides = new Map<string, string>();

  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private onPicked: (filePath: string) => void,
    private onErase?: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Regions");
    this.makeDraggable();
    this.buildPalette();
  }

  private buildPalette(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("duckmage-faction-picker");

    const folder = normalizeFolder(this.plugin.settings.regionsFolder);

    if (!folder) {
      contentEl.createEl("p", {
        text: "No regions folder configured.",
        cls: "duckmage-faction-picker-empty",
      });
      return;
    }

    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => this.plugin.isLinkableNote(f) && f.path.startsWith(folder + "/"))
      .sort((a, b) => a.basename.localeCompare(b.basename));

    if (files.length === 0) {
      contentEl.createEl("p", {
        text: `No region notes found in "${folder}".`,
        cls: "duckmage-faction-picker-empty",
      });
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
        let color = this.pendingColorOverrides.get(file.path) ?? getRegionColorFromFile(this.app, file.path);
        let style = getRegionStyleFromFile(this.app, file.path);

        const tile = grid.createDiv({ cls: "duckmage-faction-tile" });

        const preview = tile.createDiv({ cls: "duckmage-faction-tile-preview" });
        if (color) {
          renderHexPreview(preview, { color, style, orientation, hexSizePx: TILE_HEX_PX });
        } else {
          preview.addClass("duckmage-faction-tile-preview-empty");
        }

        const editBtn = tile.createEl("button", {
          cls: "duckmage-faction-tile-edit",
          attr: { title: "Edit region" },
        });
        editBtn.setText("✏");

        const nameEl = tile.createSpan({
          text: file.basename,
          cls: "duckmage-faction-tile-name",
        });

        editBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          new GeoRegionEditorModal(
            this.app,
            this.plugin,
            file,
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
            },
          ).open();
        });

        tile.addEventListener("click", () => {
          this.onPicked(file.path);
          this.close();
        });
      }
    }

    // ── New region row ────────────────────────────────────────────────────────
    const addRow = contentEl.createDiv({ cls: "duckmage-faction-picker-add" });
    const nameInput = addRow.createEl("input", {
      cls: "duckmage-faction-picker-add-input",
      attr: { type: "text", placeholder: "New region name…" },
    });
    const createBtn = addRow.createEl("button", {
      text: "Create",
      cls: "mod-cta duckmage-faction-picker-add-btn",
    });

    const doCreate = () => void this.createRegion(nameInput.value.trim(), folder);
    createBtn.addEventListener("click", doCreate);
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doCreate();
    });
  }

  private async createRegion(name: string, folder: string): Promise<void> {
    if (!name || name.startsWith("_")) return;

    const filePath = `${folder}/${name}.md`;

    if (this.app.vault.getAbstractFileByPath(filePath)) {
      new Notice(`A region note named "${name}" already exists.`);
      return;
    }

    if (!this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder);
    }

    const file = await this.app.vault.create(filePath, "");
    void this.plugin.ensureRegionTable(name);

    new GeoRegionEditorModal(this.app, this.plugin, file, null, (newColor) => {
      if (newColor) this.pendingColorOverrides.set(file.path, newColor);
      this.buildPalette();
    }).open();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
