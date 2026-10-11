import { App } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";

export interface ConfirmOptions {
  /** The other button's text (default "Cancel"). */
  cancelText?: string;
  /** Called when the dialog closes without confirming (the other button, Esc, ×). */
  onCancel?: () => void;
  /** An offer rather than a warning: the confirm button is the call to action. */
  offer?: boolean;
}

/** Asks before doing something that can't be taken back from the page. */
export class ConfirmModal extends HexmakerModal {
  private confirmed = false;

  constructor(
    app: App,
    private readonly heading: string,
    private readonly message: string,
    private readonly confirmText: string,
    private readonly onConfirm: () => void,
    private readonly options: ConfirmOptions = {},
  ) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.titleEl.setText(this.heading);
    const { contentEl } = this;
    contentEl.createEl("p", { text: this.message });
    const row = contentEl.createDiv({ cls: "duckmage-confirm-btn-row" });
    const confirm = row.createEl("button", { text: this.confirmText, cls: this.options.offer ? "mod-cta" : "mod-warning" });
    confirm.addEventListener("click", () => {
      this.confirmed = true;
      this.close();
      this.onConfirm();
    });
    row.createEl("button", { text: this.options.cancelText ?? "Cancel" }).addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.confirmed) this.options.onCancel?.();
  }
}
