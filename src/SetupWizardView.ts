import { App, ItemView, Notice, TFolder, WorkspaceLeaf } from "obsidian";
import type HexmakerPlugin from "./HexmakerPlugin";
import type { HexMapView } from "./hex-map/HexMapView";
import type { TerrainColor } from "./types";
import { normalizeFolder, slugify } from "./utils";
import { VIEW_TYPE_SETUP_WIZARD, VIEW_TYPE_HEX_MAP } from "./constants";
import { defaultPaletteFor, fillPaletteSelect } from "./palettes/paletteOptions";
import { MAP_KINDS, enabledKinds, isSpacePalette, type MapKind } from "./mapKinds";
import { randomSeed } from "../packages/hex-wfc/src";
import { drawPreview, PREVIEW_AUTO_LIMIT } from "./worldgen/preview";
import { pathColors } from "./worldgen/generators";
import {
	BLANK_ID,
	firstMapGenerator,
	kindsForPalette,
	listGeneratorKinds,
	suggestBaseTerrain,
	visibleKinds,
	type GenerateOutcome,
	type TerrainGeneratorKind,
} from "./worldgen/registry";
import { PLACEHOLDER_MAP_NAME, isUnusedPlaceholderMap } from "./setupPlaceholder";

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
	/** Generator for the first map (registry id); undefined = pick the
	 *  default for the map types and palette (firstMapGenerator). */
	generatorId?: string;
	generatorOptions: Record<string, string>;
	seed: number;
	/** Label of the generator the map was made with (summary); undefined = blank. */
	generatedWith?: string;
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

function wizardGrid(plugin: HexmakerPlugin, ctx: WizardContext) {
	return {
		cols: ctx.mapCols,
		rows: ctx.mapRows,
		offset: { x: 0, y: 0 },
		stagger: plugin.settings.staggerOffset ?? "odd",
	};
}

function resolvedOptions(kind: TerrainGeneratorKind, ctx: WizardContext): Record<string, string> {
	const out: Record<string, string> = {};
	for (const o of kind.options) out[o.key] = ctx.generatorOptions[o.key] ?? o.default;
	return out;
}

/**
 * Run the chosen generator for the wizard's map. Generators read the hex
 * orientation from settings, which the wizard only saves on Next, so the
 * picked orientation is applied for the (synchronous) run.
 */
function runGenerator(
	plugin: HexmakerPlugin,
	ctx: WizardContext,
	kind: TerrainGeneratorKind,
	terrains: TerrainColor[],
): GenerateOutcome {
	const saved = plugin.settings.hexOrientation;
	plugin.settings.hexOrientation = ctx.hexOrientation;
	try {
		return kind.generate({ terrains, grid: wizardGrid(plugin, ctx), seed: ctx.seed, options: resolvedOptions(kind, ctx) });
	} finally {
		plugin.settings.hexOrientation = saved;
	}
}

/** Generators to offer for the wizard's palette, and the one to select. */
function wizardKinds(
	kinds: TerrainGeneratorKind[],
	ctx: WizardContext,
	terrains: TerrainColor[],
): { fitting: TerrainGeneratorKind[]; selected: string } {
	const shown = visibleKinds(kinds, { mapKinds: ctx.mapKinds }, isSpacePalette(terrains), ctx.generatorId);
	const fitting = kindsForPalette(shown, terrains);
	const selected = ctx.generatorId && fitting.some((k) => k.id === ctx.generatorId)
		? ctx.generatorId
		: firstMapGenerator(fitting, ctx.mapKinds);
	return { fitting, selected };
}

/**
 * Remove the shipped "default" map once the user has their own, if it was
 * never used (see setupPlaceholder.ts). Settings are saved by the caller.
 */
async function removeUnusedPlaceholder(plugin: HexmakerPlugin, keep: string): Promise<void> {
	if (keep === PLACEHOLDER_MAP_NAME) return;
	const map = plugin.getMap(PLACEHOLDER_MAP_NAME);
	if (!map) return;
	const folder = plugin.app.vault.getAbstractFileByPath(plugin.mapStore.mapFolder(PLACEHOLDER_MAP_NAME));
	const others = plugin.settings.maps.filter((m) => m.name !== PLACEHOLDER_MAP_NAME);
	const referenced = others.some((m) =>
		m.parent?.map === PLACEHOLDER_MAP_NAME ||
		[...plugin.mapStore.all(m.name).values()].some((h) => h.submap === PLACEHOLDER_MAP_NAME));
	const unused = isUnusedPlaceholderMap(map, {
		hexCount: plugin.mapStore.all(PLACEHOLDER_MAP_NAME).size,
		folderEntries: folder instanceof TFolder ? folder.children.map((c) => c.name) : [],
		referenced,
	});
	if (!unused) return;
	plugin.settings.maps = others;
	plugin.mapStore.forgetMap(PLACEHOLDER_MAP_NAME);
	if (folder instanceof TFolder) {
		try {
			await plugin.app.fileManager.trashFile(folder);
		} catch {
			// Leave the empty folder; the map itself is gone from the list.
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
				text: "In the next few steps we'll set up your world folders, pick a layout for your first map, and generate its terrain. It takes about a minute.",
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
			// Start the first map on a palette of a chosen map type: Space
			// only → a sector chart (Space - Sector, installed on create).
			const palIsSpace = isSpacePalette(plugin.getPaletteOrPresetTerrains(ctx.paletteName));
			if (palIsSpace ? !ctx.mapKinds.includes("space") : !ctx.mapKinds.includes("world")) {
				ctx.paletteName = defaultPaletteFor(plugin.settings);
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
			// The whole row is the checkbox's <label>, so the text names it
			// (screen readers, label clicks).
			const advRow = container.createEl("label", { cls: "duckmage-wizard-advanced-row" });
			const advCheckbox = advRow.createEl("input", { type: "checkbox" });
			advCheckbox.checked = ctx.useAdvanced;
			advRow.createSpan({
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
				text: "Give your map a name, choose how big it should be, and how to fill it. You can always expand the grid, repaint, or add more maps later.",
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
				attr: { "aria-label": "Columns" },
			});
			colsInput.value = String(ctx.mapCols);
			colsInput.min = "2";
			colsInput.max = "200";
			sizeInputs.createSpan({ text: "columns × ", cls: "duckmage-wizard-size-sep" });
			const rowsInput = sizeInputs.createEl("input", {
				type: "number",
				cls: "duckmage-wizard-input-num",
				attr: { "aria-label": "Rows" },
			});
			rowsInput.value = String(ctx.mapRows);
			rowsInput.min = "2";
			rowsInput.max = "200";
			sizeInputs.createSpan({ text: " rows", cls: "duckmage-wizard-size-sep" });

			const noteCount = sizeRow.createEl("p", { cls: "duckmage-wizard-note-count" });
			const updateCount = () => {
				const n = ctx.mapCols * ctx.mapRows;
				noteCount.setText(`${n.toLocaleString()} hex${n !== 1 ? "es" : ""}. The map is one note; a hex gets its own note when you first add something to it.`);
			};
			updateCount();

			colsInput.addEventListener("change", () => {
				ctx.mapCols = Math.max(2, Math.min(200, Number(colsInput.value) || 20));
				updateCount();
				refresh();
				cb.onUpdate();
			});
			rowsInput.addEventListener("change", () => {
				ctx.mapRows = Math.max(2, Math.min(200, Number(rowsInput.value) || 16));
				updateCount();
				refresh();
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
					refresh();
				});
			}

			// Terrain palette
			const paletteRow = container.createDiv({ cls: "duckmage-wizard-field" });
			paletteRow.createEl("label", { text: "Terrain palette", cls: "duckmage-wizard-label" });
			const paletteSelect = paletteRow.createEl("select", { cls: "duckmage-wizard-select" });
			fillPaletteSelect(plugin, paletteSelect, ctx.paletteName);
			paletteSelect.addEventListener("change", () => {
				ctx.paletteName = paletteSelect.value;
				renderGenerators();
				refresh();
			});

			// Terrain: generator choice + small live preview. The same
			// generators as Maps → New map → Guided setup (src/worldgen/registry.ts).
			const genField = container.createDiv({ cls: "duckmage-wizard-field duckmage-wizard-generator" });
			genField.createEl("label", { text: "Terrain", cls: "duckmage-wizard-label" });
			const genBody = genField.createDiv({ cls: "duckmage-wizard-generator-body" });
			const genSide = genBody.createDiv({ cls: "duckmage-wizard-generator-choices" });
			const genList = genSide.createDiv({ cls: "duckmage-setup-generators", text: "Loading generators…" });
			const optsBox = genSide.createDiv({ cls: "duckmage-wizard-generator-options" });
			const previewBox = genBody.createDiv({ cls: "duckmage-wizard-generator-preview" });
			const canvas = previewBox.createEl("canvas", { cls: "duckmage-setup-canvas" });
			const rerollBtn = previewBox.createEl("button", { text: "🎲 Re-roll", attr: { title: "Generate again with a new random seed" } });
			const status = previewBox.createDiv({ cls: "duckmage-setup-status" });
			rerollBtn.addEventListener("click", () => { ctx.seed = randomSeed(); refresh(); });

			let kinds: TerrainGeneratorKind[] = [];
			const terrains = () => plugin.getPaletteOrPresetTerrains(ctx.paletteName);

			const renderGenerators = () => {
				if (!kinds.length) return;
				const { fitting, selected } = wizardKinds(kinds, ctx, terrains());
				if (selected !== ctx.generatorId) {
					ctx.generatorId = selected;
					ctx.generatorOptions = {};
				}
				genList.empty();
				for (const k of fitting) {
					const card = genList.createEl("button", { cls: `duckmage-setup-gen${k.id === ctx.generatorId ? " is-active" : ""}` });
					card.createDiv({ cls: "duckmage-setup-gen-title", text: k.label + (k.source === "learned" ? " (learned)" : "") });
					card.createDiv({ cls: "duckmage-setup-gen-desc", text: k.description });
					card.addEventListener("click", () => {
						ctx.generatorId = k.id;
						ctx.generatorOptions = {};
						renderGenerators();
						refresh();
					});
				}
				optsBox.empty();
				const kind = kinds.find((k) => k.id === ctx.generatorId);
				for (const opt of kind?.options ?? []) {
					const row = optsBox.createEl("label", { cls: "duckmage-wizard-generator-option" });
					row.createSpan({ text: opt.label });
					const sel = row.createEl("select");
					for (const c of opt.choices) sel.createEl("option", { value: c.value, text: c.label });
					sel.value = ctx.generatorOptions[opt.key] ?? opt.default;
					sel.addEventListener("change", () => { ctx.generatorOptions[opt.key] = sel.value; refresh(); });
				}
			};

			const refresh = () => {
				const kind = kinds.find((k) => k.id === ctx.generatorId);
				const pal = terrains();
				const grid = wizardGrid(plugin, ctx);
				status.empty();
				status.removeClass("mod-warning");
				let cells = new Map<string, string>();
				let paths: { type: string; route?: string; hexes: string[] }[] = [];
				let featureCells: Set<string> | undefined;
				if (kind && kind.id !== BLANK_ID) {
					if (ctx.mapCols * ctx.mapRows > PREVIEW_AUTO_LIMIT) {
						status.setText("Large map — no preview; terrain is generated when you continue.");
					} else {
						const outcome = runGenerator(plugin, ctx, kind, pal);
						if (!outcome.ok) {
							status.setText(outcome.message);
							status.addClass("mod-warning");
						} else {
							cells = outcome.cells;
							paths = outcome.paths;
							featureCells = outcome.featureCells;
							if (outcome.warnings.length) status.setText(outcome.warnings.join(" "));
						}
					}
				} else if (kind) {
					status.setText("A blank map to paint by hand.");
				}
				const base = suggestBaseTerrain(pal);
				if (base) {
					for (let i = 0; i < ctx.mapCols; i++)
						for (let j = 0; j < ctx.mapRows; j++) {
							const k = `${i}_${j}`;
							if (!cells.has(k)) cells.set(k, base);
						}
				}
				rerollBtn.toggle(!!kind && kind.id !== BLANK_ID);
				drawPreview(canvas, cells, grid, ctx.hexOrientation, new Map(pal.map((t) => [t.name, t.color])),
					featureCells, paths, pathColors(plugin), 240, 12);
			};

			void listGeneratorKinds(plugin).then((k) => {
				kinds = k;
				renderGenerators();
				refresh();
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
			if (plugin.getMap(name)) throw new Error(`a map named "${name}" already exists. Pick another name.`);

			plugin.settings.hexOrientation = ctx.hexOrientation;

			// Generate the terrain the preview showed (same seed and options).
			const terrains = plugin.getPaletteOrPresetTerrains(ctx.paletteName);
			const kinds = await listGeneratorKinds(plugin);
			const { selected } = wizardKinds(kinds, ctx, terrains);
			const kind = kinds.find((k) => k.id === selected);
			let outcome: GenerateOutcome | undefined;
			if (kind && kind.id !== BLANK_ID) {
				onProgress(`Generating terrain (${kind.label})…`);
				outcome = runGenerator(plugin, ctx, kind, terrains);
				if (!outcome.ok) throw new Error(outcome.message);
			}

			// The map is one map note: terrain goes there, and hex notes
			// appear as hexes get content (createNewMap installs a preset
			// palette such as Space - Sector on first use).
			onProgress("Creating the map…");
			const result = await plugin.createNewMap(
				name,
				ctx.mapCols,
				ctx.mapRows,
				ctx.paletteName,
				0,
				0,
				plugin.settings.staggerOffset,
				undefined,
				outcome?.ok ? outcome.cells : undefined,
				{ baseTerrain: suggestBaseTerrain(terrains), quiet: true },
			);
			if ("error" in result) throw new Error(result.error);

			// Generated paths (jump routes…) become map path chains.
			if (outcome?.ok && outcome.paths.length && kind) {
				const map = plugin.getMap(result.name);
				const { chains } = kind.toChains(outcome.paths);
				if (map && chains.length) map.pathChains.push(...chains);
			}
			ctx.generatedWith = outcome?.ok ? kind?.label : undefined;
			plugin.settings.defaultMap = result.name;
			// The shipped "default" map is clutter now that there's a real one.
			await removeUnusedPlaceholder(plugin, result.name);
			await plugin.saveSettings();

			// Generate terrain description/encounters tables (and the generic
			// landmark/hidden/secret ones) + the [Roll] preamble. Without this
			// step the user has a map but no tables — they'd have to hunt the
			// settings tab for "Generate terrain tables & hex links".
			//
			// We skip backfillTerrainLinks here: there are no hex notes yet
			// (they're created on use), and syncHexEncounterTableLink wires up
			// the link when a hex note is created or its terrain painted.
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
			summary.createEl("li", { text: `Map: "${name}" — ${ctx.mapCols} × ${ctx.mapRows}, ${ctx.generatedWith ? `terrain generated with ${ctx.generatedWith}` : "blank, ready to paint"}` });
			summary.createEl("li", { text: `Map note: _${name}.md in the map folder holds the terrain and paths; a hex gets its own note when you first add something to it` });
			summary.createEl("li", { text: `Hex orientation: ${ctx.hexOrientation === "flat" ? "Flat-top" : "Pointy-top"}` });
			summary.createEl("li", { text: `Terrain palette: ${ctx.paletteName}` });
			summary.createEl("li", { text: "Description and encounter tables for every terrain (auto-linked when you paint terrain)" });

			container.createEl("p", {
				text: "A few things to try first:",
				cls: "duckmage-wizard-text",
			});

			const tips = container.createEl("ul", { cls: "duckmage-wizard-tips" });
			for (const tip of [
				ctx.generatedWith
					? "Repaint anything you like: open Terrain in the drawing tools, pick a type and click hexes."
					: "Paint terrain — the terrain picker opens automatically when you hit \"Open hex map\". Pick a type and click hexes to paint.",
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
			paletteName: defaultPaletteFor(plugin.settings),
			hexOrientation: plugin.settings.hexOrientation ?? "flat",
			mapKinds: [...enabledKinds(plugin.settings)],
			generatorOptions: {},
			seed: randomSeed(),
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
			// A blank map starts in the terrain picker; a generated one is shown as is.
			if (!this.ctx.generatedWith) (leaf.view as HexMapView).openTerrainPicker();
		}
		this.leaf.detach();
	}
}
