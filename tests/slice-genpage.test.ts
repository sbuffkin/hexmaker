import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import path from "node:path";
import { TFile } from "obsidian";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { genPage, moduleCommands, moduleGenerators as runtimeGenerators, moduleViews } from "../src/modules/runtime";
import { activeRuntimes, genPage as activeGenPage } from "../src/modules/active";
import type { GeneratorHelpers } from "../src/modules/types";
import { BLANK_ID, builtinKind, listGeneratorKinds, runGenerator, visibleKinds, type TerrainGeneratorKind } from "../src/worldgen/registry";
import { OVERLAND_ID } from "../src/worldgen/procedural/planetSurface";
import { parseBuiltin } from "../src/worldgen/builtinGenerators";
import { scaleGenerators, scalesFor } from "../src/mapScales";
import { scaleStarter } from "../src/wizardKinds";
import { openBiomePage } from "../src/overworld/BiomeLibraryModal";
import { generatorPageState } from "../src/modules/gen-page/generatorPageState";
import { GeneratorView, VIEW_TYPE_GENERATOR } from "../src/modules/gen-page/GeneratorView";
import type HexmakerPlugin from "../src/HexmakerPlugin";
import { readSurface, readSource } from "./helpers/source";
import { describeWith, describeWithout } from "./helpers/slices";

/**
 * The generator page slice ("genpage", src/modules/gen-page/): the page,
 * its command and the genPage() api. Making maps from generators is the
 * core's: without the slice, New map and the setup wizard still list and
 * run learned generator notes and the built-in generators; there is only no
 * page to edit them on, and the buttons that open it are gone.
 */

const FIXTURE = readFileSync(path.join(process.cwd(), "tests", "fixtures", "generator-learned.md"), "utf8");
const NOTE = "world/generators/Fixture vale.md";

function file(p: string): TFile {
	const f = new TFile();
	f.path = p;
	f.basename = p.split("/").pop()!.replace(/\.md$/, "");
	f.extension = "md";
	return f;
}

/** A plugin with one learned generator note in its generators folder. */
function pluginWithNote(): HexmakerPlugin {
	const notes = new Map([[NOTE, FIXTURE]]);
	return {
		settings: { worldFolder: "world", mapKinds: ["world"], pathTypes: [], hexOrientation: "flat", terrainPalettes: [], maps: [] },
		app: {
			vault: {
				getMarkdownFiles: () => [...notes.keys()].map(file),
				cachedRead: async (f: TFile) => notes.get(f.path) ?? "",
				getAbstractFileByPath: () => null,
			},
			metadataCache: { getFirstLinkpathDest: () => null },
		},
		moduleGenerators(h: GeneratorHelpers) { return runtimeGenerators(this as unknown as HexmakerPlugin, h); },
		getPalette: () => undefined,
		getMap: () => undefined,
	} as unknown as HexmakerPlugin;
}

const grid = { cols: 14, rows: 10, offset: { x: 0, y: 0 }, stagger: "odd" as const };

function run(plugin: HexmakerPlugin, kind: TerrainGeneratorKind) {
	return runGenerator(plugin.settings.hexOrientation, kind, { terrains: DEFAULT_TERRAIN_PALETTE, grid, seed: 7, options: {} });
}

/** Holds whichever way the slice is built: map creation never needs the page. */
describe("genpage: New map and the setup wizard make maps from generators without the page", () => {
	it("lists the learned generator note and runs it; the shipped generators and Overland run too", async () => {
		const plugin = pluginWithNote();
		const kinds = await listGeneratorKinds(plugin);
		const learned = kinds.find((k) => k.id === `wfc:${NOTE}`)!;
		expect(learned).toBeDefined();
		expect(learned.source).toBe("learned");
		expect(learned.label).toBe("Fixture vale");
		expect(learned.fits(DEFAULT_TERRAIN_PALETTE)).toBe(true);
		const out = run(plugin, learned);
		expect(out.ok).toBe(true);
		if (!out.ok) return;
		expect(out.cells.size).toBe(grid.cols * grid.rows);
		const placeable = new Set(["water", "shallows", "hills", "forest", "grass"]);
		for (const t of out.cells.values()) expect(placeable.has(t)).toBe(true);
		// A shipped generator (a biome / preset note; the .md imports are stubbed in tests, so read from disk) and the procedural Overland run too.
		const valley = parseBuiltin(readSource("src/worldgen/builtin/preset-valley.md"), "preset-valley")!;
		expect(run(plugin, builtinKind(plugin, "preset-valley", "Valley", "", valley)).ok).toBe(true);
		const overland = kinds.find((k) => k.id === OVERLAND_ID)!;
		expect(run(plugin, overland).ok).toBe(true);
		// New map offers the learned one for a world palette.
		expect(visibleKinds(kinds, plugin.settings, new Set()).map((k) => k.id)).toContain(`wfc:${NOTE}`);
	});

	it("the setup wizard's first map: the Overland scale starts on Overland and makes a map", async () => {
		const plugin = pluginWithNote();
		const kinds = await listGeneratorKinds(plugin);
		const scale = scalesFor(["world"]).find((s) => s.id === "overland")!;
		const offered = scaleGenerators(scale, kinds);
		expect(offered[0].id).toBe(BLANK_ID);
		const starter = scaleStarter(offered);
		expect(starter).toBe(OVERLAND_ID);
		expect(run(plugin, offered.find((k) => k.id === starter)!).ok).toBe(true);
	});

	it("New map, Maps and World maps open the page only through genPage(), never by name", () => {
		const newMap = readSurface("new-map-setup");
		expect(newMap).toContain("genBtn.toggle(!!genPage() && mode === GENERATE_MODE);");
		expect(newMap).toContain("await genPage()?.open(this.plugin, {");
		const maps = readSurface("map-modal");
		expect(maps).toMatch(/if \(existing && page\) \{\n\s+layers\.add\("MapModal\.mapRowContextGenerator"/);
		expect(maps).toContain('if (wmake && page) {\n            layers.add("MapModal.mapRowContextMakeGenerator"');
		expect(readSource("src/overworld/BlendIntoBiomeModal.ts")).toContain('!target.generator && !!genPage() && { text: "Make a generator instead…"');
		expect(readSource("src/overworld/EditRegionModal.ts")).toContain('if (genPage()) row.createEl("button", { text: "Make generator…"');
		for (const f of ["src/HexmakerPlugin.ts", "src/plugin/commands.ts", "src/hex-map/MapModal.ts", "src/worldgen/NewMapSetupModal.ts", "src/overworld/BiomeLibraryModal.ts", "src/overworld/BiomePanel.ts", "src/overworld/MakeGeneratorModal.ts"]) {
			expect({ f, named: /openTerrainGenerator|VIEW_TYPE_GENERATOR|GeneratorView/.test(readSource(f)) }).toEqual({ f, named: false });
		}
	});
});

describeWithout("genpage", "genpage off: no page, no command, no api", () => {
	it("registers no generator view or command, and genPage() is undefined", () => {
		expect(moduleViews().map((v) => v.type)).not.toContain(VIEW_TYPE_GENERATOR);
		expect(moduleCommands().map((c) => c.command.id)).not.toContain("open-terrain-generator");
		expect(genPage()).toBeUndefined();
		expect(activeGenPage()).toBeUndefined();
		expect(activeRuntimes().some((m) => m.id === "gen-page")).toBe(false);
	});

	it("a biome's Edit… opens its note instead of the biome page", async () => {
		const opened: string[] = [];
		const note = file("world/biomes/Taiga.md");
		const plugin = {
			biomeStore: { pathOf: () => note.path },
			app: { vault: { getAbstractFileByPath: () => note }, workspace: { getLeaf: () => ({ openFile: async (f: TFile) => void opened.push(f.path) }) } },
		} as unknown as HexmakerPlugin;
		await openBiomePage(plugin, "taiga");
		expect(opened).toEqual([note.path]);
	});
});

describeWith("genpage", "genpage on: the page's view, command and api", () => {
	/** A workspace that records what's opened; `leaves` are the open generator pages. */
	function workspace(leaves: { view: unknown }[] = []) {
		const opened: unknown[] = [];
		const revealed: unknown[] = [];
		return {
			opened,
			revealed,
			getLeavesOfType: (type: string) => (type === VIEW_TYPE_GENERATOR ? leaves : []),
			revealLeaf: async (leaf: unknown) => void revealed.push(leaf),
			getLeaf: () => ({ setViewState: async (s: unknown) => void opened.push(s) }),
		};
	}

	it("registers the generator view and the Open terrain generator command", () => {
		expect(moduleViews().map((v) => v.type)).toContain(VIEW_TYPE_GENERATOR);
		const cmd = moduleCommands().find((c) => c.command.id === "open-terrain-generator")!;
		expect(cmd.command.name).toBe("Open terrain generator");
		expect(cmd.command.placementId).toBe("Plugin.cmd.openTerrainGenerator");
		const view = moduleViews().find((v) => v.type === VIEW_TYPE_GENERATOR)!.create({} as never, {} as never);
		expect(view).toBeInstanceOf(GeneratorView);
		expect((view as GeneratorView).getViewType()).toBe(VIEW_TYPE_GENERATOR);
		expect((view as GeneratorView).getDisplayText()).toBe("Terrain generator");
	});

	it("open() picks the map, palette and generator, then opens the page in a new tab", async () => {
		const ws = workspace();
		const plugin = { app: { workspace: ws } } as unknown as HexmakerPlugin;
		await genPage()!.open(plugin, { mapName: "Coast", paletteName: "Expanded", generatorPath: NOTE });
		expect(generatorPageState.mapName).toBe("Coast");
		expect(generatorPageState.paletteName).toBe("Expanded");
		expect(generatorPageState.selectedPath).toBe(NOTE);
		expect(generatorPageState.biome).toBe("");
		expect(ws.opened).toEqual([{ type: VIEW_TYPE_GENERATOR, active: true }]);
	});

	it("open() brings an open page forward and redraws it; refresh() redraws every open page", async () => {
		let redrawn = 0;
		const page = Object.create(GeneratorView.prototype) as GeneratorView;
		page.refresh = () => void redrawn++;
		const leaf = { view: page };
		const ws = workspace([leaf]);
		const plugin = { app: { workspace: ws } } as unknown as HexmakerPlugin;
		await genPage()!.open(plugin, {});
		expect(ws.revealed).toEqual([leaf]);
		expect(ws.opened).toEqual([]);
		expect(redrawn).toBe(1);
		genPage()!.refresh(plugin);
		expect(redrawn).toBe(2);
	});

	it("a blend-field biome opens as the biome page; one made by a generator opens that generator", async () => {
		const gen = file("world/generators/Taiga gen.md");
		const biomes: Record<string, { id: string; generator?: string }> = { taiga: { id: "taiga" }, fjord: { id: "fjord", generator: "world/generators/Taiga gen" } };
		const plugin = {
			moduleStore: () => ({ get: (id: string) => biomes[id] }),
			app: {
				workspace: workspace(),
				vault: { getAbstractFileByPath: (p: string) => (p === gen.path ? gen : null) },
				metadataCache: { getFirstLinkpathDest: () => null },
			},
		} as unknown as HexmakerPlugin;
		await genPage()!.open(plugin, { biome: "taiga" });
		expect(generatorPageState.biome).toBe("taiga");
		await genPage()!.open(plugin, { biome: "fjord" });
		expect(generatorPageState.biome).toBe("");
		expect(generatorPageState.selectedPath).toBe(gen.path);
	});

	it("a biome's Edit… opens the biome page", async () => {
		const ws = workspace();
		const plugin = { moduleStore: () => ({ get: () => ({ id: "taiga" }) }), app: { workspace: ws } } as unknown as HexmakerPlugin;
		await openBiomePage(plugin, "taiga");
		expect(generatorPageState.biome).toBe("taiga");
		expect(ws.opened).toEqual([{ type: VIEW_TYPE_GENERATOR, active: true }]);
	});

	it("the page redraws when debug mode changes (its start-up hook registers that)", async () => {
		const registered: unknown[] = [];
		const own = activeRuntimes().find((m) => m.id === "gen-page")!;
		await own.lifecycle!.onload!({ register: (cb: unknown) => void registered.push(cb), app: { workspace: workspace() } } as never);
		expect(registered).toHaveLength(1);
		expect(typeof registered[0]).toBe("function");
	});
});
