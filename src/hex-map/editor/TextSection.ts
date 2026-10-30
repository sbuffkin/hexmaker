/**
 * A free-text section of the hex editor (Description, Landmark, …, and the
 * note's own extra sections): label, the 📖 roll button or the section's
 * table choice (TableSections), and a box that autosaves.
 */

import { normalizeFolder } from "../../utils";
import { getTerrainFromFile } from "../../frontmatter";
import { setSectionContent, joinSectionText } from "../../sections";
import { RandomTableModal } from "../../random-tables/RandomTableModal";
import { isRolledSection } from "../../regionTables";
import { AUTOSAVE_MS } from "../saveStatus";
import { EditorWritePart, bumpFieldSeq, type EditorWriteHost } from "./host";
import type { TableSections } from "./TableSections";

/** Typing pause after which a text section autosaves. */
const TEXT_AUTOSAVE_MS = AUTOSAVE_MS;

export interface TextSectionHost extends EditorWriteHost {
  /** The one autosave status (it moves beside the box being edited). */
  readonly notesStatusEl: HTMLElement | null;
  /** Text sections with typed-but-unsaved changes: flushed on close/navigate. */
  readonly pendingTextSaves: Set<() => void>;
  /** Text boxes by section key: append a rolled result and save (P2). */
  readonly textBoxes: Map<string, (addition: string) => void>;
}

export class TextSections extends EditorWritePart<TextSectionHost> {
  constructor(host: TextSectionHost, private readonly tables: TableSections) {
    super(host);
  }
  private get notesStatusEl(): HTMLElement | null {
    return this.host.notesStatusEl;
  }
  private get pendingTextSaves(): Set<() => void> {
    return this.host.pendingTextSaves;
  }
  private get textBoxes(): Map<string, (addition: string) => void> {
    return this.host.textBoxes;
  }

  renderTextSection(
    container: HTMLElement,
    path: string,
    section: string,
    label: string,
    initialContent: string,
  ): void {
    const sectionEl = container.createDiv({
      cls: `duckmage-editor-text-section duckmage-editor-text-section-${section.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    });
    const labelRow = sectionEl.createDiv({
      cls: "duckmage-text-section-label-row",
    });
    // label for= → clicking the label focuses the box.
    const labelEl = labelRow.createEl("label", {
      text: label,
      cls: "duckmage-text-section-label",
      attr: { for: `duckmage-hex-text-${section}-${bumpFieldSeq()}` },
    });

    // 📖 button: terrain description table (description section) or section-specific table
    const tablesFolder = normalizeFolder(
      this.plugin.settings.tablesFolder ?? "",
    );
    let previewTablePath: string | null = null;
    let previewTitle = "";

    if (section === "description") {
      const terrain = getTerrainFromFile(this.app, path);
      if (terrain) {
        const p = tablesFolder
          ? `${tablesFolder}/terrain/description/${terrain}.md`
          : `terrain/description/${terrain}.md`;
        if (this.app.vault.getAbstractFileByPath(p)) {
          previewTablePath = p;
          previewTitle = `Roll on ${terrain} description table`;
        }
      }
    } else if (
      section === "landmark" ||
      section === "hidden" ||
      section === "secret"
    ) {
      const p = tablesFolder
        ? `${tablesFolder}/${section}.md`
        : `${section}.md`;
      if (this.app.vault.getAbstractFileByPath(p)) {
        previewTablePath = p;
        previewTitle = `Roll on ${section} table`;
      }
    }

    const textarea = sectionEl.createEl("textarea", {
      cls: "duckmage-text-section-textarea",
      attr: { id: labelEl.htmlFor },
    });

    if (previewTablePath) {
      const btnGroup = labelRow.createDiv({
        cls: "duckmage-text-section-btn-group",
      });
      const previewBtn = btnGroup.createEl("button", {
        text: "📖",
        cls: "duckmage-section-desc-table-btn",
      });
      previewBtn.title = previewTitle;
      const capturedPath = previewTablePath;
      previewBtn.addEventListener("click", () => {
        new RandomTableModal(
          this.app,
          this.plugin,
          undefined,
          capturedPath,
          this.tables.rollTarget(section),
        ).open();
      });
    } else if (isRolledSection(section)) {
      // One table section per kind (SF2): its tables, Roll and change….
      const host = sectionEl.createDiv({ cls: "duckmage-editor-rolled-choice" });
      textarea.before(host);
      this.tables.renderTableChoice(host, path, section);
    }
    textarea.rows = 3;
    textarea.placeholder = `${label}…`;
    textarea.value = initialContent;

    // Autosave: a moment after typing stops, on blur, and on close or
    // navigation (flushTextSaves). The hex is captured now, so a save that
    // lands after navigating still goes to this hex. Unchanged text isn't
    // written (just focusing a box no longer creates the hex note).
    const hx = this.x;
    const hy = this.y;
    let lastSaved = initialContent;
    let timer: number | null = null;
    const save = (): void => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      this.pendingTextSaves.delete(save);
      const value = textarea.value;
      if (value === lastSaved) {
        this.saves.settle();
        return;
      }
      lastSaved = value;
      void this.saves.track(
        (async () => {
          const file = await this.ensureHexNote(hx, hy);
          if (!file) throw new Error(`Could not create the note for hex ${hx}, ${hy}`);
          await setSectionContent(this.app, path, section, value);
        })(),
      );
    };
    textarea.addEventListener("input", () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(save, TEXT_AUTOSAVE_MS);
      this.pendingTextSaves.add(save);
      this.saves.markPending();
    });
    textarea.addEventListener("blur", save);
    // "Add to this hex" from a roll lands in this box (and saves), so the
    // box and the note can't disagree.
    this.textBoxes.set(section, (addition) => {
      textarea.value = joinSectionText(textarea.value, addition);
      save();
      this.onChanged();
    });
    // Keep the autosave status beside the box being typed in.
    textarea.addEventListener("focus", () => {
      const status = this.notesStatusEl;
      if (status && status.parentElement !== labelRow) labelEl.after(status);
    });
  }
}
