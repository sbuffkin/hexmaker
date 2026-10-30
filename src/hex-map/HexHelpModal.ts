import { App, Component, MarkdownRenderer } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import HELP_CONTENT from "./help.md";

export class HexHelpModal extends HexmakerModal {
  constructor(app: App) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Hex map — controls & tools");
    this.contentEl.addClass("duckmage-help-modal");
    void MarkdownRenderer.render(
      this.app,
      HELP_CONTENT,
      this.contentEl,
      "",
      this as unknown as Component,
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
