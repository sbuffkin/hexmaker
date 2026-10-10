import { App, Component, MarkdownRenderer, TFile } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import { openNoteFocused } from "../openNote";
import type { TokenEntry } from "../types";
import { hexKeyCoords } from "./hexHover";

export class TokenInfoModal extends HexmakerModal {
  private renderComp: Component | undefined;

  constructor(
    app: App,
    private token: TokenEntry,
    private onCenter: (x: number, y: number) => void,
    private onDelete?: () => void,
    private onEdit?: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("duckmage-hex-editor");
    this.makeDraggable();

    // Title row — left: h2 + ⌖ + "Open note" | right: "Edit token"
    const titleRow = contentEl.createDiv({ cls: "duckmage-editor-title-row" });
    const titleLeft = titleRow.createDiv({ cls: "duckmage-editor-title-left" });
    titleLeft.createEl("h2", { text: this.token.title });

    const jumpBtn = titleLeft.createEl("button", {
      text: "⌖",
      cls: "duckmage-editor-center-btn",
      attr: { title: "Jump to hex" },
    });
    jumpBtn.addEventListener("click", () => {
      const [x, y] = this.token.hex.split("_").map(Number);
      this.close();
      this.onCenter(x, y);
    });

    const noteFile = this.app.vault.getAbstractFileByPath(this.token.filePath);
    if (noteFile instanceof TFile) {
      const openLink = titleLeft.createEl("a", {
        text: "Open note",
        cls: "duckmage-editor-open-link",
      });
      openLink.addEventListener("click", () => {
        void openNoteFocused(this.app, noteFile);
        this.close();
      });
    }

    // Edit token — top right, next to the native close ×
    if (this.onEdit) {
      titleRow.createEl("button", {
        text: "Edit token",
        cls: "duckmage-token-info-edit-btn",
      }).addEventListener("click", () => {
        this.close();
        this.onEdit!();
      });
    }

    const body = contentEl.createDiv({ cls: "duckmage-token-info-content" });

    // Location
    body.createEl("p", {
      text: `Hex ${hexKeyCoords(this.token.hex)}`,
      cls: "duckmage-token-info-loc",
    });

    // Description
    if (this.token.description) {
      body.createEl("p", {
        text: this.token.description,
        cls: "duckmage-token-info-desc",
      });
    }

    // Note content — split view: rendered left, editable right
    const noteFile2 = this.app.vault.getAbstractFileByPath(this.token.filePath);
    if (noteFile2 instanceof TFile) {
      const noteWrap  = body.createDiv({ cls: "duckmage-token-info-note-wrap" });
      noteWrap.createSpan({ text: "Note", cls: "duckmage-token-info-note-label" });

      const rendered = noteWrap.createDiv({ cls: "duckmage-token-info-note-rendered" });

      // MarkdownRenderer creates .internal-link anchors but doesn't attach handlers;
      // intercept via delegation and open in a new tab.
      rendered.addEventListener("click", (e) => {
        const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a.internal-link");
        if (!a) return;
        e.preventDefault();
        e.stopPropagation();
        const href = a.dataset.href ?? a.getAttribute("href") ?? "";
        if (href) void this.app.workspace.openLinkText(href, noteFile2.path, "tab");
      });

      this.renderComp?.unload();
      this.renderComp = new Component();
      this.renderComp.load();
      void this.app.vault.read(noteFile2).then((raw) => {
        const fmMatch = raw.match(/^---\n[\s\S]*?\n---\n?/);
        const body    = (fmMatch ? raw.slice(fmMatch[0].length) : raw).trimStart();
        if (body.trim()) {
          void MarkdownRenderer.render(this.app, body, rendered, noteFile2.path, this.renderComp!);
        } else {
          rendered.createEl("p", { text: "No content.", cls: "duckmage-token-info-empty" });
        }
      });
    }

    // Remove — bottom left, two-step confirm
    if (this.onDelete) {
      let confirming = false;
      const removeBtn = body.createEl("button", {
        text: "× remove",
        cls: "duckmage-token-info-remove-btn",
        attr: { title: "Remove token from map (note is kept)" },
      });
      removeBtn.addEventListener("click", () => {
        if (!confirming) {
          confirming = true;
          removeBtn.setText("Confirm remove?");
          removeBtn.addClass("duckmage-token-info-remove-btn--confirming");
        } else {
          this.close();
          this.onDelete!();
        }
      });
      // Cancel confirm if user clicks elsewhere
      removeBtn.addEventListener("blur", () => {
        if (confirming) {
          confirming = false;
          removeBtn.setText("× remove");
          removeBtn.removeClass("duckmage-token-info-remove-btn--confirming");
        }
      });
    }
  }

  onClose(): void {
    this.renderComp?.unload();
    this.renderComp = undefined;
    this.contentEl.empty();
  }
}
