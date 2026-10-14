import { ItemView, Notice, TFolder, WorkspaceLeaf } from "obsidian";
import type HexmakerPlugin from "./HexmakerPlugin";
import type { HexMapView } from "./hex-map/HexMapView";
import type { TerrainColor } from "./types";
import { linkLabel, normalizeFolder, slugify } from "./utils";
import { ensureFolder } from "./vault/ensureFolder";
import { VIEW_TYPE_SETUP_WIZARD, VIEW_TYPE_HEX_MAP } from "./constants";
import { attachPaletteHint, defaultPaletteFor, fillPaletteSelect } from "./palettes/paletteOptions";
import { MAP_KINDS, enabledKinds, terrainsForTables, type MapKind } from "./mapKinds";
import { randomSeed } from "../packages/hex-wfc/src";
import { drawPreview, PREVIEW_AUTO_LIMIT } from "./worldgen/preview";
import { addGeneratedPaths, pathColors } from "./worldgen/generators";
import { markFreshMap } from "./worldgen/freshMap";
import {
	BLANK_ID,
	describeKind,
	generationKey,
	kindOptions,
	listGeneratorKinds,
	optionsWithTuning,
	suggestBaseTerrain,
	type GenerateOutcome,
	type TerrainGeneratorKind,
} from "./worldgen/registry";
import { PLACEHOLDER_MAP_NAME, isUnusedPlaceholderMap } from "./setupPlaceholder";
import { OVERLAND_ID, resolveSeaSide } from "./worldgen/procedural/planetSurface";
import { LIVE_PREVIEW_DELAY_MS, sizeForScalePick, sizeFromInput, wheelStep } from "./sizeInput";
import { keepScroll } from "./ui/keepScroll";
import { scalePalette, scalesFor, type MapScaleDef } from "./mapScales";
import { wizardKinds, wizardScale } from "./wizardKinds";
import { moduleScaleChoices, runOnScalePicked, runScaleMapMade, scaleChoiceValues } from "./modules/runtime";
import { TERRAIN_TABLES_SUMMARY, WIZARD_TUNING_ID, slugHint, wizardOptionId } from "./wizardText";
import { Disclosure } from "./ui/disclosure";
import { renderScaleCards, renderScaleChoices, renderTuningSliders } from "./ui/mapScaleForm";
import { renderResetButton } from "./ui/sliders";

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
	| "templatesFolder"
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
	/** "What are you mapping?" (src/mapScales.ts); undefined = the first of the map types on. */
	scaleId?: string;
	/** Generator for the first map (registry id); undefined = pick the
	 *  default for the map types and palette (firstMapGenerator). */
	generatorId?: string;
	generatorOptions: Record<string, string>;
	/** The user typed a size: picking another scale keeps it (critic C9). */
	sizeChosen?: boolean;
	/** The scale's own choices changed from their default (World maps' Biomes: Make every region now). */
	scaleChoices: Record<string, boolean>;
	seed: number;
	/** The last previewed run and its generationKey: Next creates exactly
	 *  this map when nothing changed since (no second run). */
	preview?: { key: string; outcome: GenerateOutcome };
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
	{ key: "regionsFolder",   label: "Areas",      suffix: "regions" },
	{ key: "tablesFolder",    label: "Tables",     suffix: "tables" },
	{ key: "workflowsFolder", label: "Workflows",  suffix: "workflows" },
	{ key: "templatesFolder", label: "Templates",  suffix: "templates" },
	{ key: "iconsFolder",     label: "Icons",      suffix: "icons" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wizardGrid(plugin: HexmakerPlugin, ctx: WizardContext) {
	return {
		cols: ctx.mapCols,
		rows: ctx.mapRows,
		offset: { x: 0, y: 0 },
		stagger: plugin.settings.staggerOffset ?? "odd",
	};
}

function resolvedOptions(kind: TerrainGeneratorKind, ctx: WizardContext): Record<string, string> {
	return optionsWithTuning(kind, ctx.generatorOptions);
}

/** generationKey of the wizard's current choices (see WizardContext.preview). */
function wizardRunKey(plugin: HexmakerPlugin, ctx: WizardContext, kind: TerrainGeneratorKind): string {
	const grid = wizardGrid(plugin, ctx);
	return generationKey({
		generatorId: kind.id,
		options: resolvedOptions(kind, ctx),
		seed: ctx.seed,
		cols: grid.cols,
		rows: grid.rows,
		orientation: ctx.hexOrientation,
		stagger: grid.stagger,
		palette: ctx.paletteName,
	});
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
		return kind.generate({
			terrains, grid: wizardGrid(plugin, ctx), seed: ctx.seed, options: resolvedOptions(kind, ctx),
			pathTypes: plugin.getPathTypes(ctx.paletteName),
		});
	} finally {
		plugin.settings.hexOrientation = saved;
	}
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
		[...plugin.mapStore.all(m.name).values()].some((h) => h.regionMap === PLACEHOLDER_MAP_NAME || !!h.locations?.includes(PLACEHOLDER_MAP_NAME)));
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
		title: "Welcome to Hexmap World Creator!",
		render(container, ctx, cbs) {
			container.createEl("p", {
				text: "It turns your Obsidian vault into a living, interactive hex map. Paint terrain and icons, link towns, dungeons, factions and encounter tables to hexes, and roll random tables right from the map. Any hex can get its own Markdown note.",
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
			// Only remembered here: the content is installed once the world
			// folder is confirmed on the next step, so nothing is written to
			// a folder the user hasn't agreed to yet (fresh-eyes F19).
			plugin.settings.mapKinds = [...ctx.mapKinds];
		},
	};
}

// ─── Step 2 — Folder setup ────────────────────────────────────────────────────

function makeFolderStep(plugin: HexmakerPlugin): WizardStep {
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
			const folderLabel = folderRow.createEl("label", { text: "World folder", cls: "duckmage-wizard-label" });
			const folderInput = folderRow.createEl("input", {
				type: "text",
				placeholder: "world",
				cls: "duckmage-wizard-input",
			});
			linkLabel(folderLabel, folderInput);
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
				const rowLabel = row.createEl("label", { text: label, cls: "duckmage-wizard-label" });
				const inp = row.createEl("input", {
					type: "text",
					cls: "duckmage-wizard-input duckmage-wizard-input-sm",
				});
				linkLabel(rowLabel, inp);
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
			// Per-folder paths go in this step's Advanced dropdown (placement:
			// Wizard.configureFoldersIndividually); the world folder is enough.
			const disclosure = new Disclosure(plugin.app, "Wizard.folders", () => container);
			disclosure.place("Wizard.configureFoldersIndividually", advRow);
			disclosure.place("Wizard.configureFoldersIndividually", advSection);
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
			await ensureFolder(plugin.app.vault, world);
			for (const { key, suffix } of FOLDER_KEYS) {
				const path = ctx.useAdvanced
					? normalizeFolder(ctx.advancedFolders[key] ?? "") || `${world}/${suffix}`
					: `${world}/${suffix}`;
				(plugin.settings as unknown as Record<string, unknown>)[key] = path;
				await ensureFolder(plugin.app.vault, path);
			}
			await plugin.saveSettings();
			// The folder is confirmed: the stores may write now (F19), and
			// the content below goes in once they're in.
			plugin.releaseStartupWrites();
			await plugin.storesStarted;
			// What the setup installs follows the map types picked (SP3):
			// space only → space palettes, no biome notes or fantasy
			// palettes, "Palette for new maps" on Space - Sector. It goes in
			// the folder just confirmed.
			await plugin.applyKindContent({ fromSetup: true });
			// Start the first map on a palette of a chosen map type.
			if (!ctx.mapKinds.includes(plugin.getPaletteOrPresetKind(ctx.paletteName))) {
				ctx.paletteName = defaultPaletteFor(plugin.settings);
			}
			// Create the note templates (hex and the linked-note ones) if they don't already exist
			await plugin.ensureTemplates();
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
			const nameLabel = nameRow.createEl("label", { text: "Map name", cls: "duckmage-wizard-label" });
			const nameInput = nameRow.createEl("input", {
				type: "text",
				placeholder: "my-world",
				cls: "duckmage-wizard-input",
			});
			linkLabel(nameLabel, nameInput);
			nameInput.value = ctx.mapName;
			// Map names are slugs (folder + note names): say so before Next.
			// The line always keeps its space (one line, empty when there is
			// nothing to say), so the form never jumps under the cursor while
			// typing (fresh-eyes r5).
			const slugNote = nameRow.createEl("p", { cls: "duckmage-wizard-note-count duckmage-wizard-slug-note" });
			const syncSlug = () => {
				const text = slugHint(ctx.mapName);
				slugNote.setText(text);
				slugNote.setAttr("title", text || null);
			};
			syncSlug();
			nameInput.addEventListener("input", () => {
				ctx.mapName = nameInput.value.trim();
				syncSlug();
				cb.onUpdate();
			});

			// What are you mapping? (owner 2026-10-12): the scale picks the
			// size, palette and generator list below; each module brings its
			// own (src/mapScales.ts). Only the map types that are on.
			const placeMap = new Disclosure(plugin.app, "Wizard.map", () => container);
			const scales = scalesFor(ctx.mapKinds);
			const firstScale = !ctx.scaleId;
			const startScale = wizardScale(ctx);
			ctx.scaleId = startScale?.id;
			if (startScale && firstScale) { ctx.mapCols = startScale.size.cols; ctx.mapRows = startScale.size.rows; }
			const scaleRow = container.createDiv({ cls: "duckmage-wizard-field" });
			scaleRow.createEl("label", { text: "What are you mapping?", cls: "duckmage-wizard-label", attr: { id: "duckmage-wizard-scale-label" } });
			const pickScale = (s: MapScaleDef) => {
				if (ctx.scaleId === s.id) return;
				ctx.scaleId = s.id;
				ctx.generatorId = undefined;
				ctx.generatorOptions = {};
				ctx.scaleChoices = {};
				// A size the user typed is kept (critic C9); else the scale's own.
				const size = sizeForScalePick(ctx.sizeChosen ? { cols: ctx.mapCols, rows: ctx.mapRows } : null, s.size);
				setSize(size.cols, size.rows, false);
				usePalette(scalePalette(s, undefined));
				scaleCards.sync();
				renderGenerators();
				refresh();
				cb.onUpdate();
				// The scale's module gets its content ready (Biomes: the biome notes), then the list again.
				void runOnScalePicked(plugin, s.id).then(() => {
					if (ctx.scaleId !== s.id) return;
					renderGenerators();
					refresh();
				});
			};
			const scaleCards = renderScaleCards(scaleRow, scales, { labelId: "duckmage-wizard-scale-label", selected: () => ctx.scaleId, pick: pickScale });
			placeMap.place("Wizard.mapScale", scaleRow);

			// Grid size
			const sizeRow = container.createDiv({ cls: "duckmage-wizard-field" });
			const sizeLabel = sizeRow.createEl("label", { text: "Grid size", cls: "duckmage-wizard-label" });
			const sizeInputs = sizeRow.createDiv({ cls: "duckmage-wizard-size-inputs" });
			const colsInput = sizeInputs.createEl("input", {
				type: "number",
				cls: "duckmage-wizard-input-num",
				attr: { "aria-label": "Columns" },
			});
			linkLabel(sizeLabel, colsInput);
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
			// Back to the scale's size in one click.
			// The one reset button (src/ui/sliders.ts): a rotate icon.
			const resetBtn = renderResetButton(sizeInputs, { what: "the size", defaultText: "this scale's size", onReset: () => {} }).el;
			resetBtn.addClass("duckmage-wizard-size-reset");
			placeMap.place("Wizard.gridSizeReset", resetBtn);

			const noteCount = sizeRow.createEl("p", { cls: "duckmage-wizard-note-count" });
			const updateCount = () => {
				const n = ctx.mapCols * ctx.mapRows;
				noteCount.setText(`${n.toLocaleString()} hex${n !== 1 ? "es" : ""}. The map is one note; a hex gets its own note when you first add something to it.`);
			};
			updateCount();

			// The preview follows the size while typing (debounced), not only
			// once the field loses focus; a half-typed value waits. Blur / Enter
			// commits (clamped) at once.
			let sizeTimer: number | undefined;
			const applySize = (committed: boolean, byUser = true) => {
				const cols = sizeFromInput(colsInput.value, { min: 2, max: 200, fallback: 20, committed });
				const rows = sizeFromInput(rowsInput.value, { min: 2, max: 200, fallback: 16, committed });
				if (committed) { colsInput.value = String(cols); rowsInput.value = String(rows); }
				const next = { cols: cols ?? ctx.mapCols, rows: rows ?? ctx.mapRows };
				if (next.cols === ctx.mapCols && next.rows === ctx.mapRows) return;
				if (byUser) ctx.sizeChosen = true;
				ctx.mapCols = next.cols;
				ctx.mapRows = next.rows;
				updateCount();
				refresh();
				cb.onUpdate();
			};
			for (const input of [colsInput, rowsInput]) {
				input.addEventListener("input", () => {
					window.clearTimeout(sizeTimer);
					sizeTimer = window.setTimeout(() => applySize(false), LIVE_PREVIEW_DELAY_MS);
				});
				input.addEventListener("change", () => {
					window.clearTimeout(sizeTimer);
					applySize(true);
				});
				// The mouse wheel steps the size while the field is hovered or focused.
				wheelStep(input, 2, 200, () => activeDocument.activeElement === input);
			}
			/** Set both fields and apply them (a scale picked, reset). */
			function setSize(cols: number, rows: number, byUser: boolean): void {
				colsInput.value = String(cols);
				rowsInput.value = String(rows);
				applySize(true, byUser);
			}
			resetBtn.addEventListener("click", () => {
				const s = wizardScale(ctx);
				// Back to the scale's size, which then follows the scale again.
				ctx.sizeChosen = false;
				setSize(s?.size.cols ?? 20, s?.size.rows ?? 16, false);
			});

			// Hex orientation
			const orientRow = container.createDiv({ cls: "duckmage-wizard-field" });
			orientRow.createEl("label", { text: "Hex orientation", cls: "duckmage-wizard-label", attr: { id: "duckmage-wizard-orient-label" } });
			// A radio group: the chosen card is ticked and filled; hover only
			// lightens a card, so it never looks chosen.
			const orientBtns = orientRow.createDiv({
				cls: "duckmage-wizard-orient-row",
				// aria-labelledby, not aria-label: Obsidian shows aria-label as a hover tooltip.
				attr: { role: "radiogroup", "aria-labelledby": "duckmage-wizard-orient-label" },
			});

			const orientCards: { value: "flat" | "pointy"; el: HTMLElement; mark: HTMLElement }[] = [];
			const syncOrient = () => {
				for (const c of orientCards) {
					const on = ctx.hexOrientation === c.value;
					c.el.toggleClass("is-active", on);
					c.el.setAttr("aria-checked", on ? "true" : "false");
					c.el.setAttr("tabindex", on ? "0" : "-1");
					c.mark.setText(on ? "✓ Selected" : "");
				}
			};
			for (const { value, label, desc } of [
				{ value: "flat"   as const, label: "Flat-top",   desc: "Flat sides face north and south — wider hexes" },
				{ value: "pointy" as const, label: "Pointy-top", desc: "Points face north and south — taller hexes" },
			]) {
				const btn = orientBtns.createDiv({
					cls: "duckmage-wizard-orient-btn",
					attr: { role: "radio" },
				});
				const head = btn.createDiv({ cls: "duckmage-wizard-orient-head" });
				head.createSpan({ text: label, cls: "duckmage-wizard-orient-label" });
				const mark = head.createSpan({ cls: "duckmage-wizard-orient-mark" });
				btn.createSpan({ text: desc,  cls: "duckmage-wizard-orient-desc" });
				orientCards.push({ value, el: btn, mark });
				const choose = () => {
					if (ctx.hexOrientation === value) return;
					ctx.hexOrientation = value;
					syncOrient();
					refresh();
				};
				btn.addEventListener("click", choose);
				btn.addEventListener("keydown", (e) => {
					if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); }
					if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
						e.preventDefault();
						ctx.hexOrientation = ctx.hexOrientation === "flat" ? "pointy" : "flat";
						syncOrient();
						refresh();
						orientCards.find((c) => c.value === ctx.hexOrientation)?.el.focus();
					}
				});
			}
			syncOrient();

			// Terrain palette
			const paletteRow = container.createDiv({ cls: "duckmage-wizard-field" });
			const paletteLabel = paletteRow.createEl("label", { text: "Terrain palette", cls: "duckmage-wizard-label" });
			const paletteSelect = paletteRow.createEl("select", { cls: "duckmage-wizard-select" });
			linkLabel(paletteLabel, paletteSelect);
			fillPaletteSelect(plugin, paletteSelect, ctx.paletteName);
			attachPaletteHint(paletteRow, paletteSelect);
			/** Switch to palette `name` when the list has it (a scale's or a generator's palette). */
			function usePalette(name: string): void {
				if (name === ctx.paletteName || !Array.from(paletteSelect.options).some((o) => o.value === name)) return;
				paletteSelect.value = name;
				paletteSelect.dispatchEvent(new Event("change"));
			}
			paletteSelect.addEventListener("change", () => {
				ctx.paletteName = paletteSelect.value;
				renderGenerators();
				refresh();
			});

			// Terrain: generator choice + small live preview. The same
			// generators as Maps → New map… (src/worldgen/registry.ts).
			const genField = container.createDiv({ cls: "duckmage-wizard-field duckmage-wizard-generator" });
			genField.createEl("label", { text: "Generator", cls: "duckmage-wizard-label" });
			const genBody = genField.createDiv({ cls: "duckmage-wizard-generator-body" });
			const genSide = genBody.createDiv({ cls: "duckmage-wizard-generator-choices" });
			const genList = genSide.createDiv({ cls: "duckmage-setup-generators", text: "Loading generators…" });
			const optsBox = genSide.createDiv({ cls: "duckmage-wizard-generator-options" });
			const previewBox = genBody.createDiv({ cls: "duckmage-wizard-generator-preview" });
			const canvas = previewBox.createEl("canvas", { cls: "duckmage-setup-canvas" });
			const rerollBtn = previewBox.createEl("button", { text: "🎲 Reroll", attr: { title: "Generate again with a new random seed" } });
			const status = previewBox.createDiv({ cls: "duckmage-setup-status" });
			const exactNote = previewBox.createDiv({
				cls: "duckmage-wizard-preview-exact",
				text: "Next creates exactly this map. Reroll for another.",
			});
			rerollBtn.addEventListener("click", () => { ctx.seed = randomSeed(); refresh(); });
			/** Overland's "One side (random)": say which side this seed picked. */
			let seaRandomOption: HTMLOptionElement | undefined;
			const syncSeaLabel = () => {
				if (!seaRandomOption) return;
				const side = resolveSeaSide("random", ctx.seed);
				seaRandomOption.text = `One side (random: ${side})`;
			};

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
					card.createDiv({ cls: "duckmage-setup-gen-desc", text: describeKind(k, terrains()) });
					card.addEventListener("click", () => {
						ctx.generatorId = k.id;
						ctx.generatorOptions = {};
						// A generator that wants its own palette (Orbits: Space - System).
						const s = wizardScale(ctx);
						if (s) usePalette(scalePalette(s, k.id));
						// The page stays where it was, the picked card in view (C8).
						keepScroll(genList, () => {
							renderGenerators();
							refresh();
						}, () => genList.querySelector<HTMLElement>(".duckmage-setup-gen.is-active"));
					});
				}
				optsBox.empty();
				seaRandomOption = undefined;
				const kind = kinds.find((k) => k.id === ctx.generatorId);
				// The generator's options sit in an Advanced dropdown under the
				// cards (placement: Wizard.genOpt<Key>); the defaults make a good map.
				const optsDisclosure = new Disclosure(plugin.app, "Wizard.map", () => optsBox);
				for (const opt of kind ? kindOptions(kind, terrains(), plugin.getPathTypes(ctx.paletteName)) : []) {
					const row = optsBox.createEl("label", { cls: "duckmage-wizard-generator-option" });
					optsDisclosure.place(wizardOptionId(opt.key), row);
					row.createSpan({ text: opt.label });
					const sel = row.createEl("select");
					for (const c of opt.choices) {
						const o = sel.createEl("option", { value: c.value, text: c.label });
						if (kind?.id === OVERLAND_ID && opt.key === "sea" && c.value === "random") seaRandomOption = o;
					}
					sel.value = ctx.generatorOptions[opt.key] ?? opt.default;
					if (sel.selectedIndex < 0) sel.value = opt.default;
					sel.addEventListener("change", () => { ctx.generatorOptions[opt.key] = sel.value; refresh(); });
				}
				// Advanced: a few engine sliders that most change the layout
				// (owner 2026-10-12), each with its default and a reset
				// (src/ui/mapScaleForm.ts, shared with New map).
				renderTuningSliders(optsBox, kind?.tuning, ctx.generatorOptions, optsDisclosure, WIZARD_TUNING_ID, () => {
					window.clearTimeout(tuneTimer);
					tuneTimer = window.setTimeout(refresh, LIVE_PREVIEW_DELAY_MS);
				});
				// The scale's own choices (Biomes: Make every region now).
				renderScaleChoices(optsBox, moduleScaleChoices(ctx.scaleId, ctx.generatorId), ctx.scaleChoices, optsDisclosure, "Wizard");
				syncSeaLabel();
			};

			let tuneTimer: number | undefined;

			const refresh = () => {
				const kind = kinds.find((k) => k.id === ctx.generatorId);
				const pal = terrains();
				const grid = wizardGrid(plugin, ctx);
				status.empty();
				status.removeClass("mod-warning");
				let cells = new Map<string, string>();
				let paths: { type: string; route?: string; hexes: string[] }[] = [];
				let featureCells: Set<string> | undefined;
				syncSeaLabel();
				exactNote.hide();
				if (kind && kind.id !== BLANK_ID) {
					if (ctx.mapCols * ctx.mapRows > PREVIEW_AUTO_LIMIT) {
						status.setText("Large map — no preview; terrain is generated when you continue.");
					} else {
						const outcome = runGenerator(plugin, ctx, kind, pal);
						ctx.preview = { key: wizardRunKey(plugin, ctx, kind), outcome };
						if (outcome.ok) exactNote.show();
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
					featureCells, paths, pathColors(plugin, ctx.paletteName), 240, 12);
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
				// The map the preview showed, as is, when nothing changed since;
				// otherwise (large map, no preview) run it now.
				const key = wizardRunKey(plugin, ctx, kind);
				if (ctx.preview?.key === key) {
					outcome = ctx.preview.outcome;
				} else {
					onProgress(`Generating terrain (${kind.label})…`);
					outcome = runGenerator(plugin, ctx, kind, terrains);
				}
				if (!outcome.ok) throw new Error(outcome.message);
			}

			// The map is one map note: terrain goes there, and hex notes
			// appear as hexes get content (createNewMap installs a preset
			// palette such as Space - Sector on first use).
			onProgress("Creating the map…");
			const result = await plugin.createNewMap(
				ctx.mapName,
				ctx.mapCols,
				ctx.mapRows,
				ctx.paletteName,
				0,
				0,
				plugin.settings.staggerOffset,
				undefined,
				outcome?.ok ? outcome.cells : undefined,
				{
					baseTerrain: suggestBaseTerrain(terrains),
					quiet: true,
					...(outcome?.ok && outcome.arrivals ? { arrivals: outcome.arrivals } : {}),
					...(outcome?.ok && outcome.events ? { events: outcome.events } : {}),
				},
			);
			if ("error" in result) throw new Error(result.error);

			// Generated paths (jump routes…) become the map's anchored paths.
			if (outcome?.ok && outcome.paths.length && kind) {
				const { paths } = kind.toPaths(outcome.paths, result.name);
				addGeneratedPaths(plugin, result.name, paths);
			}
			// What the scale's module adds (Biomes: an overworld with its region settings).
			const scale = wizardScale(ctx);
			const choices = moduleScaleChoices(scale?.id, kind?.id);
			await runScaleMapMade(plugin, scale?.id, {
				mapName: result.name,
				generatorId: kind?.id ?? BLANK_ID,
				options: kind ? resolvedOptions(kind, ctx) : {},
				seed: ctx.seed,
				grid: wizardGrid(plugin, ctx),
				paletteName: ctx.paletteName,
				choices: scaleChoiceValues(choices, ctx.scaleChoices),
				onProgress,
			});
			ctx.generatedWith = outcome?.ok ? kind?.label : undefined;
			// A generated first map is open for Reroll / Lock until its first
			// hand edit, as New map's (SF7); a map with its own rerolls is left alone.
			if (outcome?.ok && kind && !plugin.arrival.isOverworld(result.name)) {
				markFreshMap(plugin, result.name, { generator: kind.id, options: resolvedOptions(kind, ctx), seed: ctx.seed });
			}
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
			// Space only (ctx.mapKinds): tables for the space terrains, none
			// for the fantasy palettes that ship installed. Folder and link
			// section names stay generic either way (G4).
			onProgress("Generating terrain tables…");
			await plugin.ensureTerrainTables(terrainsForTables(plugin.settings.terrainPalettes, ctx.mapKinds));
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
			summary.createEl("li", { text: `Map: "${ctx.mapName.trim() || name}" — ${ctx.mapCols} × ${ctx.mapRows}, ${ctx.generatedWith ? `terrain generated with ${ctx.generatedWith}` : "blank, ready to paint"}` });
			summary.createEl("li", { text: `Map note: _${name}.md in the map folder holds the terrain and paths; a hex gets its own note when you first add something to it` });
			summary.createEl("li", { text: `Hex orientation: ${ctx.hexOrientation === "flat" ? "Flat-top" : "Pointy-top"}` });
			summary.createEl("li", { text: `Terrain palette: ${ctx.paletteName}` });
			summary.createEl("li", { text: TERRAIN_TABLES_SUMMARY });

			container.createEl("p", {
				text: "A few things to try first:",
				cls: "duckmage-wizard-text",
			});

			const tips = container.createEl("ul", { cls: "duckmage-wizard-tips" });
			for (const tip of [
				ctx.generatedWith
					? "Repaint anything you like: open Terrain in the drawing tools, pick a type and click hexes."
					: "Paint terrain — the terrain picker opens automatically when you hit \"Open hex map\". Pick a type and click hexes to paint.",
				"Click any hex to open its editor: terrain, notes, towns, dungeons and more. Right-click a hex for its menu (open note, new submap, tokens).",
				"Open the 🎲 tab to fill in your terrain tables (Edit) and roll on them.",
				"The pencil button (top right of the map) opens the drawing tools: paint icons, draw roads or rivers, link factions.",
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
			scaleChoices: {},
			seed: randomSeed(),
		};
		this.steps = [
			makeWelcomeStep(),
			makeFolderStep(plugin),
			makeMapStep(plugin),
			makeDoneStep(),
		];
	}

	getViewType() { return VIEW_TYPE_SETUP_WIZARD; }
	getDisplayText() { return "Hex map setup"; }
	getIcon() { return "map"; }

	async onOpen() {
		this.renderView();
	}

	async onClose() {
		// Setup put off or done: the stores go ahead either way (F19).
		this.plugin.releaseStartupWrites();
		this.contentEl.empty();
	}

	private renderView() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("duckmage-setup-wizard");

		// Header: plugin title + progress dots + step counter
		const header = contentEl.createDiv({ cls: "duckmage-wizard-header" });
		header.createEl("p", { text: "Hex map setup", cls: "duckmage-wizard-title" });
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

		// Footer: dismiss links, until setup is done. The final step has
		// nothing left to put off (fresh-eyes F11).
		if (isFinal) return;
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
			// Not a pick: the types it has are recorded on save, nothing installed.
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
				// Direct feedback to Next: no plugin-name prefix (owner Q10).
				new Notice(`Couldn't finish this step: ${e instanceof Error ? e.message : String(e)}`);
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
		const blank = !this.ctx.generatedWith;
		const wizardLeaf = this.leaf;
		if (!openMap) {
			wizardLeaf.detach();
			return;
		}
		const leaf = this.app.workspace.getLeaf("tab");
		const opening = leaf.setViewState({ type: VIEW_TYPE_HEX_MAP, active: true });
		// The wizard closes as the map opens, whatever the map does next
		// (critic C16: the finished wizard stayed open as a tab).
		wizardLeaf.detach();
		await opening;
		// A blank map starts in the terrain picker; a generated one is shown as is.
		if (blank) (leaf.view as HexMapView).openTerrainPicker();
	}
}
