import { App, Modal } from "obsidian";

export class ConfirmDeleteModal extends Modal {
  constructor(
    app: App,
    private readonly tableName: string,
    private readonly onConfirm: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("p", {
      text: `Delete "${this.tableName}"? This cannot be undone.`,
    });
    const btnRow = contentEl.createDiv({ cls: "duckmage-confirm-btn-row" });

    const deleteBtn = btnRow.createEl("button", {
      text: "Delete",
      cls: "mod-warning",
    });
    deleteBtn.addEventListener("click", () => {
      void (async () => {
        this.close();
        await this.onConfirm();
      })();
    });

    const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
