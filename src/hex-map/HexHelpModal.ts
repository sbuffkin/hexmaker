import { App, Component, MarkdownRenderer } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import HELP_CONTENT from "./help.md";

export class HexHelpModal extends HexmakerModal {
  private readonly rendered = new Component();

  constructor(app: App) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Hex map — controls & tools");
    this.contentEl.addClass("duckmage-help-modal");
    this.rendered.load();
    void MarkdownRenderer.render(
      this.app,
      HELP_CONTENT,
      this.contentEl,
      "",
      this.rendered,
    );
  }

  onClose(): void {
    this.rendered.unload();
    this.contentEl.empty();
  }
}
