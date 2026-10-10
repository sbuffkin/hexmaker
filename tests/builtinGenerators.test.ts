import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_PATH_TYPES, DEFAULT_TERRAIN_PALETTE, LIMITED_TERRAIN_PALETTE } from "../src/constants";
import { SPACE_SYSTEM_TERRAINS } from "../src/palettes/presets";
import {
	BUILTIN_GENERATORS,
	builtinPathType,
	fitBuiltinModel,
	mapTerrainsByType,
	parseBuiltin,
	remapModel,
} from "../src/worldgen/builtinGenerators";
import { builtinKind, visibleKinds } from "../src/worldgen/registry";
import { validateModel, type HexWfcModel } from "../packages/hex-wfc/src";
import type HexmakerPlugin from "../src/HexmakerPlugin";
import type { TerrainColor } from "../src/types";

/**
 * G12: the biome / preset generators ship with the plugin and work on any
 * palette by mapping their terrains by type. The .md imports are stubbed
 * in tests, so the files are read from disk here.
 */

const DIR = join(__dirname, "../src/worldgen/builtin");
const models = new Map<string, HexWfcModel>();
for (const def of BUILTIN_GENERATORS) {
	const m = parseBuiltin(readFileSync(join(DIR, `${def.slug}.md`), "utf8"), def.slug);
	if (m) models.set(def.slug, m);
}

const plugin = { settings: { hexOrientation: "flat", pathTypes: DEFAULT_PATH_TYPES } } as unknown as HexmakerPlugin;
const grid = { cols: 20, rows: 14, offset: { x: 0, y: 0 }, stagger: "odd" as const };

const PALETTES: [string, TerrainColor[]][] = [
	["Limited", LIMITED_TERRAIN_PALETTE],
	["Expanded", DEFAULT_TERRAIN_PALETTE],
];

describe("shipped biome / preset generators", () => {
	it("every file in builtin/ is listed, and every listed one parses", () => {
		const files = readdirSync(DIR).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")).sort();
		expect(BUILTIN_GENERATORS.map((d) => d.slug).sort()).toEqual(files);
		expect(models.size).toBe(BUILTIN_GENERATORS.length);
	});

	for (const [label, palette] of PALETTES) {
		describe(`on ${label}`, () => {
			const names = new Set(palette.map((t) => t.name));
			for (const def of BUILTIN_GENERATORS) {
				it(`${def.slug} fits and generates only ${label} terrains`, () => {
					const model = models.get(def.slug)!;
					const fitted = fitBuiltinModel(model, palette);
					expect(fitted).toBeDefined();
					expect(validateModel(fitted!)).toEqual([]);
					const kind = builtinKind(plugin, def.slug, def.label, def.description, model);
					expect(kind.fits(palette)).toBe(true);
					const out = kind.generate({ terrains: palette, grid, seed: 7, options: {} });
					if (!out.ok) throw new Error(`${def.slug} on ${label}: ${out.message}`);
					expect(out.cells.size).toBe(grid.cols * grid.rows);
					const used = new Set(out.cells.values());
					for (const t of used) expect(names.has(t)).toBe(true);
					expect(used.size).toBeGreaterThan(1);
				});
			}
		});
	}

	it("on Expanded every terrain keeps its own (case-fixed) name", () => {
		for (const [slug, model] of models) {
			const mapping = mapTerrainsByType(model, DEFAULT_TERRAIN_PALETTE);
			for (const t of model.terrains) {
				expect({ slug, t: t.name, to: mapping.get(t.name) }).toEqual({ slug, t: t.name, to: t.name.toLowerCase() });
			}
		}
	});

	it("on Limited, variants fold into the type's terrain", () => {
		const mapping = mapTerrainsByType(models.get("biome-grassland")!, LIMITED_TERRAIN_PALETTE);
		expect(mapping.get("mixed forest")).toBe("forest");
		expect(mapping.get("foothills")).toBe("hill");
		expect(mapping.get("Mountain Ridge")).toBe("mountain");
		expect(mapping.get("water")).toBe("ocean");
		expect(mapping.get("desert rocky")).toBe("desert");
		// No wetland on Limited: marsh falls back to grassland.
		expect(mapping.get("marsh")).toBe("grass");
	});

	it("works on a custom palette by type, whatever the names", () => {
		const custom: TerrainColor[] = [
			{ name: "the deep", type: "water", color: "#000" },
			{ name: "meadow", type: "grassland", color: "#0f0" },
			{ name: "dark wood", type: "forest", color: "#060" },
			{ name: "crags", type: "mountains", color: "#888" },
			{ name: "downs", type: "hills", color: "#aa0" },
		];
		const kind = builtinKind(plugin, "biome-temperate-forest", "x", "x", models.get("biome-temperate-forest")!);
		expect(kind.fits(custom)).toBe(true);
		const out = kind.generate({ terrains: custom, grid, seed: 3, options: {} });
		if (!out.ok) throw new Error(out.message);
		const used = new Set(out.cells.values());
		expect(used.has("dark wood")).toBe(true);
		for (const t of used) expect(custom.some((c) => c.name === t)).toBe(true);
	});

	it("doesn't fit a space palette", () => {
		for (const model of models.values()) expect(fitBuiltinModel(model, SPACE_SYSTEM_TERRAINS)).toBeUndefined();
	});

	it("are world generators, hidden in Simple", () => {
		const kind = builtinKind(plugin, "biome-taiga", "Taiga", "", models.get("biome-taiga")!);
		expect(kind.id).toBe("builtin:biome-taiga");
		expect(kind.mapKind).toBe("world");
		expect(visibleKinds([kind], { mapKinds: ["world"], featureLevel: "simple" }, false)).toEqual([]);
		expect(visibleKinds([kind], { mapKinds: ["world"], featureLevel: "advanced" }, false)).toEqual([kind]);
	});
});

describe("remapModel", () => {
	const model: HexWfcModel = {
		name: "t",
		terrains: [
			{ name: "A", weight: 30, patch: 0.1, shape: "blob" },
			{ name: "B", weight: 10, patch: 0.3, shape: "line" },
			{ name: "C", weight: 10, near: { terrain: "A", distance: 2 } },
		],
		adjacency: [{ a: "A", b: "B", weight: 5 }, { a: "A", b: "C", weight: 1 }, { a: "C", b: "C", weight: 1 }],
		paths: [{ type: "River", from: "B", to: "edge", count: 1, turn: 0.2, length: 0.5, through: { A: 0.5, B: 0.5 } }],
		meta: {},
		settings: { counts: { A: { min: 1 }, C: { min: 2 } }, impassable: ["B"], paths: { "River: B > edge": { count: 2 } } },
	};

	it("merges terrains that land on one palette terrain", () => {
		const out = remapModel(model, new Map([["A", "x"], ["B", "x"], ["C", "y"]]));
		const x = out.terrains.find((t) => t.name === "x")!;
		expect(x.weight).toBe(40);
		expect(x.shape).toBe("blob");
		expect(x.patch).toBeCloseTo(0.15);
		// C's near rule now points at x.
		expect(out.terrains.find((t) => t.name === "y")!.near).toEqual({ terrain: "x", distance: 2 });
		expect(out.adjacency).toContainEqual({ a: "x", b: "x", weight: 5 });
		expect(out.paths![0]).toMatchObject({ from: "x", to: "edge", through: { x: 1 } });
		// Counts only survive on unmerged terrains; impassable only when all merged ones were.
		expect(out.settings!.counts).toEqual({ y: { min: 2 } });
		expect(out.settings!.impassable).toBeUndefined();
		expect(out.settings!.paths).toEqual({ "River: x > edge": { count: 2 } });
	});

	it("drops a near rule that would point at itself", () => {
		const out = remapModel(model, new Map([["A", "x"], ["B", "z"], ["C", "x"]]));
		expect(out.terrains.find((t) => t.name === "x")!.near).toBeUndefined();
		expect(out.settings!.impassable).toEqual(["z"]);
	});
});

describe("builtinPathType", () => {
	it("draws streams as rivers and trails as roads when the vault lacks them", () => {
		expect(builtinPathType("stream", ["Road", "River"])).toBe("River");
		expect(builtinPathType("creek", ["Road", "River"])).toBe("River");
		expect(builtinPathType("trail", ["Road", "River"])).toBe("Road");
		expect(builtinPathType("trail", ["Road", "River", "trail"])).toBe("trail");
		expect(builtinPathType("Jump", ["Road"])).toBe("Jump");
	});
});
