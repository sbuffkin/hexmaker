import { ItemView, Notice, TFile, ViewStateResult, WorkspaceLeaf } from "obsidian";
import type DuckmagePlugin from "./DuckmagePlugin";
import { VIEW_TYPE_RANDOM_TABLES } from "./constants";
import { normalizeFolder, makeTableTemplate } from "./utils";
import { RandomTableEditorModal } from "./RandomTableEditorModal";
import {
	parseRandomTable,
	rollOnTable,
	getDieRanges,
	getOddsLabel,
	setDiceInFrontmatter,
	type RandomTable,
	type RandomTableEntry,
} from "./randomTable";

const DIE_OPTIONS = [
	{ label: "— no die —", value: 0 },
	{ label: "d4",  value: 4 },
	{ label: "d6",  value: 6 },
	{ label: "d8",  value: 8 },
	{ label: "d10", value: 10 },
	{ label: "d12", value: 12 },
	{ label: "d20", value: 20 },
	{ label: "d100", value: 100 },
];

interface FileNode  { type: "file";   file: TFile; }
interface FolderNode { type: "folder"; name: string; path: string; children: TreeNode[]; }
type TreeNode = FileNode | FolderNode;

export class RandomTableView extends ItemView {
	private listEl: HTMLElement | null = null;
	private detailEl: HTMLElement | null = null;
	private activeFile: TFile | null = null;
	private rollHistory: string[] = [];
	private collapsedFolders: Set<string> = new Set();
	private filterQuery = "";

	constructor(leaf: WorkspaceLeaf, private plugin: DuckmagePlugin) {
		super(leaf);
	}

	getViewType()    { return VIEW_TYPE_RANDOM_TABLES; }
	getDisplayText() { return "Random tables"; }
	getIcon()        { return "dice"; }

	async setState(state: any, result: ViewStateResult): Promise<void> {
		await super.setState(state, result);
		if (state?.filePath) {
			const file = this.app.vault.getAbstractFileByPath(state.filePath);
			if (file instanceof TFile) {
				await this.loadList();
				this.loadTable(file);
			}
		}
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("duckmage-rt-container");

		// ── Left column: table list ──────────────────────────────────────────
		const leftCol = contentEl.createDiv({ cls: "duckmage-rt-left" });

		const listHeader = leftCol.createDiv({ cls: "duckmage-rt-list-header" });
		listHeader.createEl("span", { text: "Tables", cls: "duckmage-rt-list-title" });
		const refreshBtn = listHeader.createEl("button", { text: "↺", cls: "duckmage-rt-icon-btn" });
		refreshBtn.title = "Refresh list";
		refreshBtn.addEventListener("click", () => this.loadList());

		const searchInput = leftCol.createEl("input", { type: "text", cls: "duckmage-rt-search" });
		searchInput.placeholder = "Filter tables…";
		searchInput.addEventListener("input", () => {
			this.filterQuery = searchInput.value.toLowerCase().trim();
			this.loadList();
		});

		this.listEl = leftCol.createDiv({ cls: "duckmage-rt-list" });

		const listFooter = leftCol.createDiv({ cls: "duckmage-rt-list-footer" });
		const newInput = listFooter.createEl("input", { type: "text", cls: "duckmage-rt-new-input" });
		newInput.placeholder = "New table name…";
		const newBtn = listFooter.createEl("button", { text: "+ New", cls: "duckmage-rt-new-btn" });

		const createTable = async () => {
			const name = newInput.value.trim();
			if (!name) return;
			const folder = normalizeFolder(this.plugin.settings.tablesFolder);
			const newPath = folder ? `${folder}/${name}.md` : `${name}.md`;
			let file = this.app.vault.getAbstractFileByPath(newPath);
			if (!(file instanceof TFile)) {
				try {
					if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
						await this.app.vault.createFolder(folder);
					}
					const rollerLink = this.plugin.buildRollerLink(newPath);
					file = await this.app.vault.create(newPath, makeTableTemplate(this.plugin.settings.defaultTableDice, 3, undefined, rollerLink));
				} catch (err) {
					new Notice(`Could not create ${newPath}: ${err}`);
					return;
				}
			}
			newInput.value = "";
			await this.loadList();
			this.loadTable(file as TFile);
		};

		newBtn.addEventListener("click", createTable);
		newInput.addEventListener("keydown", (e: KeyboardEvent) => { if (e.key === "Enter") createTable(); });

		// ── Right column: table detail ───────────────────────────────────────
		this.detailEl = contentEl.createDiv({ cls: "duckmage-rt-detail" });
		this.detailEl.createDiv({ cls: "duckmage-rt-placeholder", text: "Select a table to view and roll." });

		await this.loadList();
	}

	async onClose(): Promise<void> { this.contentEl.empty(); }

	// ── Public: open a specific table (called from hex editor / protocol handler) ──
	async openTable(filePath: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (file instanceof TFile) {
			await this.loadList();
			this.loadTable(file);
		}
	}

	// ── Tree building ─────────────────────────────────────────────────────────

	private buildTree(files: TFile[], prefix: string): TreeNode[] {
		const root: FolderNode = { type: "folder", name: "", path: "", children: [] };

		for (const file of files) {
			const rel = prefix ? file.path.slice(prefix.length) : file.path;
			const parts = rel.split("/");
			let current = root;
			for (let i = 0; i < parts.length - 1; i++) {
				const folderName = parts[i];
				const folderPath = parts.slice(0, i + 1).join("/");
				let child = current.children.find(
					(c): c is FolderNode => c.type === "folder" && c.name === folderName,
				);
				if (!child) {
					child = { type: "folder", name: folderName, path: folderPath, children: [] };
					current.children.push(child);
				}
				current = child;
			}
			current.children.push({ type: "file", file });
		}

		return root.children;
	}

	// ── List ─────────────────────────────────────────────────────────────────

	private async loadList(): Promise<void> {
		if (!this.listEl) return;
		this.listEl.empty();

		const folder = normalizeFolder(this.plugin.settings.tablesFolder);
		const prefix = folder ? folder + "/" : "";

		let files = this.app.vault.getMarkdownFiles()
			.filter(f => !prefix || f.path.startsWith(prefix))
			.sort((a, b) => a.path.localeCompare(b.path));

		if (this.filterQuery) {
			files = files.filter(f => {
				const rel = prefix ? f.path.slice(prefix.length) : f.path;
				return rel.toLowerCase().includes(this.filterQuery);
			});
		}

		if (files.length === 0) {
			this.listEl.createSpan({ text: "No tables found.", cls: "duckmage-rt-empty" });
			return;
		}

		const tree = this.buildTree(files, prefix);
		// When filtering, render flat (expand all) so matches aren't hidden inside collapsed folders
		this.renderTreeNodes(this.listEl, tree, this.filterQuery !== "");
	}

	private renderTreeNodes(container: HTMLElement, nodes: TreeNode[], forceExpanded: boolean): void {
		for (const node of nodes) {
			if (node.type === "folder") {
				const isCollapsed = !forceExpanded && this.collapsedFolders.has(node.path);

				const folderEl = container.createDiv({ cls: "duckmage-rt-folder" });
				const folderHeader = folderEl.createDiv({ cls: "duckmage-rt-folder-header" });
				const arrow = folderHeader.createSpan({
					cls: "duckmage-rt-folder-arrow",
					text: isCollapsed ? "▶" : "▼",
				});
				folderHeader.createSpan({ cls: "duckmage-rt-folder-name", text: node.name });

				const childrenEl = folderEl.createDiv({ cls: "duckmage-rt-folder-children" });
				if (isCollapsed) childrenEl.style.display = "none";

				this.renderTreeNodes(childrenEl, node.children, forceExpanded);

				folderHeader.addEventListener("click", () => {
					const nowCollapsed = !this.collapsedFolders.has(node.path);
					if (nowCollapsed) {
						this.collapsedFolders.add(node.path);
						childrenEl.style.display = "none";
						arrow.textContent = "▶";
					} else {
						this.collapsedFolders.delete(node.path);
						childrenEl.style.display = "";
						arrow.textContent = "▼";
					}
				});
			} else {
				const row = container.createDiv({ cls: "duckmage-rt-list-item" });
				if (node.file === this.activeFile) row.addClass("is-active");
				row.setText(node.file.basename);
				row.title = node.file.path;
				row.addEventListener("click", () => this.loadTable(node.file));
			}
		}
	}

	// ── Detail ────────────────────────────────────────────────────────────────

	private async loadTable(file: TFile): Promise<void> {
		this.activeFile = file;
		this.rollHistory = [];
		this.listEl?.querySelectorAll<HTMLElement>(".duckmage-rt-list-item").forEach(el => {
			el.toggleClass("is-active", el.title === file.path);
		});
		await this.renderDetail();
	}

	private async renderDetail(): Promise<void> {
		if (!this.detailEl || !this.activeFile) return;
		const file = this.activeFile;
		this.detailEl.empty();

		const content = await this.app.vault.read(file);
		const table = parseRandomTable(content);
		const ranges = table.dice > 0 ? getDieRanges(table) : null;

		// ── Header ─────────────────────────────────────────────────────────
		const header = this.detailEl.createDiv({ cls: "duckmage-rt-detail-header" });
		header.createEl("h3", { text: file.basename, cls: "duckmage-rt-detail-title" });

		const editLink = header.createEl("a", { text: "Edit", cls: "duckmage-rt-edit-link" });
		editLink.addEventListener("click", () => {
			new RandomTableEditorModal(this.app, file, () => this.renderDetail()).open();
		});

		const dieSelect = header.createEl("select", { cls: "duckmage-rt-die-select" });
		for (const opt of DIE_OPTIONS) {
			const o = dieSelect.createEl("option", { value: String(opt.value), text: opt.label });
			if (opt.value === table.dice) o.selected = true;
		}
		dieSelect.addEventListener("change", async () => {
			const newDice = parseInt(dieSelect.value, 10);
			const updated = setDiceInFrontmatter(await this.app.vault.read(file), newDice);
			await this.app.vault.modify(file, updated);
			await this.renderDetail();
		});

		// ── Odds table ─────────────────────────────────────────────────────
		if (table.entries.length === 0) {
			this.detailEl.createDiv({ cls: "duckmage-rt-empty", text: "No entries found. Check the table format." });
		} else {
			const tableEl = this.detailEl.createEl("table", { cls: "duckmage-random-table" });
			const thead = tableEl.createEl("thead");
			const headerRow = thead.createEl("tr");
			if (ranges) headerRow.createEl("th", { text: `d${table.dice}` });
			headerRow.createEl("th", { text: "Result" });
			headerRow.createEl("th", { text: "Odds" });

			const tbody = tableEl.createEl("tbody");
			table.entries.forEach((entry, i) => {
				const tr = tbody.createEl("tr");
				tr.dataset.index = String(i);
				if (ranges) tr.createEl("td", { text: ranges[i], cls: "duckmage-rt-range-cell" });
				tr.createEl("td", { text: entry.result });
				const pct = `${Math.round((entry.weight / table.entries.reduce((s, e) => s + e.weight, 0)) * 100)}%`;
				tr.createEl("td", { text: pct, cls: "duckmage-rt-odds-cell" });
			});
		}

		// ── Roll controls ──────────────────────────────────────────────────
		const rollArea = this.detailEl.createDiv({ cls: "duckmage-rt-roll-area" });
		const rollBtn = rollArea.createEl("button", { text: "Roll", cls: "duckmage-rt-roll-btn mod-cta" });

		const resultBox = this.detailEl.createDiv({ cls: "duckmage-roll-result" });
		resultBox.style.display = "none";
		const resultTextarea = resultBox.createEl("textarea", { cls: "duckmage-roll-result-textarea" });
		const resultBtns = resultBox.createDiv({ cls: "duckmage-roll-result-btns" });
		const copyBtn = resultBtns.createEl("button", { text: "Copy", cls: "duckmage-roll-copy-btn" });
		copyBtn.addEventListener("click", () => {
			navigator.clipboard.writeText(resultTextarea.value);
			copyBtn.setText("Copied!");
			setTimeout(() => copyBtn.setText("Copy"), 1500);
		});

		const historyEl = this.detailEl.createDiv({ cls: "duckmage-rt-history" });
		this.renderHistory(historyEl);

		rollBtn.addEventListener("click", () => {
			this.doRoll(table, resultBox, resultTextarea, historyEl);
		});
	}

	private doRoll(
		table: RandomTable,
		resultBox: HTMLElement,
		resultTextarea: HTMLTextAreaElement,
		historyEl: HTMLElement,
	): void {
		const entry = rollOnTable(table);
		if (!entry) return;

		this.detailEl?.querySelectorAll(".duckmage-random-table tbody tr").forEach(tr => {
			tr.toggleClass("is-rolled", tr.textContent?.includes(entry.result) ?? false);
		});

		resultBox.style.display = "";
		resultTextarea.value = entry.result;
		resultTextarea.focus();

		this.rollHistory.unshift(entry.result);
		if (this.rollHistory.length > 5) this.rollHistory.pop();
		this.renderHistory(historyEl);
	}

	private renderHistory(historyEl: HTMLElement): void {
		historyEl.empty();
		if (this.rollHistory.length === 0) return;
		historyEl.createEl("p", { text: "Recent rolls:", cls: "duckmage-rt-history-label" });
		const list = historyEl.createEl("ul", { cls: "duckmage-rt-history-list" });
		for (const result of this.rollHistory) {
			const li = list.createEl("li", { cls: "duckmage-rt-history-item" });
			li.createSpan({ text: result });
			const copyIcon = li.createEl("button", { text: "⎘", cls: "duckmage-rt-history-copy" });
			copyIcon.title = "Copy";
			copyIcon.addEventListener("click", () => navigator.clipboard.writeText(result));
		}
	}
}
