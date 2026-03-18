import { App, Modal, TFile, Notice } from "obsidian";
import type DuckmagePlugin from "./DuckmagePlugin";
import { normalizeFolder } from "./utils";
import {
	parseWorkflow,
	buildWorkflowContent,
	generateDefaultTemplate,
	requiredPlaceholders,
	stepPlaceholder,
	stepVarName,
	type WorkflowStep,
} from "./workflow";

/** Convert a table basename to a default label: spaces → underscores. */
function labelFromBasename(basename: string): string {
	return basename.replace(/ /g, "_");
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class WorkflowEditorModal extends Modal {
	private flushAndSave: (() => Promise<void>) | null = null;
	private dragInitialized = false;

	constructor(
		app: App,
		private plugin: DuckmagePlugin,
		private file: TFile,
		private onSaved?: () => void,
		private preloaded?: { content: string; templateContent: string },
	) {
		super(app);
	}

	async onOpen(): Promise<void> {
		this.titleEl.setText(`Edit workflow: ${this.file.basename}`);
		const { contentEl } = this;
		contentEl.addClass("duckmage-wf-editor");

		const rawContent = this.preloaded?.content ?? await this.app.vault.read(this.file);
		const workflow = parseWorkflow(rawContent, this.file.basename);

		// Working copies
		const steps: WorkflowStep[] = workflow.steps.map(s => ({ ...s }));
		let resultsFolder = workflow.resultsFolder ?? "";
		let templateContent = "";

		// Load template file if it exists
		if (this.preloaded !== undefined) {
			templateContent = this.preloaded.templateContent;
		} else if (workflow.templateFile) {
			const tmplFile = this.app.vault.getAbstractFileByPath(workflow.templateFile);
			if (tmplFile instanceof TFile) {
				templateContent = await this.app.vault.read(tmplFile);
			}
		}
		if (!templateContent) {
			templateContent = generateDefaultTemplate(steps);
		}

		// All table files in the tables folder for the picker
		const tablesFolder = normalizeFolder(this.plugin.settings.tablesFolder);
		const tableFiles = this.app.vault.getMarkdownFiles()
			.filter(f => !tablesFolder || f.path.startsWith(tablesFolder + "/"))
			.filter(f => !f.basename.startsWith("_"))
			.sort((a, b) => a.path.localeCompare(b.path));

		// ── Name row ─────────────────────────────────────────────────────
		const nameRow = contentEl.createDiv({ cls: "duckmage-table-editor-name-row" });
		nameRow.createEl("label", { text: "Name", cls: "duckmage-table-editor-name-label" });
		const nameInput = nameRow.createEl("input", { type: "text", cls: "duckmage-table-editor-name-input" });
		nameInput.value = this.file.basename;

		const doRename = async () => {
			const newName = nameInput.value.trim();
			if (!newName || newName === this.file.basename) return;
			const dir = this.file.path.slice(0, this.file.path.length - this.file.name.length);
			const newPath = dir + newName + ".md";
			try {
				await this.app.fileManager.renameFile(this.file, newPath);
				this.titleEl.setText(`Edit workflow: ${this.file.basename}`);
				this.onSaved?.();
			} catch {
				nameInput.value = this.file.basename;
			}
		};
		nameInput.addEventListener("blur", doRename);
		nameInput.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter") { e.preventDefault(); nameInput.blur(); }
			if (e.key === "Escape") { nameInput.value = this.file.basename; nameInput.blur(); }
		});

		// ── Steps section ────────────────────────────────────────────────
		contentEl.createEl("p", { text: "Steps", cls: "duckmage-table-editor-heading" });
		const stepsEl = contentEl.createDiv({ cls: "duckmage-wf-editor-steps" });

		// ── Add step area (inputs row + button row) ───────────────────────
		contentEl.createEl("p", { text: "Add step", cls: "duckmage-table-editor-heading" });
		const addArea = contentEl.createDiv({ cls: "duckmage-wf-editor-add-area" });
		const addRow = addArea.createDiv({ cls: "duckmage-wf-editor-step-row" });

		// ── Results folder row ────────────────────────────────────────────
		const rfRow = contentEl.createDiv({ cls: "duckmage-table-editor-name-row" });
		rfRow.style.marginTop = "8px";
		rfRow.createEl("label", { text: "Results folder", cls: "duckmage-table-editor-name-label" });
		const rfInput = rfRow.createEl("input", { type: "text", cls: "duckmage-table-editor-name-input" });
		rfInput.placeholder = "world/results";
		rfInput.value = resultsFolder;
		rfInput.addEventListener("input", () => { resultsFolder = normalizeFolder(rfInput.value.trim()); });

		// ── Template section ──────────────────────────────────────────────
		contentEl.createEl("p", { text: "Template", cls: "duckmage-table-editor-heading" });
		const templateArea = contentEl.createEl("textarea", { cls: "duckmage-wf-template-area" });
		templateArea.value = templateContent;
		templateArea.addEventListener("input", () => { templateContent = templateArea.value; updateValidation(); });

		const validationEl = contentEl.createDiv();
		validationEl.style.marginTop = "4px";
		validationEl.style.fontSize = "0.85em";

		// ── Validation + helpers (declared here so renderSteps can call them) ──

		const updateValidation = () => {
			const required = requiredPlaceholders(steps);
			const missing = required.filter(p => !templateContent.includes(p));
			if (missing.length === 0) {
				validationEl.className = "duckmage-wf-validation-ok";
				validationEl.setText(required.length > 0 ? "✓ All placeholders present" : "");
			} else {
				validationEl.className = "duckmage-wf-validation-err";
				validationEl.setText(`Missing: ${missing.join(", ")}`);
			}
		};

		const getTemplateLabel = (step: WorkflowStep): string =>
			step.label || labelFromBasename(step.tablePath.split("/").pop() ?? step.tablePath);

		const syncLabelInTemplate = (oldLabel: string, newLabel: string): void => {
			if (!oldLabel || oldLabel === newLabel) return;
			templateContent = templateContent.replace(
				new RegExp(`^## ${escapeRegex(oldLabel)}$`, "m"),
				`## ${newLabel}`,
			);
			templateArea.value = templateContent;
			updateValidation();
		};

		const appendStepToTemplate = (step: WorkflowStep): void => {
			const label = getTemplateLabel(step);
			const lines: string[] = [`## ${label}`, ""];
			for (let r = 0; r < step.rolls; r++) {
				lines.push(stepPlaceholder(step, r));
			}
			lines.push("");
			templateContent = templateContent.trimEnd() + "\n\n" + lines.join("\n");
			templateArea.value = templateContent;
			updateValidation();
		};

		const syncRollsInTemplate = (step: WorkflowStep, oldRolls: number, newRolls: number): void => {
			if (newRolls === oldRolls) return;
			const varName = stepVarName(step);

			if (newRolls > oldRolls) {
				if (oldRolls === 1) {
					// Replace single $varname with $varname_1 … $varname_newRolls
					const singleEscaped = escapeRegex(`$${varName}`);
					const newText = Array.from({ length: newRolls }, (_, i) => `$${varName}_${i + 1}`).join("\n");
					templateContent = templateContent.replace(
						new RegExp(singleEscaped + "(?!_\\d)", "g"),
						newText,
					);
				} else {
					// Append new placeholder(s) after the last existing one
					const lastPlaceholder = `$${varName}_${oldRolls}`;
					const addedText = Array.from({ length: newRolls - oldRolls }, (_, i) => `$${varName}_${oldRolls + i + 1}`).join("\n");
					templateContent = templateContent.replace(
						new RegExp(escapeRegex(lastPlaceholder), "g"),
						`${lastPlaceholder}\n${addedText}`,
					);
				}
			} else {
				// Decreasing: remove placeholders that are now out of range
				if (newRolls === 1) {
					// Remove _2 … _oldRolls lines, then replace $varname_1 with $varname
					for (let r = oldRolls; r >= 2; r--) {
						const ph = escapeRegex(`$${varName}_${r}`);
						templateContent = templateContent.replace(new RegExp(`\n?${ph}`, "g"), "");
					}
					templateContent = templateContent.replace(
						new RegExp(escapeRegex(`$${varName}_1`), "g"),
						`$${varName}`,
					);
				} else {
					// Remove _newRolls+1 … _oldRolls lines
					for (let r = oldRolls; r > newRolls; r--) {
						const ph = escapeRegex(`$${varName}_${r}`);
						templateContent = templateContent.replace(new RegExp(`\n?${ph}`, "g"), "");
					}
				}
			}
			templateArea.value = templateContent;
			updateValidation();
		};

		// ── Step rendering ────────────────────────────────────────────────
		let dragSrcIndex = -1;

		const renderSteps = () => {
			stepsEl.empty();
			if (steps.length === 0) {
				stepsEl.createSpan({ text: "No steps yet.", cls: "duckmage-rt-empty" });
			}
			for (let i = 0; i < steps.length; i++) {
				const step = steps[i];
				const row = stepsEl.createDiv({ cls: "duckmage-wf-editor-step-row" });
				row.draggable = true;

				const handle = row.createSpan({ cls: "duckmage-table-editor-drag-handle", text: "⠿" });
				handle.title = "Drag to reorder";

				// Table picker
				const tableSelect = row.createEl("select");
				tableSelect.createEl("option", { value: "", text: "— select table —" });
				for (const tf of tableFiles) {
					const val = tf.path.slice(0, -3);
					const optLabel = tablesFolder ? tf.path.slice(tablesFolder.length + 1, -3) : val;
					const opt = tableSelect.createEl("option", { value: val, text: optLabel });
					if (val === step.tablePath) opt.selected = true;
				}
				if (step.tablePath && !tableFiles.some(tf => tf.path.slice(0, -3) === step.tablePath)) {
					const opt = tableSelect.createEl("option", { value: step.tablePath, text: step.tablePath });
					opt.selected = true;
				}
				tableSelect.addEventListener("change", () => {
					steps[i].tablePath = tableSelect.value;
					const newAutoLabel = labelFromBasename(tableSelect.value.split("/").pop() ?? tableSelect.value);
					const oldLabel = prevLabel;
					labelInput.value = newAutoLabel;
					steps[i].label = newAutoLabel || undefined;
					syncLabelInTemplate(oldLabel, newAutoLabel);
					prevLabel = newAutoLabel;
					updateValidation();
				});

				// Rolls input
				const rollsInput = row.createEl("input", { type: "number" });
				rollsInput.min = "1";
				rollsInput.value = String(step.rolls);
				rollsInput.style.width = "52px";
				rollsInput.title = "Number of rolls";
				rollsInput.addEventListener("input", () => {
					const oldRolls = steps[i].rolls;
					const newRolls = Math.max(1, parseInt(rollsInput.value, 10) || 1);
					steps[i].rolls = newRolls;
					syncRollsInTemplate(steps[i], oldRolls, newRolls);
					updateValidation();
				});

				// Label input — syncs with template heading on change
				const labelInput = row.createEl("input", { type: "text" });
				labelInput.placeholder = "Label…";
				labelInput.value = step.label ?? "";
				labelInput.style.flex = "1";
				let prevLabel = getTemplateLabel(step);
				labelInput.addEventListener("input", () => {
					const newLabel = labelInput.value.trim() || labelFromBasename(step.tablePath.split("/").pop() ?? step.tablePath);
					syncLabelInTemplate(prevLabel, newLabel);
					prevLabel = newLabel;
					steps[i].label = labelInput.value.trim() || undefined;
				});

				// Delete button
				const delBtn = row.createEl("button", { text: "×", cls: "duckmage-table-editor-del" });
				delBtn.title = "Remove step";
				delBtn.addEventListener("click", () => {
					steps.splice(i, 1);
					renderSteps();
					updateValidation();
				});

				// Drag-and-drop
				row.addEventListener("dragstart", (e: DragEvent) => {
					dragSrcIndex = i;
					row.addClass("duckmage-table-editor-dragging");
					e.dataTransfer?.setDragImage(row, 0, 0);
				});
				row.addEventListener("dragend", () => {
					row.removeClass("duckmage-table-editor-dragging");
					stepsEl.querySelectorAll(".duckmage-table-editor-drop-target").forEach(el =>
						el.classList.remove("duckmage-table-editor-drop-target"));
				});
				row.addEventListener("dragover", (e: DragEvent) => {
					e.preventDefault();
					stepsEl.querySelectorAll(".duckmage-table-editor-drop-target").forEach(el =>
						el.classList.remove("duckmage-table-editor-drop-target"));
					row.addClass("duckmage-table-editor-drop-target");
				});
				row.addEventListener("dragleave", () => {
					row.removeClass("duckmage-table-editor-drop-target");
				});
				row.addEventListener("drop", (e: DragEvent) => {
					e.preventDefault();
					if (dragSrcIndex === -1 || dragSrcIndex === i) return;
					const [moved] = steps.splice(dragSrcIndex, 1);
					steps.splice(i, 0, moved);
					dragSrcIndex = -1;
					renderSteps();
					updateValidation();
				});
			}
		};

		// ── Populate add-step row controls ────────────────────────────────
		const addTableSelect = addRow.createEl("select");
		addTableSelect.createEl("option", { value: "", text: "— select table —" });
		for (const tf of tableFiles) {
			const val = tf.path.slice(0, -3);
			const optLabel = tablesFolder ? tf.path.slice(tablesFolder.length + 1, -3) : val;
			addTableSelect.createEl("option", { value: val, text: optLabel });
		}

		const addRollsInput = addRow.createEl("input", { type: "number" });
		addRollsInput.min = "1";
		addRollsInput.value = "1";
		addRollsInput.style.width = "52px";
		addRollsInput.title = "Number of rolls";

		const addLabelInput = addRow.createEl("input", { type: "text" });
		addLabelInput.placeholder = "Label (auto)…";
		addLabelInput.style.flex = "1";

		// Auto-fill label from table name when picker changes
		addTableSelect.addEventListener("change", () => {
			if (!addLabelInput.value.trim() && addTableSelect.value) {
				const basename = addTableSelect.value.split("/").pop() ?? addTableSelect.value;
				addLabelInput.value = labelFromBasename(basename);
			}
		});

		const addBtnRow = addArea.createDiv({ cls: "duckmage-wf-editor-add-btn-row" });
		const addBtn = addBtnRow.createEl("button", { text: "Add step", cls: "mod-cta" });
		addBtn.addEventListener("click", () => {
			const tablePath = addTableSelect.value;
			if (!tablePath) return;
			const rolls = Math.max(1, parseInt(addRollsInput.value, 10) || 1);
			const rawLabel = addLabelInput.value.trim();
			const autoLabel = labelFromBasename(tablePath.split("/").pop() ?? tablePath);
			const label = rawLabel || autoLabel;
			steps.push({ tablePath, rolls, label });
			addTableSelect.value = "";
			addRollsInput.value = "1";
			addLabelInput.value = "";
			renderSteps();
			appendStepToTemplate(steps[steps.length - 1]);
		});

		renderSteps();
		updateValidation();

		// ── Footer ────────────────────────────────────────────────────────
		const footer = contentEl.createDiv({ cls: "duckmage-table-editor-footer" });

		this.flushAndSave = async () => {
			const wfFolder = normalizeFolder(this.plugin.settings.workflowsFolder);
			const templatePath = `${wfFolder}/templates/${this.file.basename}.md`;

			const updatedWorkflow = {
				name: this.file.basename,
				resultsFolder: resultsFolder || undefined,
				templateFile: templatePath,
				steps,
			};

			try {
				await this.app.vault.modify(this.file, buildWorkflowContent(updatedWorkflow));

				const templateDir = `${wfFolder}/templates`;
				if (!this.app.vault.getAbstractFileByPath(templateDir)) {
					try { await this.app.vault.createFolder(templateDir); } catch { /* may exist */ }
				}
				const tmplFile = this.app.vault.getAbstractFileByPath(templatePath);
				if (tmplFile instanceof TFile) {
					await this.app.vault.modify(tmplFile, templateContent);
				} else {
					await this.app.vault.create(templatePath, templateContent);
				}

				this.onSaved?.();
			} catch (err) {
				new Notice(`Could not save workflow: ${err}`);
			}
		};

		footer.createEl("button", { text: "Close", cls: "mod-cta" }).addEventListener("click", () => this.close());

		this.makeDraggable();
	}

	onClose(): void {
		void this.flushAndSave?.();
		this.flushAndSave = null;
		this.contentEl.empty();
	}

	private makeDraggable(): void {
		if (this.dragInitialized) return;
		this.dragInitialized = true;

		const modal = this.modalEl;
		modal.addClass("duckmage-editor-modal-drag");
		modal.style.position = "absolute";
		modal.style.left = "50%";
		modal.style.top = "50%";
		modal.style.transform = "translate(-50%, -50%)";
		modal.style.margin = "0";

		modal.addEventListener("mousedown", (e: MouseEvent) => {
			const modalContent = modal.querySelector<HTMLElement>(".modal-content");
			if (modalContent && e.clientY >= modalContent.getBoundingClientRect().top) return;
			if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) return;

			e.preventDefault();
			const r = modal.getBoundingClientRect();
			modal.style.transform = "none";
			modal.style.left = `${r.left}px`;
			modal.style.top = `${r.top}px`;
			const sx = e.clientX, sy = e.clientY;
			const ox = r.left, oy = r.top;
			const onMove = (ev: MouseEvent) => {
				modal.style.left = `${ox + ev.clientX - sx}px`;
				modal.style.top  = `${oy + ev.clientY - sy}px`;
			};
			const onUp = () => {
				document.removeEventListener("mousemove", onMove);
				document.removeEventListener("mouseup", onUp);
			};
			document.addEventListener("mousemove", onMove);
			document.addEventListener("mouseup", onUp);
		});
	}
}
