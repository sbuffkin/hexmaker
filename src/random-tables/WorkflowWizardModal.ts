import { App, TFile, Notice } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import { normalizeFolder } from "../utils";
import {
  parseWorkflow,
  generateDefaultTemplate,
  stepPlaceholder,
  rollDiceFormulaWithBreakdown,
  type Workflow,
  workflowResultAsSectionText,
  WorkflowStep,
  reconcileTemplate,
  unfilledTokens,
  fillWorkflowTemplate,
  buildResultsNote,
  type FilledValue,
  type RollRecord,
} from "./workflow";
import { dieLabel, parseRandomTable, rollTable } from "./randomTable";
import { renderAddToHex, type RollHexTarget } from "./RandomTableModal";
import { resolveStepTable, resolveWorkflowTemplate } from "./workflowFiles";
import { ConfirmModal } from "../worldgen/ConfirmModal";
import { localIsoDateTime } from "../provenance";

/** How a slot got its value, for the results note's Rolls table. */
interface SlotInfo {
  /** Link text of the note a linked result is. */
  link?: string;
  /** The face rolled (rolls by ranges) or the dice breakdown. */
  roll?: string;
  /** Picked from the list or typed, not rolled. */
  manual?: "picked" | "typed";
}

/** A table row offered in the manual-pick list. */
interface PickEntry {
  label: string;
  link?: string;
}

/** The note a table row links to, when the whole row is a link. */
function rowLinkTarget(result: string, isLink?: boolean): string | undefined {
  if (isLink) return result;
  return /^\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/.exec(result.trim())?.[1];
}

export class WorkflowWizardModal extends HexmakerModal {
  private workflow!: Workflow;
  // rolls[stepIdx][rollIdx] = result string or null (not yet rolled)
  private rolls: (string | null)[][] = [];
  private templateContent = "";
  private stepEntries: PickEntry[][] = []; // [stepIdx] → rows of the table
  /** slots[stepIdx][rollIdx]: how the value was got. */
  private slots: SlotInfo[][] = [];
  /** Per step: its source (link or formula) and die, for the Rolls table. */
  private stepSource: { source: string; die: string }[] = [];
  /** $tokens in the template no step fills. */
  private unfilled: string[] = [];
  /** Placeholders the template lacked; added for this run. */
  private addedToTemplate: string[] = [];
  private resultTextarea!: HTMLTextAreaElement;
  private saveNoteNameInput!: HTMLInputElement;
  private saveResultsFolderInput!: HTMLInputElement;
  private saveNoteBtn!: HTMLButtonElement;
  private saveStatusEl!: HTMLElement;
  private stepsArea!: HTMLElement;
  // sumOnly[stepIdx][rollIdx] = true means collapse breakdown to sum in result
  private sumOnly: boolean[][] = [];

  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private workflowFile: TFile,
    /** Run from a hex (PA2): the result can be added to that hex's note. */
    private hexTarget?: RollHexTarget,
  ) {
    super(app);
  }

  async onOpen(): Promise<void> {
    this.titleEl.setText(this.workflowFile.basename);
    this.contentEl.createDiv({ cls: "duckmage-rt-empty", text: "Loading…" });

    const rawContent = await this.app.vault.read(this.workflowFile);
    this.workflow = parseWorkflow(rawContent, this.workflowFile.basename);

    // Initialise rolls array
    this.rolls = this.workflow.steps.map((step: WorkflowStep) =>
      Array.from({ length: step.rolls }, () => null),
    );
    this.sumOnly = this.workflow.steps.map((step: WorkflowStep) =>
      Array.from({ length: step.rolls }, () => false),
    );
    this.slots = this.workflow.steps.map((step: WorkflowStep) =>
      Array.from({ length: step.rolls }, (): SlotInfo => ({})),
    );
    this.stepSource = this.workflow.steps.map((step) => ({
      source: step.kind === "dice" ? (step.diceFormula ?? "") : `[[${step.tablePath}]]`,
      die: step.kind === "dice" ? (step.diceFormula ?? "") : "",
    }));

    // Preload table entries for each step (for the manual-pick dropdown; dice steps have no entries)
    this.stepEntries = await Promise.all(
      this.workflow.steps.map(async (step: WorkflowStep, si: number): Promise<PickEntry[]> => {
        if (step.kind === "dice") return [];
        const tableFile = resolveStepTable(this.app, step, this.workflowFile.path);
        if (!tableFile) return [];
        const content = await this.app.vault.read(tableFile);
        const table = parseRandomTable(content);
        this.stepSource[si] = {
          source: `[[${this.app.metadataCache.fileToLinktext(tableFile, this.workflowFile.path)}]]`,
          die: dieLabel(table.dice),
        };
        return table.entries.map((e) => {
          const target = rowLinkTarget(e.result, e.isLink);
          if (!target) return { label: e.result };
          return { label: target.split("/").pop() ?? target, link: this.linkTextFor(target) };
        });
      }),
    );

    // Load the template (however its path was typed), and add any
    // placeholders a step fills that it lacks, for this run.
    const tmplFile = resolveWorkflowTemplate(this.app, this.workflow.templateFile, this.workflowFile.path);
    if (tmplFile) this.templateContent = await this.app.vault.read(tmplFile);
    if (!this.templateContent) {
      this.templateContent = generateDefaultTemplate(this.workflow.steps);
    }
    const reconciled = reconcileTemplate(this.templateContent, this.workflow.steps);
    this.templateContent = reconciled.template;
    this.addedToTemplate = reconciled.added;
    this.unfilled = unfilledTokens(this.templateContent, this.workflow.steps);

    this.buildUI();
  }

  private buildUI(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("duckmage-wf-wizard");

    // ── Header buttons ────────────────────────────────────────────────
    const header = contentEl.createDiv({ cls: "duckmage-wf-wizard-header" });

    const rollAllBtn = header.createEl("button", {
      text: "Roll all",
      cls: "mod-cta",
    });
    rollAllBtn.title = "Roll all unfilled slots";
    rollAllBtn.addEventListener("click", () => { void this.rollAll(false); });

    const rerollAllBtn = header.createEl("button", { text: "Reroll all" });
    rerollAllBtn.title = "Reroll every slot";
    rerollAllBtn.addEventListener("click", () => { void this.rollAll(true); });

    // The template and the steps disagree: say so (the editor fixes it).
    if (this.unfilled.length || this.addedToTemplate.length) {
      const warn = contentEl.createDiv({ cls: "duckmage-wf-validation-err duckmage-wf-wizard-warning" });
      if (this.unfilled.length) {
        warn.createDiv({ text: `No step fills ${this.unfilled.join(", ")}, so it stays as typed.` });
      }
      if (this.addedToTemplate.length) {
        warn.createDiv({ text: `The template has no ${this.addedToTemplate.join(", ")}; added at the end for this run. Edit the workflow to keep them.` });
      }
    }

    // ── Steps area ────────────────────────────────────────────────────
    this.stepsArea = contentEl.createDiv({ cls: "duckmage-wf-wizard-steps" });
    this.renderSteps();

    // ── Result textarea ───────────────────────────────────────────────
    contentEl.createEl("p", {
      text: "Result",
      cls: "duckmage-table-editor-heading",
    });
    this.resultTextarea = contentEl.createEl("textarea", {
      cls: "duckmage-wf-template-area",
    });
    this.resultTextarea.readOnly = true;
    this.resultTextarea.value = this.assembleResult();

    const resultBtns = contentEl.createDiv({ cls: "duckmage-wf-result-buttons" });
    const copyResultBtn = resultBtns.createEl("button", { text: "Copy result" });
    copyResultBtn.addEventListener("click", () => {
      void navigator.clipboard
        .writeText(this.resultTextarea?.value ?? "")
        .then(() => {
          copyResultBtn.setText("Copied!");
          window.setTimeout(() => copyResultBtn.setText("Copy result"), 1500);
        });
    });
    // Run from a hex: put the filled-in result into one of its sections.
    if (this.hexTarget) {
      renderAddToHex(resultBtns, this.hexTarget, () => workflowResultAsSectionText(this.resultTextarea?.value ?? ""), {
        cta: true,
        onAdded: () => this.close(),
      });
    }

    // ── Save section ──────────────────────────────────────────────────
    contentEl.createEl("p", {
      text: "Save as note",
      cls: "duckmage-table-editor-heading",
    });

    const saveNoteNameRow = contentEl.createDiv({
      cls: "duckmage-table-editor-name-row",
    });
    saveNoteNameRow.createEl("label", {
      text: "Note name",
      cls: "duckmage-table-editor-name-label",
    });
    this.saveNoteNameInput = saveNoteNameRow.createEl("input", {
      type: "text",
      cls: "duckmage-table-editor-name-input",
    });
    this.saveNoteNameInput.value = this.defaultNoteName();

    const saveResultsFolderRow = contentEl.createDiv({
      cls: "duckmage-table-editor-name-row",
    });
    saveResultsFolderRow.createEl("label", {
      text: "Results folder",
      cls: "duckmage-table-editor-name-label",
    });
    const rfDatalistId =
      "duckmage-ww-rf-folders-" + Math.random().toString(36).slice(2);
    const rfDatalist = contentEl.createEl("datalist");
    rfDatalist.id = rfDatalistId;
    const worldFolder = normalizeFolder(this.plugin.settings.worldFolder);
    const seenFolders = new Set<string>();
    for (const f of this.app.vault.getAllFolders()) {
      const p = normalizeFolder(f.path);
      if (!p || p === worldFolder) continue;
      if (worldFolder && !p.startsWith(worldFolder + "/")) continue;
      if (!seenFolders.has(p)) {
        seenFolders.add(p);
        rfDatalist.createEl("option", { value: p });
      }
    }
    this.saveResultsFolderInput = saveResultsFolderRow.createEl("input", {
      type: "text",
      cls: "duckmage-table-editor-name-input",
    });
    this.saveResultsFolderInput.setAttribute("list", rfDatalistId);
    this.saveResultsFolderInput.value = normalizeFolder(
      this.workflow.resultsFolder ?? "",
    );

    // Run from a hex, "Add to this hex" is the main action; saving a note is secondary.
    this.saveNoteBtn = contentEl.createEl("button", {
      text: "Save as note",
      cls: this.hexTarget ? "" : "mod-cta",
    });
    this.saveStatusEl = contentEl.createDiv({ cls: "duckmage-wf-save-status" });

    this.updateSaveButton();
    this.saveNoteBtn.addEventListener("click", () => { void this.saveAsNote(); });

    this.makeDraggable();
  }

  private renderSteps(): void {
    this.stepsArea.empty();

    for (let si = 0; si < this.workflow.steps.length; si++) {
      const step = this.workflow.steps[si];
      const stepEl = this.stepsArea.createDiv({
        cls: "duckmage-wf-wizard-step",
      });

      const stepHeader = stepEl.createDiv({
        cls: "duckmage-wf-wizard-step-header",
      });
      const stepName =
        step.kind === "dice"
          ? step.label || step.diceFormula || "dice"
          : step.label || step.tablePath.split("/").pop() || step.tablePath;
      stepHeader.createEl("strong", { text: stepName });
      if (step.kind === "dice") {
        stepHeader.createSpan({
          cls: "duckmage-wf-roll-badge duckmage-wf-dice-badge",
          text: step.diceFormula ?? "",
        });
      }
      stepHeader.createSpan({
        cls: "duckmage-wf-roll-badge",
        text: `×${step.rolls}`,
      });

      // "Sum all" toggle — only for dice steps with multiple rolls
      const perRollCbs: HTMLInputElement[] = [];
      let sumAllCb: HTMLInputElement | null = null;
      if (step.kind === "dice" && step.rolls > 1) {
        const sumAllLabel = stepHeader.createEl("label", {
          cls: "duckmage-wf-sum-toggle duckmage-wf-sum-all",
        });
        sumAllCb = sumAllLabel.createEl("input", { type: "checkbox" });
        sumAllCb.checked = this.sumOnly[si].every((v) => v);
        sumAllLabel.createSpan({ text: "sum all" });
        sumAllCb.addEventListener("change", () => {
          this.sumOnly[si].fill(sumAllCb!.checked);
          for (const cb of perRollCbs) cb.checked = sumAllCb!.checked;
          this.updateResultTextarea();
        });
      }

      for (let ri = 0; ri < step.rolls; ri++) {
        const rollRow = stepEl.createDiv({ cls: "duckmage-wf-step-row" });

        // Show the placeholder name as a label
        const varLabel = rollRow.createEl("code", {
          cls: "duckmage-wf-placeholder-label",
        });
        varLabel.setText(stepPlaceholder(step, ri));

        const rollInput = rollRow.createEl("input", {
          type: "text",
          cls:
            "duckmage-wf-roll-input" +
            (this.rolls[si][ri] !== null ? " is-rolled" : ""),
        });
        rollInput.value = this.rolls[si][ri] ?? "";
        rollInput.placeholder = "—";
        rollInput.addEventListener("input", () => {
          this.rolls[si][ri] = rollInput.value.trim() || null;
          this.slots[si][ri] = { manual: "typed" };
          this.updateResultTextarea();
          this.updateSaveButton();
        });

        // Only show the manual picker for table steps
        if (step.kind !== "dice") {
          const pickerSelect = rollRow.createEl("select", {
            cls: "duckmage-wf-pick-select",
          });
          pickerSelect.createEl("option", { value: "", text: "— pick —" });
          (this.stepEntries[si] ?? []).forEach((entry, ei) => {
            pickerSelect.createEl("option", { value: String(ei), text: entry.label });
          });
          pickerSelect.addEventListener("change", () => {
            const entry = pickerSelect.value === "" ? undefined : this.stepEntries[si]?.[Number(pickerSelect.value)];
            if (!entry) return;
            const picked = entry.label;
            this.rolls[si][ri] = picked;
            this.slots[si][ri] = { link: entry.link, manual: "picked" };
            rollInput.value = picked;
            rollInput.classList.add("is-rolled");
            rollBtn.setText("Reroll");
            pickerSelect.value = "";
            this.updateResultTextarea();
            this.updateSaveButton();
          });
        }

        const rollBtn = rollRow.createEl("button", {
          text: this.rolls[si][ri] !== null ? "Reroll" : "Roll",
          cls: "duckmage-wf-roll-btn",
        });
        rollBtn.addEventListener("click", () => {
          void (async () => {
            rollBtn.disabled = true;
            rollBtn.setText("…");
            await this.rollStep(si, ri);
            rollInput.value = this.rolls[si][ri] ?? "";
            rollInput.classList.toggle("is-rolled", this.rolls[si][ri] !== null);
            rollBtn.setText("Reroll");
            rollBtn.disabled = false;
            this.updateResultTextarea();
            this.updateSaveButton();
          })();
        });

        if (step.kind === "dice") {
          const sumLabel = rollRow.createEl("label", {
            cls: "duckmage-wf-sum-toggle",
          });
          const sumCb = sumLabel.createEl("input", { type: "checkbox" });
          sumCb.checked = this.sumOnly[si][ri];
          sumLabel.createSpan({ text: "sum" });
          perRollCbs.push(sumCb);
          sumCb.addEventListener("change", () => {
            this.sumOnly[si][ri] = sumCb.checked;
            if (sumAllCb) sumAllCb.checked = this.sumOnly[si].every((v) => v);
            this.updateResultTextarea();
          });
        }
      }
    }
  }

  private async rollStep(stepIdx: number, rollIdx: number): Promise<void> {
    const step = this.workflow.steps[stepIdx];

    if (step.kind === "dice") {
      const rolled = rollDiceFormulaWithBreakdown(step.diceFormula ?? "1d6");
      this.rolls[stepIdx][rollIdx] = rolled;
      this.slots[stepIdx][rollIdx] = { roll: rolled };
      return;
    }

    // Try exact path first, then Obsidian link resolution with workflow file as source
    const tableFile = resolveStepTable(this.app, step, this.workflowFile.path);
    if (!tableFile) {
      new Notice(`Table not found: ${step.tablePath}`);
      return;
    }
    const content = await this.app.vault.read(tableFile);
    const table = parseRandomTable(content);
    const outcome = rollTable(table);
    if (!outcome) return;
    const entry = outcome.entry;

    // A linked row keeps its link (shown by name in the wizard).
    const target = rowLinkTarget(entry.result, entry.isLink);
    this.rolls[stepIdx][rollIdx] = target ? (target.split("/").pop() ?? target) : entry.result;
    this.slots[stepIdx][rollIdx] = {
      link: target ? this.linkTextFor(target) : undefined,
      roll: outcome.face !== undefined ? String(outcome.face) : "",
    };
  }

  /** Shortest link text for a note path (the path itself if it doesn't resolve). */
  private linkTextFor(target: string): string {
    const clean = target.replace(/\.md$/i, "");
    const file = this.app.metadataCache.getFirstLinkpathDest(clean, this.workflowFile.path);
    return file ? this.app.metadataCache.fileToLinktext(file, this.workflowFile.path) : clean;
  }

  /** Roll all unfilled slots (rerollAll=false) or every slot (rerollAll=true). */
  private async rollAll(rerollAll: boolean): Promise<void> {
    for (let si = 0; si < this.workflow.steps.length; si++) {
      for (let ri = 0; ri < this.workflow.steps[si].rolls; ri++) {
        if (rerollAll || this.rolls[si][ri] === null) {
          await this.rollStep(si, ri);
        }
      }
    }
    this.renderSteps();
    this.updateResultTextarea();
    this.updateSaveButton();
  }

  private assembleResult(): string {
    return fillWorkflowTemplate(this.templateContent, this.filledValues());
  }

  /** One row per rolled slot, for the results note. */
  private rollRecords(): RollRecord[] {
    const values = this.filledValues();
    const records: RollRecord[] = [];
    this.workflow.steps.forEach((step, si) => {
      for (let ri = 0; ri < step.rolls; ri++) {
        if (this.rolls[si][ri] === null) continue;
        const placeholder = stepPlaceholder(step, ri);
        const v = values.get(placeholder);
        const slot = this.slots[si]?.[ri] ?? {};
        records.push({
          placeholder,
          source: this.stepSource[si]?.source ?? "",
          die: this.stepSource[si]?.die ?? "",
          roll: slot.manual ?? slot.roll ?? "",
          // The result as it reads in the note (a link stays a link).
          result: v ? fillWorkflowTemplate(placeholder, new Map([[placeholder, v]])) : "",
        });
      }
    });
    return records;
  }

  /** What each placeholder gets: the value shown, and its link if it's a linked row. */
  private filledValues(): Map<string, FilledValue> {
    const values = new Map<string, FilledValue>();
    for (let si = 0; si < this.workflow.steps.length; si++) {
      const step = this.workflow.steps[si];
      for (let ri = 0; ri < step.rolls; ri++) {
        const placeholder = stepPlaceholder(step, ri);
        const value = this.rolls[si][ri];
        let display = value;
        if (display !== null && step.kind === "dice" && this.sumOnly[si][ri]) {
          // Extract just the sum from "(d1+d2+...)=N" format
          display = display.replace(/^\(.*\)=(-?\d+)$/, "$1");
        }
        if (display === null) values.set(placeholder, { text: `[${placeholder}]` });
        else values.set(placeholder, { text: display, link: this.slots[si]?.[ri]?.link });
      }
    }
    return values;
  }

  private updateResultTextarea(): void {
    if (this.resultTextarea) {
      this.resultTextarea.value = this.assembleResult();
    }
  }

  private allRolled(): boolean {
    return this.rolls.every((stepRolls) => stepRolls.every((r) => r !== null));
  }

  private updateSaveButton(): void {
    if (this.saveNoteBtn) {
      this.saveNoteBtn.disabled = !this.allRolled();
    }
  }

  private defaultNoteName(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}`;
    return `${this.workflowFile.basename} ${ts}`;
  }

  private saveAsNote(): Promise<void> {
    const noteName = this.saveNoteNameInput.value.trim();
    const folder = normalizeFolder(this.saveResultsFolderInput.value.trim());
    const notePath = folder ? `${folder}/${noteName}.md` : `${noteName}.md`;
    // Ask before writing over a note that's already there.
    if (noteName && this.app.vault.getAbstractFileByPath(notePath) instanceof TFile) {
      return new Promise((resolve) => {
        new ConfirmModal(
          this.app,
          "Replace note?",
          `"${notePath}" already exists. Replace it with this result?`,
          "Replace",
          () => void this.writeNote().then(resolve),
        ).open();
      });
    }
    return this.writeNote();
  }

  private async writeNote(): Promise<void> {
    const noteName = this.saveNoteNameInput.value.trim();
    if (!noteName) {
      this.saveStatusEl.setCssProps({ color: "var(--color-red)" });
      this.saveStatusEl.setText("Note name is required.");
      return;
    }

    const folder = normalizeFolder(this.saveResultsFolderInput.value.trim());
    const notePath = folder ? `${folder}/${noteName}.md` : `${noteName}.md`;

    if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
      try {
        await this.app.vault.createFolder(folder);
      } catch {
        /* may already exist */
      }
    }

    const noteContent = buildResultsNote(
      this.resultTextarea.value,
      { workflowPath: this.workflowFile.path, rolled: localIsoDateTime() },
      this.rollRecords(),
    );

    try {
      let savedFile: TFile;
      const existing = this.app.vault.getAbstractFileByPath(notePath);
      if (existing instanceof TFile) {
        await this.app.vault.process(existing, () => noteContent);
        savedFile = existing;
      } else {
        savedFile = await this.app.vault.create(notePath, noteContent);
      }
      this.close();
      await this.app.workspace.getLeaf("tab").openFile(savedFile);
    } catch (err) {
      this.saveStatusEl.setCssProps({ color: "var(--color-red)" });
      this.saveStatusEl.setText(`Error: ${String(err)}`);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
