import { App, Modal, Notice, TFile } from "obsidian";
import { parseRandomTable } from "./randomTable";
import type { RandomTableEntry } from "./randomTable";

/**
 * Modal editor for a random table file.
 * Shows existing entries as editable rows and allows adding new ones.
 * Saves back to the file, preserving frontmatter.
 */
export class RandomTableEditorModal extends Modal {
	constructor(
		app: App,
		private file: TFile,
		private onSaved?: () => void,
	) {
		super(app);
	}

	async onOpen(): Promise<void> {
		this.titleEl.setText(`Edit: ${this.file.basename}`);
		const { contentEl } = this;
		contentEl.addClass("duckmage-table-editor");

		const rawContent = await this.app.vault.read(this.file);
		const table = parseRandomTable(rawContent);
		const frontmatter = this.extractFrontmatter(rawContent);
		const preamble = this.extractPreamble(rawContent, frontmatter);

		// Working copy so edits don't mutate until Save
		const entries: RandomTableEntry[] = table.entries.map(e => ({ ...e }));

		// ── Existing rows ─────────────────────────────────────────────────
		contentEl.createEl("p", { text: "Entries", cls: "duckmage-table-editor-heading" });
		const rowsEl = contentEl.createDiv({ cls: "duckmage-table-editor-rows" });

		const renderRows = () => {
			rowsEl.empty();
			if (entries.length === 0) {
				rowsEl.createSpan({ text: "No entries yet.", cls: "duckmage-rt-empty" });
				return;
			}
			for (let i = 0; i < entries.length; i++) {
				const entry = entries[i];
				const row = rowsEl.createDiv({ cls: "duckmage-table-editor-row" });

				const resultInput = row.createEl("textarea", { cls: "duckmage-table-editor-result" });
				resultInput.value = entry.result;
				resultInput.placeholder = "Result…";
				resultInput.rows = 1;
				resultInput.addEventListener("input", () => { entries[i].result = resultInput.value; });

				const weightInput = row.createEl("input", { type: "number", cls: "duckmage-table-editor-weight" });
				weightInput.value = String(entry.weight);
				weightInput.min = "1";
				weightInput.addEventListener("input", () => {
					entries[i].weight = Math.max(1, parseInt(weightInput.value, 10) || 1);
				});

				const delBtn = row.createEl("button", { text: "×", cls: "duckmage-table-editor-del" });
				delBtn.title = "Remove row";
				delBtn.addEventListener("click", () => { entries.splice(i, 1); renderRows(); });
			}
		};
		renderRows();

		// ── Add new row ───────────────────────────────────────────────────
		contentEl.createEl("p", { text: "Add row", cls: "duckmage-table-editor-heading" });
		const addRow = contentEl.createDiv({ cls: "duckmage-table-editor-add-row" });

		const newResult = addRow.createEl("textarea", { cls: "duckmage-table-editor-result" });
		newResult.placeholder = "New result…";
		newResult.rows = 1;

		const newWeight = addRow.createEl("input", { type: "number", cls: "duckmage-table-editor-weight" });
		newWeight.value = "1";
		newWeight.min = "1";

		const addBtn = addRow.createEl("button", { text: "Add", cls: "duckmage-table-editor-add-btn mod-cta" });

		const doAdd = () => {
			const result = newResult.value.trim();
			if (!result) return;
			const weight = Math.max(1, parseInt(newWeight.value, 10) || 1);
			entries.push({ result, weight });
			newResult.value = "";
			newWeight.value = "1";
			renderRows();
			newResult.focus();
		};
		addBtn.addEventListener("click", doAdd);
		// Ctrl+Enter / Cmd+Enter adds the row; plain Enter inserts a newline in the textarea
		newResult.addEventListener("keydown", (e: KeyboardEvent) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doAdd(); } });

		// ── Footer: Save ──────────────────────────────────────────────────
		const footer = contentEl.createDiv({ cls: "duckmage-table-editor-footer" });
		const saveBtn = footer.createEl("button", { text: "Save", cls: "mod-cta" });
		saveBtn.addEventListener("click", async () => {
			const newContent = this.buildContent(frontmatter, preamble, entries);
			try {
				await this.app.vault.modify(this.file, newContent);
				this.onSaved?.();
				this.close();
			} catch (e) {
				new Notice("Could not save: " + (e instanceof Error ? e.message : String(e)));
			}
		});
	}

	onClose(): void { this.contentEl.empty(); }

	private extractFrontmatter(content: string): string {
		const match = content.match(/^---\n[\s\S]*?\n---/);
		return match ? match[0] : "";
	}

	private extractPreamble(content: string, frontmatter: string): string {
		const afterFm = frontmatter ? content.slice(frontmatter.length) : content;
		// Find first markdown table row (line starting with |)
		const tableMatch = afterFm.match(/^[ \t]*\|/m);
		if (!tableMatch || tableMatch.index === undefined) return "";
		return afterFm.slice(0, tableMatch.index).trim();
	}

	private buildContent(frontmatter: string, preamble: string, entries: RandomTableEntry[]): string {
		const rows = entries.map(e => `| ${e.result} | ${e.weight} |`).join("\n");
		const tableBlock = `| Result | Weight |\n|--------|--------|\n${rows}`;
		const parts: string[] = [];
		if (frontmatter) parts.push(frontmatter);
		if (preamble) parts.push(preamble);
		parts.push(tableBlock);
		return parts.join("\n\n") + "\n";
	}
}
