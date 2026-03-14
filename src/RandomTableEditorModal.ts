import { App, Modal, TFile } from "obsidian";
import { parseRandomTable } from "./randomTable";
import type { RandomTableEntry } from "./randomTable";

/**
 * Modal editor for a random table file.
 * Shows existing entries as editable rows and allows adding new ones.
 * Saves back to the file, preserving frontmatter.
 */
export class RandomTableEditorModal extends Modal {
	// Held so onClose can flush a pending "add row" entry and save it
	private flushAndSave: (() => Promise<void>) | null = null;
	private dragInitialized = false;

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

		// ── Filter settings ───────────────────────────────────────────────
		const filterSection = contentEl.createDiv({ cls: "duckmage-table-editor-filter-section" });
		const rollFilterRow = filterSection.createDiv({ cls: "duckmage-table-editor-filter-row" });
		const rollFilterCb = rollFilterRow.createEl("input", { type: "checkbox" });
		rollFilterCb.checked = this.parseFrontmatterBool(frontmatter, "roll-filter") === false;
		rollFilterRow.createEl("label", { text: "Exclude from roll picker" });

		const encFilterRow = filterSection.createDiv({ cls: "duckmage-table-editor-filter-row" });
		const encFilterCb = encFilterRow.createEl("input", { type: "checkbox" });
		encFilterCb.checked = this.parseFrontmatterBool(frontmatter, "encounter-filter") === false;
		encFilterRow.createEl("label", { text: "Exclude from encounters table" });

		// ── Existing rows ─────────────────────────────────────────────────
		contentEl.createEl("p", { text: "Entries", cls: "duckmage-table-editor-heading" });
		const rowsEl = contentEl.createDiv({ cls: "duckmage-table-editor-rows" });

		let dragSrcIndex = -1;

		const autoResize = (el: HTMLTextAreaElement) => {
			el.style.height = "auto";
			el.style.height = `${el.scrollHeight}px`;
		};

		const renderRows = () => {
			rowsEl.empty();
			if (entries.length === 0) {
				rowsEl.createSpan({ text: "No entries yet.", cls: "duckmage-rt-empty" });
				return;
			}
			for (let i = 0; i < entries.length; i++) {
				const entry = entries[i];
				const row = rowsEl.createDiv({ cls: "duckmage-table-editor-row" });
				row.draggable = true;

				const handle = row.createSpan({ cls: "duckmage-table-editor-drag-handle", text: "⠿" });
				handle.title = "Drag to reorder";

				const resultInput = row.createEl("textarea", { cls: "duckmage-table-editor-result" });
				resultInput.value = entry.result;
				resultInput.placeholder = "Result…";
				resultInput.rows = 1;
				// Size to content immediately, then keep in sync as the user types
				requestAnimationFrame(() => autoResize(resultInput));
				resultInput.addEventListener("input", () => {
					entries[i].result = resultInput.value;
					autoResize(resultInput);
				});

				const weightInput = row.createEl("input", { type: "number", cls: "duckmage-table-editor-weight" });
				weightInput.value = String(entry.weight);
				weightInput.min = "1";
				weightInput.addEventListener("input", () => {
					entries[i].weight = Math.max(1, parseInt(weightInput.value, 10) || 1);
				});

				const delBtn = row.createEl("button", { text: "×", cls: "duckmage-table-editor-del" });
				delBtn.title = "Remove row";
				delBtn.addEventListener("click", () => { entries.splice(i, 1); renderRows(); });

				row.addEventListener("dragstart", (e: DragEvent) => {
					dragSrcIndex = i;
					row.addClass("duckmage-table-editor-dragging");
					e.dataTransfer?.setDragImage(row, 0, 0);
				});
				row.addEventListener("dragend", () => {
					row.removeClass("duckmage-table-editor-dragging");
					rowsEl.querySelectorAll(".duckmage-table-editor-drop-target").forEach(el =>
						el.classList.remove("duckmage-table-editor-drop-target"),
					);
				});
				row.addEventListener("dragover", (e: DragEvent) => {
					e.preventDefault();
					rowsEl.querySelectorAll(".duckmage-table-editor-drop-target").forEach(el =>
						el.classList.remove("duckmage-table-editor-drop-target"),
					);
					row.addClass("duckmage-table-editor-drop-target");
				});
				row.addEventListener("dragleave", () => {
					row.removeClass("duckmage-table-editor-drop-target");
				});
				row.addEventListener("drop", (e: DragEvent) => {
					e.preventDefault();
					if (dragSrcIndex === -1 || dragSrcIndex === i) return;
					const [moved] = entries.splice(dragSrcIndex, 1);
					entries.splice(i, 0, moved);
					dragSrcIndex = -1;
					renderRows();
				});
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
		// Expose so onClose always saves all changes (flushes pending "add row" text first)
		this.flushAndSave = async () => {
			doAdd(); // flush pending "add row" text if any (no-op if empty)
			let updatedFm = this.setFrontmatterBool(frontmatter, "roll-filter",
				rollFilterCb.checked ? false : undefined);
			updatedFm = this.setFrontmatterBool(updatedFm, "encounter-filter",
				encFilterCb.checked ? false : undefined);
			const newContent = this.buildContent(updatedFm, preamble, entries);
			try {
				await this.app.vault.modify(this.file, newContent);
				this.onSaved?.();
			} catch { /* best-effort */ }
		};

		addBtn.addEventListener("click", doAdd);
		// Enter submits; Shift+Enter inserts a newline
		newResult.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doAdd(); }
		});

		// ── Footer: Close (auto-saves on close) ───────────────────────────
		const footer = contentEl.createDiv({ cls: "duckmage-table-editor-footer" });

		footer.createEl("button", { text: "Close", cls: "mod-cta" }).addEventListener("click", () => this.close());

		this.makeDraggable();
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
			// Only drag from the native modal header — the strip above .modal-content
			const modalContent = modal.querySelector<HTMLElement>(".modal-content");
			if (modalContent && e.clientY >= modalContent.getBoundingClientRect().top) return;
			if ((e.target as HTMLElement).closest("button, a")) return;

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

	onClose(): void {
		// If the user typed something in "Add row" and closed without clicking Add,
		// flush it and save so the entry isn't lost.
		void this.flushAndSave?.();
		this.flushAndSave = null;
		this.contentEl.empty();
	}

	/** Read a `key: true|false` line from a frontmatter block string. Returns undefined if absent. */
	private parseFrontmatterBool(frontmatter: string, key: string): boolean | undefined {
		const m = frontmatter.match(new RegExp(`^${key}:\\s*(true|false)\\s*$`, "m"));
		if (!m) return undefined;
		return m[1] === "true";
	}

	/**
	 * Set, remove, or update a boolean key in a frontmatter block string.
	 * If value is undefined the key line is removed.
	 * If the key doesn't exist and value is not undefined, it is inserted before the closing `---`.
	 */
	private setFrontmatterBool(frontmatter: string, key: string, value: boolean | undefined): string {
		const lineRegex = new RegExp(`^${key}:.*$`, "m");
		const hasKey = lineRegex.test(frontmatter);
		if (value === undefined) {
			if (!hasKey) return frontmatter;
			// Remove the line (and any trailing newline)
			return frontmatter.replace(new RegExp(`^${key}:.*\\n?`, "m"), "");
		}
		const line = `${key}: ${value}`;
		if (hasKey) {
			return frontmatter.replace(lineRegex, line);
		}
		// Insert before closing ---
		return frontmatter.replace(/\n---$/, `\n${line}\n---`);
	}

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
