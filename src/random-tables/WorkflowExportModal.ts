/**
 * Export options modal for a workflow (Phase 1.6).
 *
 * Exposes file name + sample count + template/breakdown toggles + format
 * buttons. Like HexExportModal, the layout uses the existing
 * `.duckmage-export-tab-*` CSS classes so it visually matches the Maps
 * modal Export tab.
 */

import { App, TFile } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import {
  exportWorkflowAsPdf,
  exportWorkflowAsMarkdown,
} from "../export/exporters/workflow";

export class WorkflowExportModal extends HexmakerModal {
  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private workflowFile: TFile,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(`Export workflow: ${this.workflowFile.basename}`);
    this.makeDraggable();
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("duckmage-workflow-export-modal");

    const baseName = this.workflowFile.basename;

    contentEl.createEl("p", {
      cls: "duckmage-export-tab-hint",
      text: "Export this workflow definition plus a batch of rolled sample outputs as a PDF or Markdown file.",
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

    // Number of samples
    const samplesRow = optsForm.createDiv({ cls: "duckmage-export-tab-row" });
    samplesRow.createEl("label", {
      text: "Number of sample outputs",
      cls: "duckmage-export-tab-label",
    });
    const samplesInput = samplesRow.createEl("input", {
      type: "number",
      cls: "duckmage-export-tab-number",
    });
    samplesInput.value = "5";
    samplesInput.min = "0";
    samplesInput.max = "50";
    samplesInput.step = "1";

    // Include template + breakdown toggles
    const templateCb = makeCheckbox(
      optsForm,
      "Include the workflow template",
      true,
    );
    const breakdownCb = makeCheckbox(
      optsForm,
      "Include the per-sample rolls breakdown",
      true,
    );

    // Live filename preview
    const preview = contentEl.createDiv({ cls: "duckmage-export-tab-preview" });
    const buildStem = (): string => nameInput.value.trim() || baseName;
    const updatePreview = () => {
      preview.setText(`Output: ${buildStem()}.pdf  /  ${buildStem()}.md`);
    };
    nameInput.addEventListener("input", updatePreview);
    updatePreview();

    const collectOpts = () => ({
      outputName: buildStem(),
      numSamples: clampInt(parseInt(samplesInput.value, 10), 0, 50, 5),
      includeTemplate: templateCb.checked,
      includeRollsBreakdown: breakdownCb.checked,
    });

    const actions = contentEl.createDiv({ cls: "duckmage-export-tab-actions" });
    // A list of export choices: plain buttons (audit B1).
    const pdfBtn = actions.createEl("button", {
      text: "Export PDF",
    });
    pdfBtn.addEventListener("click", () => {
      void exportWorkflowAsPdf(this.plugin, this.workflowFile, collectOpts());
      this.close();
    });
    const mdBtn = actions.createEl("button", {
      text: "Export Markdown",
    });
    mdBtn.addEventListener("click", () => {
      void exportWorkflowAsMarkdown(this.plugin, this.workflowFile, collectOpts());
      this.close();
    });
  }
}

function makeCheckbox(
  parent: HTMLElement,
  labelText: string,
  initial: boolean,
): HTMLInputElement {
  const row = parent.createDiv({ cls: "duckmage-export-tab-row" });
  const cb = row.createEl("input", {
    type: "checkbox",
    cls: "duckmage-export-tab-checkbox",
  });
  cb.checked = initial;
  row.createEl("label", { text: labelText, cls: "duckmage-export-tab-label" });
  row.addEventListener("click", (e) => {
    if (e.target instanceof HTMLInputElement) return;
    cb.checked = !cb.checked;
  });
  return cb;
}

function clampInt(v: number, lo: number, hi: number, fallback: number): number {
  if (Number.isNaN(v)) return fallback;
  return Math.max(lo, Math.min(hi, v));
}
