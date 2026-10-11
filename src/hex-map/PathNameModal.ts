import { App } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";

/**
 * Rename a path: one text field. `check` returns a problem to show (e.g.
 * the name is taken) or null; Save is refused while there is one.
 */
export class PathNameModal extends HexmakerModal {
  constructor(
    app: App,
    private current: string,
    private check: (name: string) => string | null,
    private onSave: (name: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("duckmage-path-name-modal");
    contentEl.createEl("h2", { text: "Rename path" });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: "The map note lists the path under this name in both of its path tables; both are updated.",
    });
    const input = contentEl.createEl("input", { type: "text", value: this.current, cls: "duckmage-path-name-input" });
    const problem = contentEl.createDiv({ cls: "duckmage-path-name-problem mod-warning" });
    const row = contentEl.createDiv({ cls: "modal-button-container" });
    const save = row.createEl("button", { text: "Save", cls: "mod-cta" });
    const cancel = row.createEl("button", { text: "Cancel" });
    const validate = (): string | null => {
      const name = input.value.trim().replace(/\s+/g, " ");
      const msg = !name ? "A path needs a name." : name === this.current ? null : this.check(name);
      problem.setText(msg ?? "");
      save.disabled = !!msg;
      return msg ? null : name;
    };
    const submit = () => {
      const name = validate();
      if (name === null) return;
      this.close();
      if (name !== this.current) this.onSave(name);
    };
    input.addEventListener("input", () => validate());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    save.addEventListener("click", submit);
    cancel.addEventListener("click", () => this.close());
    validate();
    input.focus();
    input.select();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
