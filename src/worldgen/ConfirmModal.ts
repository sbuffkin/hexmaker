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

/**
 * Asks before doing something. Only two are left (owner Q6, 2026-10-13):
 * the offer to turn on a module for a map, and the debug-mode confirm.
 * Everything else relies on the work mode plus trash, backup or undo.
 */
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
    const act = { text: this.confirmText, onClick: () => {
      this.confirmed = true;
      this.close();
      this.onConfirm();
    } };
    const cancel = { text: this.options.cancelText ?? "Cancel", onClick: () => this.close() };
    // An offer's button is the primary; a warning's is destructive. Either way it comes first.
    this.footer(this.options.offer ? { primary: act, cancel } : { destructive: act, cancel });
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.confirmed) this.options.onCancel?.();
  }
}
