/**
 * Export options modal for a single hex (Phase 1.5).
 *
 * Currently exposes file name + GM-sections toggle + format buttons. The
 * architecture is set up to grow: future options (per-section toggles,
 * "include related random tables", linked-note expansions, etc.) slot in as
 * new rows in `renderOptions`. The orchestrator wires those toggles into
 * `SingleHexExportOptions` without needing structural changes.
 */

import { App, TFile } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import {
  exportHexAsPdf,
  exportHexAsMarkdown,
} from "../export/exporters/singleHex";

export class HexExportModal extends HexmakerModal {
  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private hexFile: TFile,
    private defaultName?: string,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(`Export hex: ${this.hexFile.basename}`);
    this.makeDraggable();
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("duckmage-hex-export-modal");

    const baseName = this.defaultName ?? this.hexFile.basename;

    contentEl.createEl("p", {
      cls: "duckmage-export-tab-hint",
      text: "Export this hex as a structured PDF or Markdown file. Each section is rendered as its own block with generous spacing.",
    });

    const optsForm = contentEl.createDiv({ cls: "duckmage-export-tab-options" });

    // File name
    const nameRow = optsForm.createDiv({ cls: "duckmage-export-tab-row" });
    nameRow.createEl("label", {
      text: "File name",
      cls: "duckmage-export-tab-label",
    });
    const nameInput = nameRow.createEl("input", {
      type: "text",
      cls: "duckmage-export-tab-text",
      attr: { placeholder: baseName },
    });
    nameInput.value = baseName;

    // Include-GM toggle. Default OFF — GM-only sections should be opt-in.
    const gmRow = optsForm.createDiv({ cls: "duckmage-export-tab-row" });
    const gmCb = gmRow.createEl("input", {
      type: "checkbox",
      cls: "duckmage-export-tab-checkbox",
    });
    gmCb.checked = false;
    gmRow.createEl("label", {
      text: "Include game master only sections (hidden, secret)",
      cls: "duckmage-export-tab-label",
    });
    gmRow.addEventListener("click", (e) => {
      if (e.target instanceof HTMLInputElement) return;
      gmCb.checked = !gmCb.checked;
    });

    // Live filename preview
    const preview = contentEl.createDiv({ cls: "duckmage-export-tab-preview" });
    const buildStem = (): string =>
      nameInput.value.trim() || baseName;
    const updatePreview = () => {
      preview.setText(`Output: ${buildStem()}.pdf  /  ${buildStem()}.md`);
    };
    nameInput.addEventListener("input", updatePreview);
    updatePreview();

    // Action buttons
    const actions = contentEl.createDiv({ cls: "duckmage-export-tab-actions" });
    // A list of export choices: plain buttons (audit B1).
    const pdfBtn = actions.createEl("button", {
      text: "Export PDF",
    });
    pdfBtn.addEventListener("click", () => {
      void exportHexAsPdf(this.plugin, this.hexFile, {
        outputName: buildStem(),
        includeGmSections: gmCb.checked,
      });
      this.close();
    });
    const mdBtn = actions.createEl("button", {
      text: "Export Markdown",
    });
    mdBtn.addEventListener("click", () => {
      void exportHexAsMarkdown(this.plugin, this.hexFile, {
        outputName: buildStem(),
        includeGmSections: gmCb.checked,
      });
      this.close();
    });
  }
}
