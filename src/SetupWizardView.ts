import { App, ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type HexmakerPlugin from "./HexmakerPlugin";
import type { HexMapView } from "./hex-map/HexMapView";
import { normalizeFolder, slugify } from "./utils";
import { VIEW_TYPE_SETUP_WIZARD, VIEW_TYPE_HEX_MAP } from "./constants";
import { fillPaletteSelect } from "./palettes/paletteOptions";
import { MAP_KINDS, enabledKinds, type MapKind } from "./mapKinds";
import { SPACE_SECTOR_PALETTE_NAME } from "./palettes/presets";

// ─── Types ────────────────────────────────────────────────────────────────────

type FolderKey =
	| "hexFolder"
	| "townsFolder"
	| "dungeonsFolder"
	| "questsFolder"
	| "featuresFolder"
	| "factionsFolder"
	| "regionsFolder"
	| "tablesFolder"
	| "workflowsFolder"
	| "iconsFolder";

interface WizardContext {
	worldFolder: string;
	useAdvanced: boolean;
	advancedFolders: Partial<Record<FolderKey, string>>;
	mapName: string;
	mapCols: number;
	mapRows: number;
	paletteName: string;
	hexOrientation: "flat" | "pointy";
	/** Map types to enable (src/mapKinds.ts). */
	mapKinds: MapKind[];
}

interface WizardCallbacks {
	onUpdate(): void;
	onComplete(openMap: boolean): Promise<void>;
}

interface WizardStep {
	id: string;
	title: string;
	render(container: HTMLElement, ctx: WizardContext, cb: WizardCallbacks): void;
	canProceed(ctx: WizardContext): boolean;
	onNext?(
		ctx: WizardContext,
		plugin: HexmakerPlugin,
		onProgress: (msg: string) => void,
	): Promise<void>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FOLDER_KEYS: Array<{ key: FolderKey; label: string; suffix: string }> = [
	{ key: "hexFolder",       label: "Hex notes",  suffix: "hexes" },
	{ key: "townsFolder",     label: "Towns",      suffix: "towns" },
	{ key: "dungeonsFolder",  label: "Dungeons",   suffix: "dungeons" },
	{ key: "questsFolder",    label: "Quests",     suffix: "quests" },
	{ key: "featuresFolder",  label: "Features",   suffix: "features" },
	{ key: "factionsFolder",  label: "Factions",   suffix: "factions" },
	{ key: "regionsFolder",   label: "Regions",    suffix: "regions" },
	{ key: "tablesFolder",    label: "Tables",     suffix: "tables" },
	{ key: "workflowsFolder", label: "Workflows",  suffix: "workflows" },
	{ key: "iconsFolder",     label: "Icons",      suffix: "icons" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function ensureFolder(app: App, path: string): Promise<void> {
	if (!app.vault.getAbstractFileByPath(path)) {
		try {
			await app.vault.createFolder(path);
		} catch {
			// race: folder created between check and call
		}
	}
}

// ─── Step 1 — Welcome ─────────────────────────────────────────────────────────

function makeWelcomeStep(): WizardStep {
	return {
		id: "welcome",
		title: "Welcome to Hexmaker!",
		render(container, ctx, cbs) {
			container.createEl("p", {
				text: "Hexmaker turns your Obsidian vault into a living, interactive hex map. Each hex on the map is a Markdown note — you can paint terrain, add icons, link towns, dungeons, factions, and encounter tables, and run random tables right from the map.",
				cls: "duckmage-wizard-text",
			});
			container.createEl("p", {
				text: "In the next few steps we'll set up your world folders, pick a layout for your first map, and generate all the hex notes. It takes about a minute.",
				cls: "duckmage-wizard-text",
			});
			container.createEl("p", {
				text: "This panel doesn't block anything — feel free to click around Obsidian, browse the file tree, or create folders while it's open.",
				cls: "duckmage-wizard-text duckmage-wizard-tip",
			});

			// What kinds of maps? Drives which palettes, generators and icon
			// packs are offered. Changeable later in settings → Map types.
			const kinds = container.createDiv({ cls: "duckmage-wizard-field duckmage-wizard-kinds" });
			kinds.createEl("label", { text: "What will you map?", cls: "duckmage-wizard-label" });
			for (const k of MAP_KINDS) {
				const row = kinds.createEl("label", { cls: "duckmage-wizard-kind" });
				const cb = row.createEl("input", { type: "checkbox" });
				cb.checked = ctx.mapKinds.includes(k.id);
				const text = row.createDiv();
				text.createDiv({ text: k.label, cls: "duckmage-wizard-kind-title" });
				text.createDiv({ text: k.description, cls: "duckmage-wizard-kind-desc" });
				cb.addEventListener("change", () => {
					ctx.mapKinds = MAP_KINDS.map((m) => m.id).filter((id) =>
						id === k.id ? cb.checked : ctx.mapKinds.includes(id));
					cbs.onUpdate();
				});
			}
		},
		canProceed: (ctx) => ctx.mapKinds.length > 0,
		async onNext(ctx, plugin) {
			plugin.settings.mapKinds = [...ctx.mapKinds];
			// Space only: start the first map as a sector chart.
			if (!ctx.mapKinds.includes("world") && ctx.mapKinds.includes("space")) {
				ctx.paletteName = SPACE_SECTOR_PALETTE_NAME;
			}
			await plugin.saveSettings();
			plugin.onMapKindsChanged();
		},
	};
}

// ─── Step 2 — Folder setup ────────────────────────────────────────────────────

function makeFolderStep(): WizardStep {
	return {
		id: "folders",
		title: "Where should your world live?",
		render(container, ctx, cb) {
			container.createEl("p", {
				text: "All your hex notes, tables, factions, and world data will live under one folder. Type a name — it'll be created automatically if it doesn't exist.",
				cls: "duckmage-wizard-text",
			});

			// World folder input
			const folderRow = container.createDiv({ cls: "duckmage-wizard-field" });
			folderRow.createEl("label", { text: "World folder", cls: "duckmage-wizard-label" });
			const folderInput = folderRow.createEl("input", {
				type: "text",
				placeholder: "world",
				cls: "duckmage-wizard-input",
			});
			folderInput.value = ctx.worldFolder;

			// Subfolder preview
			const previewWrap = container.createDiv({ cls: "duckmage-wizard-preview-wrap" });
			const previewLabel = previewWrap.createEl("p", {
				text: "Subfolders that will be created:",
				cls: "duckmage-wizard-preview-label",
			});
			const previewList = previewWrap.createEl("ul", { cls: "duckmage-wizard-preview-list" });

			// Advanced toggle
			const advRow = container.createDiv({ cls: "duckmage-wizard-advanced-row" });
			const advCheckbox = advRow.createEl("input", { type: "checkbox" });
			advCheckbox.checked = ctx.useAdvanced;
			advRow.createEl("label", {
				text: "Configure each folder path individually",
				cls: "duckmage-wizard-advanced-label",
			});
			advCheckbox.addEventListener("change", () => {
				ctx.useAdvanced = advCheckbox.checked;
				if (ctx.useAdvanced) {
					advSection.show();
					previewLabel.setText("Folder paths:");
				} else {
					advSection.hide();
					previewLabel.setText("Subfolders that will be created:");
				}
				syncAdvancedInputs();
				refreshPreview();
				cb.onUpdate();
			});

			// Advanced section (individual folder inputs)
			const advSection = container.createDiv({ cls: "duckmage-wizard-advanced-section" });
			if (!ctx.useAdvanced) advSection.hide();

			const advInputs: Partial<Record<FolderKey, HTMLInputElement>> = {};
			for (const { key, label } of FOLDER_KEYS) {
				const row = advSection.createDiv({ cls: "duckmage-wizard-field" });
				row.createEl("label", { text: label, cls: "duckmage-wizard-label" });
				const inp = row.createEl("input", {
					type: "text",
					cls: "duckmage-wizard-input duckmage-wizard-input-sm",
				});
				advInputs[key] = inp;
				inp.addEventListener("input", () => {
					ctx.advancedFolders[key] = inp.value.trim();
					refreshPreview();
					cb.onUpdate();
				});
			}

			function syncAdvancedInputs() {
				const world = normalizeFolder(ctx.worldFolder) || "world";
				for (const { key, suffix } of FOLDER_KEYS) {
					const inp = advInputs[key];
					if (!inp) continue;
					const current = ctx.advancedFolders[key];
					if (!current) {
						inp.value = `${world}/${suffix}`;
						ctx.advancedFolders[key] = inp.value;
					}
				}
			}

			function refreshPreview() {
				const world = normalizeFolder(ctx.worldFolder) || "world";
				previewList.empty();
				for (const { key, suffix } of FOLDER_KEYS) {
					const path = ctx.useAdvanced
						? (ctx.advancedFolders[key] || `${world}/${suffix}`)
						: `${world}/${suffix}`;
					previewList.createEl("li", { text: path, cls: "duckmage-wizard-preview-item" });
				}
			}

			folderInput.addEventListener("input", () => {
				ctx.worldFolder = folderInput.value.trim();
				if (!ctx.useAdvanced) syncAdvancedInputs();
				refreshPreview();
				cb.onUpdate();
			});

			// Initial render
			syncAdvancedInputs();
			refreshPreview();
		},
		canProceed(ctx) {
			if (!ctx.worldFolder.trim()) return false;
			if (ctx.useAdvanced) {
				return FOLDER_KEYS.every(({ key }) => !!ctx.advancedFolders[key]?.trim());
			}
			return true;
		},
		async onNext(ctx, plugin) {
			const world = normalizeFolder(ctx.worldFolder) || "world";
			plugin.settings.worldFolder = world;
			await ensureFolder(plugin.app, world);
			for (const { key, suffix } of FOLDER_KEYS) {
				const path = ctx.useAdvanced
					? normalizeFolder(ctx.advancedFolders[key] ?? "") || `${world}/${suffix}`
					: `${world}/${suffix}`;
				(plugin.settings as unknown as Record<string, unknown>)[key] = path;
				await ensureFolder(plugin.app, path);
			}
			await plugin.saveSettings();
			// Create the hex template file if it doesn't already exist
			await plugin.ensureHexTemplate();
		},
	};
}

// ─── Step 3 — Map creation ────────────────────────────────────────────────────

function makeMapStep(plugin: HexmakerPlugin): WizardStep {
	return {
		id: "map",
		title: "Create your first map",
		render(container, ctx, cb) {
			container.createEl("p", {
				text: "Give your map a name and choose how big it should be. You can always expand the grid or add more maps later.",
				cls: "duckmage-wizard-text",
			});

			// Map name
			const nameRow = container.createDiv({ cls: "duckmage-wizard-field" });
			nameRow.createEl("label", { text: "Map name", cls: "duckmage-wizard-label" });
			const nameInput = nameRow.createEl("input", {
				type: "text",
				placeholder: "my-world",
				cls: "duckmage-wizard-input",
			});
			nameInput.value = ctx.mapName;
			nameInput.addEventListener("input", () => {
				ctx.mapName = nameInput.value.trim();
				cb.onUpdate();
			});

			// Grid size
			const sizeRow = container.createDiv({ cls: "duckmage-wizard-field" });
			sizeRow.createEl("label", { text: "Grid size", cls: "duckmage-wizard-label" });
			const sizeInputs = sizeRow.createDiv({ cls: "duckmage-wizard-size-inputs" });
			const colsInput = sizeInputs.createEl("input", {
				type: "number",
				cls: "duckmage-wizard-input-num",
			});
			colsInput.value = String(ctx.mapCols);
			colsInput.min = "2";
			colsInput.max = "200";
			sizeInputs.createSpan({ text: "columns × ", cls: "duckmage-wizard-size-sep" });
			const rowsInput = sizeInputs.createEl("input", {
				type: "number",
				cls: "duckmage-wizard-input-num",
			});
			rowsInput.value = String(ctx.mapRows);
			rowsInput.min = "2";
			rowsInput.max = "200";
			sizeInputs.createSpan({ text: " rows", cls: "duckmage-wizard-size-sep" });

			const noteCount = sizeRow.createEl("p", { cls: "duckmage-wizard-note-count" });
			const updateCount = () => {
				const n = ctx.mapCols * ctx.mapRows;
				noteCount.setText(`This will create ${n.toLocaleString()} hex note${n !== 1 ? "s" : ""} in your vault.`);
			};
			updateCount();

			colsInput.addEventListener("input", () => {
				ctx.mapCols = Math.max(2, Number(colsInput.value) || 20);
				updateCount();
				cb.onUpdate();
			});
			rowsInput.addEventListener("input", () => {
				ctx.mapRows = Math.max(2, Number(rowsInput.value) || 16);
				updateCount();
				cb.onUpdate();
			});

			// Hex orientation
			const orientRow = container.createDiv({ cls: "duckmage-wizard-field" });
			orientRow.createEl("label", { text: "Hex orientation", cls: "duckmage-wizard-label" });
			const orientBtns = orientRow.createDiv({ cls: "duckmage-wizard-orient-row" });

			for (const { value, label, desc } of [
				{ value: "flat"   as const, label: "Flat-top",   desc: "Flat sides face north and south — wider hexes" },
				{ value: "pointy" as const, label: "Pointy-top", desc: "Points face north and south — taller hexes" },
			]) {
				const btn = orientBtns.createDiv({
					cls: "duckmage-wizard-orient-btn" + (ctx.hexOrientation === value ? " is-active" : ""),
				});
				btn.createSpan({ text: label, cls: "duckmage-wizard-orient-label" });
				btn.createSpan({ text: desc,  cls: "duckmage-wizard-orient-desc" });
				btn.addEventListener("click", () => {
					ctx.hexOrientation = value;
					orientBtns
						.querySelectorAll<HTMLElement>(".duckmage-wizard-orient-btn")
						.forEach(el => el.removeClass("is-active"));
					btn.addClass("is-active");
				});
			}

			// Terrain palette
			const paletteRow = container.createDiv({ cls: "duckmage-wizard-field" });
			paletteRow.createEl("label", { text: "Terrain palette", cls: "duckmage-wizard-label" });
			const paletteSelect = paletteRow.createEl("select", { cls: "duckmage-wizard-select" });
			fillPaletteSelect(plugin, paletteSelect, ctx.paletteName);
			paletteSelect.addEventListener("change", () => {
				ctx.paletteName = paletteSelect.value;
			});

			// Progress display (populated by onNext)
			container.createDiv({
				cls: "duckmage-wizard-progress-msg",
				attr: { id: "duckmage-wizard-gen-progress" },
			});
		},
		canProceed(ctx) {
			return slugify(ctx.mapName).length > 0;
		},
		async onNext(ctx, plugin, onProgress) {
			const name = slugify(ctx.mapName);
			if (!name) return;

			plugin.settings.hexOrientation = ctx.hexOrientation;

			// Remove the placeholder "default" map if it has no vault folder yet
			const hexBase = normalizeFolder(plugin.settings.hexFolder);
			const hasDefaultFolder = !!plugin.app.vault.getAbstractFileByPath(
				hexBase ? `${hexBase}/default` : "default",
			);
			if (!hasDefaultFolder) {
				plugin.settings.maps = plugin.settings.maps.filter(m => m.name !== "default");
			}

			// Create map folder and register in settings
			const folderPath = hexBase ? `${hexBase}/${name}` : name;
			await ensureFolder(plugin.app, folderPath);

			await plugin.ensurePaletteInstalled(ctx.paletteName);
			if (!plugin.settings.maps.find(m => m.name === name)) {
				plugin.settings.maps.push({
					name,
					paletteName: ctx.paletteName,
					gridSize: { cols: ctx.mapCols, rows: ctx.mapRows },
					gridOffset: { x: 0, y: 0 },
					pathChains: [],
				});
			}
			plugin.settings.defaultMap = name;
			await plugin.saveSettings();

			// Generate hex notes with progress feedback
			const total = ctx.mapCols * ctx.mapRows;
			const xs = Array.from({ length: ctx.mapCols }, (_, i) => i);
			const ys = Array.from({ length: ctx.mapRows }, (_, i) => i);
			onProgress(`Generating hex notes 0 / ${total}…`);
			await plugin.generateHexNotes(name, xs, ys, (done) => {
				onProgress(`Generating hex notes ${done} / ${total}…`);
			});

			// Generate terrain description/encounters tables (and the generic
			// landmark/hidden/secret ones) + the [Roll] preamble. Without this
			// step the user has a map but no tables — they'd have to hunt the
			// settings tab for "Generate terrain tables & hex links".
			//
			// We skip backfillTerrainLinks here because freshly-generated hexes
			// have no terrain painted yet, so it's a no-op; syncHexEncounterTableLink
			// wires up the link automatically when the user paints terrain later.
			onProgress("Generating terrain tables…");
			await plugin.ensureTerrainTables();
			onProgress("Adding roller links…");
			await plugin.ensureAllRollerLinks();
			onProgress("");
		},
	};
}

// ─── Step 4 — Done ────────────────────────────────────────────────────────────

function makeDoneStep(): WizardStep {
	return {
		id: "done",
		title: "You're ready to explore!",
		render(container, ctx, cb) {
			container.createEl("p", {
				text: "Your world is all set up. Here's a summary of what was created:",
				cls: "duckmage-wizard-text",
			});

			const summary = container.createEl("ul", { cls: "duckmage-wizard-summary" });
			const world = normalizeFolder(ctx.worldFolder) || "world";
			const name = slugify(ctx.mapName) || ctx.mapName;
			summary.createEl("li", { text: `World folder: ${world}` });
			summary.createEl("li", { text: `Map: "${name}" — ${ctx.mapCols} × ${ctx.mapRows} (${(ctx.mapCols * ctx.mapRows).toLocaleString()} hex notes)` });
			summary.createEl("li", { text: `Hex orientation: ${ctx.hexOrientation === "flat" ? "Flat-top" : "Pointy-top"}` });
			summary.createEl("li", { text: `Terrain palette: ${ctx.paletteName}` });
			summary.createEl("li", { text: "Description and encounter tables for every terrain (auto-linked when you paint terrain)" });

			container.createEl("p", {
				text: "A few things to try first:",
				cls: "duckmage-wizard-text",
			});

			const tips = container.createEl("ul", { cls: "duckmage-wizard-tips" });
			for (const tip of [
				"Paint terrain — the terrain picker opens automatically when you hit \"Open hex map\". Pick a type and click hexes to paint.",
				"Right-click any hex to open its full editor: add towns, dungeons, notes, and more.",
				"Open the 🎲 tab to browse and roll your random tables.",
				"Use the toolbar to paint icons, draw roads or rivers, and link factions.",
			]) {
				tips.createEl("li", { text: tip, cls: "duckmage-wizard-tip-item" });
			}

			container.createEl("p", {
				text: "The map icon in the left ribbon opens your hex map any time. Folders, palettes, and more can be adjusted under plugin settings.",
				cls: "duckmage-wizard-text duckmage-wizard-tip",
			});

			const ctaRow = container.createDiv({ cls: "duckmage-wizard-cta-row" });
			const openBtn = ctaRow.createEl("button", {
				text: "Open hex map",
				cls: "mod-cta duckmage-wizard-open-btn",
			});
			openBtn.addEventListener("click", () => void cb.onComplete(true));

			const exploreBtn = ctaRow.createEl("button", {
				text: "I'll explore on my own",
				cls: "duckmage-wizard-skip-btn",
			});
			exploreBtn.addEventListener("click", () => void cb.onComplete(false));
		},
		// Final step — Next button is hidden; CTAs are inline
		canProceed: () => false,
	};
}

// ─── View ─────────────────────────────────────────────────────────────────────

export class SetupWizardView extends ItemView {
	private plugin: HexmakerPlugin;
	private ctx: WizardContext;
	private steps: WizardStep[];
	private currentIndex = 0;

	constructor(leaf: WorkspaceLeaf, plugin: HexmakerPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.ctx = {
			worldFolder: plugin.settings.worldFolder || "world",
			useAdvanced: false,
			advancedFolders: {},
			mapName: "",
			mapCols: 20,
			mapRows: 16,
			paletteName: plugin.settings.terrainPalettes[0]?.name ?? "Limited",
			hexOrientation: plugin.settings.hexOrientation ?? "flat",
			mapKinds: [...enabledKinds(plugin.settings)],
		};
		this.steps = [
			makeWelcomeStep(),
			makeFolderStep(),
			makeMapStep(plugin),
			makeDoneStep(),
		];
	}

	getViewType() { return VIEW_TYPE_SETUP_WIZARD; }
	getDisplayText() { return "Hexmaker setup"; }
	getIcon() { return "map"; }

	async onOpen() {
		this.renderView();
	}

	async onClose() {
		this.contentEl.empty();
	}

	private renderView() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("duckmage-setup-wizard");

		// Header: plugin title + progress dots + step counter
		const header = contentEl.createDiv({ cls: "duckmage-wizard-header" });
		header.createEl("p", { text: "Hexmaker setup", cls: "duckmage-wizard-title" });
		const dotRow = header.createDiv({ cls: "duckmage-wizard-dots" });
		for (let i = 0; i < this.steps.length; i++) {
			dotRow.createDiv({
				cls: [
					"duckmage-wizard-dot",
					i < this.currentIndex  ? "is-done" : "",
					i === this.currentIndex ? "is-current" : "",
				].filter(Boolean).join(" "),
			});
		}
		header.createEl("p", {
			text: `Step ${this.currentIndex + 1} of ${this.steps.length}`,
			cls: "duckmage-wizard-step-label",
		});

		// Step title
		const step = this.steps[this.currentIndex];
		contentEl.createEl("h2", { text: step.title, cls: "duckmage-wizard-step-title" });

		// Step content
		const stepContent = contentEl.createDiv({ cls: "duckmage-wizard-step-content" });
		const cb: WizardCallbacks = {
			onUpdate: () => this.updateNextBtn(),
			onComplete: (openMap) => this.complete(openMap),
		};
		step.render(stepContent, this.ctx, cb);

		// Nav row (hidden on final step — that step renders its own CTAs)
		const isFinal = this.currentIndex === this.steps.length - 1;
		if (!isFinal) {
			const navRow = contentEl.createDiv({ cls: "duckmage-wizard-nav" });

			const backBtn = navRow.createEl("button", {
				text: "← back",
				cls: "duckmage-wizard-back-btn",
			});
			backBtn.disabled = this.currentIndex === 0;
			backBtn.addEventListener("click", () => {
				if (this.currentIndex > 0) {
					this.currentIndex--;
					this.renderView();
				}
			});

			navRow.createSpan({ cls: "duckmage-wizard-nav-progress" });

			const nextBtn = navRow.createEl("button", {
				text: "Next →",
				cls: "mod-cta duckmage-wizard-next-btn",
			});
			nextBtn.disabled = !step.canProceed(this.ctx);
			nextBtn.addEventListener("click", () => void this.handleNext(nextBtn, backBtn));
		}

		// Footer: dismiss links (every step)
		const footer = contentEl.createDiv({ cls: "duckmage-wizard-footer" });
		const remindBtn = footer.createEl("button", {
			text: "Remind me later",
			cls: "duckmage-wizard-dismiss-btn",
		});
		remindBtn.addEventListener("click", () => this.leaf.detach());

		footer.createSpan({ text: "·", cls: "duckmage-wizard-footer-sep" });

		const dontShowBtn = footer.createEl("button", {
			text: "Don't show again",
			cls: "duckmage-wizard-dismiss-btn",
		});
		dontShowBtn.addEventListener("click", () => {
			this.plugin.settings.setupDismissed = true;
			void this.plugin.saveSettings().then(() => this.leaf.detach());
		});
	}

	private updateNextBtn() {
		const step = this.steps[this.currentIndex];
		const btn = this.contentEl.querySelector<HTMLButtonElement>(".duckmage-wizard-next-btn");
		if (btn) btn.disabled = !step.canProceed(this.ctx);
	}

	private async handleNext(nextBtn: HTMLButtonElement, backBtn: HTMLButtonElement) {
		const step = this.steps[this.currentIndex];
		if (!step.canProceed(this.ctx)) return;

		if (step.onNext) {
			nextBtn.disabled = true;
			backBtn.disabled = true;
			nextBtn.setText("Working…");

			const progressEl = this.contentEl.querySelector<HTMLElement>("#duckmage-wizard-gen-progress");
			const navProgressEl = this.contentEl.querySelector<HTMLElement>(".duckmage-wizard-nav-progress");

			try {
				await step.onNext(this.ctx, this.plugin, (msg) => {
					if (progressEl) progressEl.setText(msg);
					else if (navProgressEl) navProgressEl.setText(msg);
				});
			} catch (e) {
				new Notice(`Hexmaker setup error: ${e instanceof Error ? e.message : String(e)}`);
				nextBtn.setText("Next →");
				nextBtn.disabled = false;
				backBtn.disabled = false;
				return;
			}
		}

		this.currentIndex++;
		this.renderView();
	}

	private async complete(openMap: boolean) {
		this.plugin.settings.setupComplete = true;
		await this.plugin.saveSettings();
		if (openMap) {
			const leaf = this.app.workspace.getLeaf("tab");
			await leaf.setViewState({ type: VIEW_TYPE_HEX_MAP });
			(leaf.view as HexMapView).openTerrainPicker();
		}
		this.leaf.detach();
	}
}
