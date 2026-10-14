import { App, Notice } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";

/**
 * "Add to play log…" (SF3): one box for what happened at a hex; Add
 * appends it to today's play log (src/play/playLogWriter.ts).
 */
export class PlayLogModal extends HexmakerModal {
  protected surfaceId = "PlayLog";

  constructor(
    app: App,
    /** The hex, as shown: "Vale 3, 4". */
    private hexLabel: string,
    private add: (text: string) => Promise<string>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText("Add to play log");
    this.makeDraggable();
    contentEl.createEl("p", { cls: "setting-item-description", text: `What happened at ${this.hexLabel}. It goes to today's log note, with the time.` });
    const box = contentEl.createEl("textarea", {
      cls: "duckmage-play-log-text",
      attr: { rows: "4", "aria-label": "What happened", placeholder: "What happened…" },
    });
    const commit = () => {
      const text = box.value.trim();
      if (!text) { box.focus(); return; }
      void this.add(text)
        .then((path) => {
          new Notice(`Added to the play log (${path.replace(/^.*\//, "").replace(/\.md$/, "")}).`);
          this.close();
        })
        .catch((err) => new Notice(`Could not add to the play log: ${String(err)}`));
    };
    // Ctrl/Cmd+Enter adds.
    box.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
    });
    this.footer({ primary: { text: "Add", onClick: commit }, cancel: () => this.close() });
    window.setTimeout(() => box.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
