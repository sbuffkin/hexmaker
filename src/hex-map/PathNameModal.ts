import { App } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";

/**
 * What the rename box's Save does with what's typed (pure): the cleaned
 * name (trimmed, inner whitespace collapsed) when it can be saved, else
 * null with a short reason. Empty is refused; the current name is fine
 * (Save just closes); anything else asks `check` (e.g. the name is taken).
 */
export function pathNameState(
  raw: string,
  current: string,
  check: (name: string) => string | null,
): { name: string | null; problem: string | null } {
  const name = raw.trim().replace(/\s+/g, " ");
  const problem = !name ? "A path needs a name." : name === current ? null : check(name);
  return { name: problem ? null : name, problem };
}

/**
 * Rename a path: one text field. `check` returns a problem to show (e.g.
 * the name is taken) or null. While there is one, Save looks and is
 * disabled and the reason shows under the field (#48).
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
      const { name, problem: msg } = pathNameState(input.value, this.current, this.check);
      problem.setText(msg ?? "");
      save.disabled = !!msg;
      save.toggleClass("mod-disabled", !!msg);
      save.setAttribute("aria-disabled", String(!!msg));
      if (msg) save.setAttribute("title", msg);
      else save.removeAttribute("title");
      return name;
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
