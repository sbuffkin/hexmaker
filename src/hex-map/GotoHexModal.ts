import { App, Modal } from "obsidian";

export class GotoHexModal extends Modal {
  private xInput: HTMLInputElement | null = null;
  private yInput: HTMLInputElement | null = null;

  constructor(
    app: App,
    private onConfirm: (x: number, y: number) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Go to hex");
    const { contentEl } = this;
    contentEl.addClass("duckmage-goto-modal");

    const row = contentEl.createDiv({ cls: "duckmage-goto-row" });
    row.createSpan({ text: "X:" });
    this.xInput = row.createEl("input", {
      type: "number",
      cls: "duckmage-goto-input",
    });
    row.createSpan({ text: "Y:" });
    this.yInput = row.createEl("input", {
      type: "number",
      cls: "duckmage-goto-input",
    });

    const go = () => {
      const x = parseInt(this.xInput?.value ?? "", 10);
      const y = parseInt(this.yInput?.value ?? "", 10);
      if (!isNaN(x) && !isNaN(y)) {
        this.onConfirm(x, y);
        this.close();
      }
    };

    const goBtn = contentEl.createEl("button", {
      text: "Go",
      cls: "mod-cta duckmage-goto-btn-confirm",
    });
    goBtn.addEventListener("click", go);
    [this.xInput, this.yInput].forEach((input) =>
      input?.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter") go();
      }),
    );

    this.xInput.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
