import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { LIMITED_TERRAIN_PALETTE } from "../src/constants";
import { SPACE_SECTOR_TERRAINS } from "../src/palettes/presets";
import {
	BLANK_ID,
	REGION_DETAIL_DESCRIPTION,
	kindsForPalette,
	listGeneratorKinds,
	newMapGeneratorChoices,
	optionsWithDefaults,
	regionDetailDescription,
	runGenerator,
	submapStartKind,
	visibleKinds,
	type TerrainGeneratorKind,
} from "../src/worldgen/registry";
import { OVERLAND_ID, PLANET_SURFACE_ID, REGION_DETAIL_ID } from "../src/worldgen/procedural/planetSurface";
import { STAR_SCATTER_ID } from "../src/worldgen/procedural/starScatter";
import { slugHint } from "../src/wizardText";
import { mapExportFileNames, mapExportStem, mapExportSuffix } from "../src/export/exportNames";
import { defaultIconPack } from "../src/utils";
import type HexmakerPlugin from "../src/HexmakerPlugin";

/** Fresh-eyes round 5 (new submap / new map dialogs, wizard, export modal, icon pickers). */

const read = (...p: string[]) => readFileSync(path.join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");
const ids = (ks: { id: string }[]) => ks.map((k) => k.id);

function pluginWith(mapKinds: string[]): HexmakerPlugin {
	return {
		settings: { worldFolder: "world", mapKinds, pathTypes: [], hexOrientation: "flat" },
		app: { vault: { getMarkdownFiles: () => [], cachedRead: async () => "" } },
	} as unknown as HexmakerPlugin;
}

const kind = (id: string, extra: Partial<TerrainGeneratorKind> = {}): TerrainGeneratorKind => ({
	id,
	label: id,
	description: "",
	source: "built-in",
	options: [],
	fits: () => true,
	generate: () => ({ ok: true, cells: new Map(), paths: [], warnings: [] }),
	toChains: () => ({ chains: [], missing: [] }),
	...extra,
});

describe("1. New submap: starts on the generator that fits the parent hex", () => {
	const blank = kind(BLANK_ID, { source: "blank" });
	const zoom = kind("region-detail", { needsContext: true });
	const overland = kind("overland");

	it("a forest hex starts on Region detail, not Blank", () => {
		expect(submapStartKind([blank, zoom, overland], BLANK_ID, { parentTerrain: "forest" })).toBe("region-detail");
	});

	it("keeps a saved per-terrain default (even an explicit Blank) and a clicked choice", () => {
		expect(submapStartKind([blank, zoom], BLANK_ID, { parentTerrain: "forest", savedGenerator: BLANK_ID })).toBe(BLANK_ID);
		expect(submapStartKind([blank, zoom], BLANK_ID, { parentTerrain: "forest", picked: true })).toBe(BLANK_ID);
		expect(submapStartKind([blank, zoom, overland], "overland", { parentTerrain: "forest" })).toBe("overland");
	});

	it("stays Blank with no terrain to zoom into, or no zoom generator for the palette", () => {
		expect(submapStartKind([blank, zoom], BLANK_ID, {})).toBe(BLANK_ID);
		expect(submapStartKind([blank, overland], BLANK_ID, { parentTerrain: "forest" })).toBe(BLANK_ID);
	});

	it("with the real generators on a world palette, that's Region detail", async () => {
		const plugin = pluginWith(["world"]);
		const shown = visibleKinds(await listGeneratorKinds(plugin), plugin.settings, false);
		const fitting = kindsForPalette(shown, LIMITED_TERRAIN_PALETTE, true);
		expect(submapStartKind(fitting, BLANK_ID, { parentTerrain: "forest" })).toBe(REGION_DETAIL_ID);
	});

	it("the setup modal applies it (and only for submaps)", () => {
		const src = read("src", "worldgen", "NewMapSetupModal.ts");
		expect(src).toMatch(/if \(where\.parentHex\) \{\n\s+this\.kindId = submapStartKind\(fitting, this\.kindId, \{\n\s+parentTerrain: this\.originTerrain,\n\s+savedGenerator: this\.saved\?\.generator,\n\s+picked: this\.pickedKind,/);
	});
});

describe("2. Region detail's description", () => {
	it("the generic text has no worked example that reads as detected terrain", () => {
		expect(REGION_DETAIL_DESCRIPTION).not.toMatch(/sea|east|coast/i);
		expect(regionDetailDescription(undefined)).toBe(REGION_DETAIL_DESCRIPTION);
		expect(regionDetailDescription({})).toBe(REGION_DETAIL_DESCRIPTION);
	});

	it("names this hex's actual neighbours, grouped by terrain", () => {
		const text = regionDetailDescription({
			parent: { terrain: "forest" },
			sides: {
				NW: { terrain: "grass" }, N: { terrain: "forest" }, NE: { terrain: "forest" },
				SW: { terrain: "grass" }, S: { terrain: "forest" }, SE: { terrain: "forest" },
			},
		});
		expect(text).toBe("Zoom into this forest hex: forest fills the map; its neighbours shape the edges: grass on the south-west and north-west.");
		expect(text).not.toMatch(/sea|coast/);
	});

	it("lists several neighbour terrains", () => {
		const text = regionDetailDescription({
			parent: { terrain: "grass" },
			sides: { N: { terrain: "hills" }, E: { terrain: "ocean" }, SE: { terrain: "ocean" } },
		});
		expect(text).toMatch(/hills on the north and ocean on the east and south-east\.$/);
	});

	it("says so when every neighbour matches, or there are none", () => {
		expect(regionDetailDescription({ parent: { terrain: "forest" }, sides: { N: { terrain: "forest" } } }))
			.toMatch(/neighbours are forest too/);
		expect(regionDetailDescription({ parent: { terrain: "forest" }, sides: {} })).toMatch(/to every edge/);
	});

	it("the setup modal shows it for submaps", () => {
		const src = read("src", "worldgen", "NewMapSetupModal.ts");
		expect(src).toMatch(/k\.id === REGION_DETAIL_ID && this\.origin \? regionDetailDescription\(this\.context\)/);
	});
});

describe("3. Maps → New map: procedural generators in the dropdown", () => {
	it("world users get Overland (and learned ones), not space or parent-hex ones", async () => {
		const plugin = pluginWith(["world"]);
		const offered = ids(newMapGeneratorChoices(await listGeneratorKinds(plugin), plugin.settings, LIMITED_TERRAIN_PALETTE, "", false));
		expect(offered).toContain(OVERLAND_ID);
		expect(offered).not.toContain(BLANK_ID);
		expect(offered).not.toContain(REGION_DETAIL_ID);
		expect(offered).not.toContain(STAR_SCATTER_ID);
		expect(offered).not.toContain(PLANET_SURFACE_ID);
	});

	it("space users on a sector palette get Star scatter", async () => {
		const plugin = pluginWith(["space"]);
		const offered = ids(newMapGeneratorChoices(await listGeneratorKinds(plugin), plugin.settings, SPACE_SECTOR_TERRAINS, "", false));
		expect(offered).toContain(STAR_SCATTER_ID);
	});

	it("next to a neighbour, edge-continuing ones come first", () => {
		const k = [kind("stars"), kind("overland", { continuesNeighbours: true })];
		expect(ids(newMapGeneratorChoices(k, { mapKinds: ["world"] }, LIMITED_TERRAIN_PALETTE, "", true))).toEqual(["overland", "stars"]);
	});

	it("runs generators with default options and carries the context's paths across", () => {
		const fill = kind("fill", {
			options: [{ key: "water", label: "Water", choices: [], default: "30" }],
			generate: (req) => {
				expect(req.options).toEqual({ water: "30" });
				const cells = new Map<string, string>();
				for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) cells.set(`${x}_${y}`, "grass");
				return { ok: true, cells, paths: [], warnings: [] };
			},
		});
		const out = runGenerator("flat", fill, {
			terrains: LIMITED_TERRAIN_PALETTE,
			grid: { cols: 5, rows: 5, offset: { x: 0, y: 0 }, stagger: "odd" },
			seed: 1,
			options: optionsWithDefaults(fill),
			context: { paths: [{ type: "Road", from: "W", to: "E" }] },
		});
		expect(out.ok).toBe(true);
		if (out.ok) expect(out.paths.map((p) => p.type)).toEqual(["Road"]);
	});

	it("the tab lists them itself; Guided setup stays for options and previews", () => {
		const src = read("src", "hex-map", "MapModal.ts");
		expect(src).not.toMatch(/Overland and more/);
		expect(src).toMatch(/text: "Guided setup…"/);
		expect(src).toMatch(/newMapGeneratorChoices\(kinds, this\.plugin\.settings, terrains, current, !!placement\)/);
	});
});

describe("4. Setup wizard: the 'Saved as' hint doesn't shift the form", () => {
	it("says the slug only when it differs from what was typed", () => {
		expect(slugHint("Ashby Vale")).toBe('Folder: "ashby-vale" (the map keeps the name you typed).');
		expect(slugHint("ashby-vale")).toBe("");
		expect(slugHint("")).toBe("");
	});

	it("the line keeps its space instead of being shown / hidden", () => {
		const wizard = read("src", "SetupWizardView.ts");
		expect(wizard).toMatch(/duckmage-wizard-slug-note/);
		expect(wizard).not.toMatch(/slugNote\.toggle\(/);
		const css = read("styles.css");
		const r5 = css.slice(css.indexOf("Fresh-eyes r5 (setup, new map, export)"));
		expect(r5).toMatch(/\.duckmage-wizard-slug-note \{[^}]*min-height:[^}]*white-space: nowrap;/);
	});
});

describe("5. Export: the File name box and the Writes line agree", () => {
	it("the suffix shown next to the box is exactly what the stem adds", () => {
		for (const showFactionOverlay of [false, true])
			for (const showRegionOverlay of [false, true]) {
				const o = { base: "kerrigan-system", mapName: "kerrigan-system", showFactionOverlay, showRegionOverlay };
				expect(mapExportStem(o)).toBe(`kerrigan-system${mapExportSuffix(o)}`);
				expect(mapExportFileNames(o).png).toBe(`kerrigan-system${mapExportSuffix(o)}.png`);
			}
		expect(mapExportSuffix({ showRegionOverlay: true })).toBe("-region");
		expect(mapExportSuffix({})).toBe("");
	});

	it("the form shows that suffix after the box and keeps it in sync", () => {
		const src = read("src", "export", "MapExportModal.ts");
		expect(src).toMatch(/const suffixEl = nameRow\.createSpan\(\{ cls: "duckmage-export-name-suffix" \}\);/);
		expect(src).toMatch(/const updatePreview = \(\) => \{\n\s+const n = names\(\);\n\s+const suffix = mapExportSuffix\(/);
	});
});

describe("6. Icon pickers open on the Space tab for space-only setups", () => {
	it("space only → Space; world, both or unset → All", () => {
		expect(defaultIconPack({ mapKinds: ["space"] })).toBe("space");
		expect(defaultIconPack({ mapKinds: ["world", "space"] })).toBe("all");
		expect(defaultIconPack({ mapKinds: ["world"] })).toBe("all");
		expect(defaultIconPack({})).toBe("all");
	});

	it("a tab picked this session still wins; the plugin wires the default", () => {
		expect(read("src", "HexmakerModal.ts")).toMatch(/let pack: IconPack \| "all" = lastIconPack \?\? iconPackDefault\(\);/);
		expect(read("src", "HexmakerPlugin.ts")).toMatch(/setIconPackDefault\(\(\) => defaultIconPack\(this\.settings\)\);/);
	});
});
