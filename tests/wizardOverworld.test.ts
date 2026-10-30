import { describe, it } from "node:test";
import expect from "expect";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { optionsWithTuning, BLANK_ID } from "../src/worldgen/registry";
import { tuneKey, gridKeys } from "../src/worldgen/procedural/common";
import { moduleScaleChoices, runScaleMapMade, scaleChoiceValues } from "../src/modules/runtime";
import { worldMapsRuntime } from "../src/modules/world-maps/runtime";
import { NEW_OVERWORLD_DEFAULTS, newOverworldFields } from "../src/overworld/overworldGen";
import { BIOMES_SCALE_ID, MAKE_ALL_REGIONS_CHOICE } from "../src/overworld/scaleOverworld";
import { WORLD_BIOMES_ID, WORLD_BIOMES_OPTIONS, WORLD_BIOMES_TUNING, worldBiomesFromOptions } from "../src/overworld/worldBiomes";
import { scaleStarter } from "../src/wizardKinds";
import { registry } from "../src/modules";
import type { MapData } from "../src/types";
import type { GeneratorHelpers } from "../src/modules/types";
import { readSurface } from "./helpers/source";

/**
 * Owner 2026-10-12 follow-ups: Biomes in "What are you mapping?" makes a
 * real overworld (New overworld…'s path and region defaults), and New map
 * gets the wizard's scale → generator split, sharing its code.
 */

const PALETTE = DEFAULT_TERRAIN_PALETTE.map((t) => ({ ...t }));

describe("one options resolver for the wizard and New map", () => {
	it("options default, moved tuning sliders travel as tune.<key>, unset ones stay out", () => {
		const kind = { options: WORLD_BIOMES_OPTIONS, tuning: WORLD_BIOMES_TUNING };
		const plain = optionsWithTuning(kind, {});
		expect(plain).toEqual(Object.fromEntries(WORLD_BIOMES_OPTIONS.map((o) => [o.key, o.default])));
		const tuned = optionsWithTuning(kind, { climate: "cold", [tuneKey("spread")]: "1.4", stray: "x" });
		expect(tuned.climate).toBe("cold");
		expect(tuned[tuneKey("spread")]).toBe("1.4");
		expect(Object.keys(tuned).filter((k) => k.startsWith("tune."))).toEqual([tuneKey("spread")]);
		expect(tuned.stray).toBeUndefined();
	});

	it("a scale's list starts on its first real generator", () => {
		expect(scaleStarter([{ id: BLANK_ID }, { id: WORLD_BIOMES_ID }])).toBe(WORLD_BIOMES_ID);
		expect(scaleStarter([{ id: BLANK_ID }])).toBe(BLANK_ID);
	});
});

describe("the Biomes scale's choice: Make every region now", () => {
	it("is offered with World biomes on the Biomes scale only, off by default, placed per surface", () => {
		expect(registry.mapScales().some((s) => s.id === BIOMES_SCALE_ID)).toBe(true);
		const with_ = moduleScaleChoices(BIOMES_SCALE_ID, WORLD_BIOMES_ID);
		expect(with_.map((c) => c.key)).toEqual([MAKE_ALL_REGIONS_CHOICE.key]);
		expect(with_[0].default).toBe(false);
		expect(with_[0].ids).toEqual({ Wizard: "Wizard.makeAllRegions", NewMap: "NewMap.makeAllRegions" });
		expect(moduleScaleChoices(BIOMES_SCALE_ID, BLANK_ID)).toEqual([]);
		expect(moduleScaleChoices("overland", "procedural:overland")).toEqual([]);
		expect(moduleScaleChoices(undefined, WORLD_BIOMES_ID)).toEqual([]);
	});

	it("values: as set, else the default", () => {
		const c = moduleScaleChoices(BIOMES_SCALE_ID, WORLD_BIOMES_ID);
		expect(scaleChoiceValues(c, {})).toEqual({ makeAll: false });
		expect(scaleChoiceValues(c, { makeAll: true })).toEqual({ makeAll: true });
	});
});

describe("New overworld…'s fields, shared with the Biomes scale", () => {
	it("region settings from the form's defaults (8 × 8 rect, normal blend), seed, gaps rule, river and pool", () => {
		expect(NEW_OVERWORLD_DEFAULTS).toEqual({ regionSize: 8, blend: "normal", makeAll: true, unclimated: "fill" });
		const f = newOverworldFields({ ...NEW_OVERWORLD_DEFAULTS, palette: "Expanded", stagger: "even", seed: 42, river: ["1_2", "2_2"], poolPath: "p.md" }, () => "w1");
		expect(f).toEqual({
			regions: { footprint: "rect", size: 8, blend: "normal", palette: "Expanded", worldId: "w1", stagger: "even" },
			biomeRiver: "1,2 > 2,2",
			biomePool: "p.md",
			seed: 42,
			biomeGaps: "fill gaps",
		});
		const bare = newOverworldFields({ ...NEW_OVERWORLD_DEFAULTS, palette: "Expanded", stagger: "odd", seed: 1, river: ["1_2"] }, () => "w2");
		expect(bare.biomeRiver).toBeUndefined();
		expect(bare.biomePool).toBeUndefined();
	});

	it("New overworld… starts on those defaults and makes its map through the shared function", () => {
		const src = readSurface("overworld-modals");
		for (const k of ["regionSize", "blend", "makeAll", "unclimated"]) expect(src).toContain(`= NEW_OVERWORLD_DEFAULTS.${k};`);
		expect(src).toContain("await finishNewOverworld(this.plugin, res.name, this.result, {");
		expect(src).not.toContain("withMeshFields(");
	});
});

/** A plugin with one map and a map store, enough for finishNewOverworld. */
function fakePlugin() {
	const map: MapData = { name: "world", paletteName: "Expanded", gridSize: { cols: 8, rows: 6 }, gridOffset: { x: 0, y: 0 } } as MapData;
	const hexes = new Map<string, Record<string, unknown>>();
	let saves = 0;
	const plugin = {
		settings: { hexOrientation: "flat", staggerOffset: "odd", maps: [map] },
		ensureOverworldBiomes: async () => {},
		getPaletteOrPresetTerrains: () => PALETTE,
		getMap: (n: string) => (n === map.name ? map : undefined),
		saveSettings: async () => { saves++; },
		mapStore: {
			all: () => hexes,
			get: (_m: string, k: string) => hexes.get(k),
			set: (_m: string, k: string, patch: Record<string, unknown>) => hexes.set(k, { ...hexes.get(k), ...patch }),
			flush: async () => {},
		},
	};
	return { plugin, map, hexes, saves: () => saves };
}

describe("a Biomes map from the wizard or New map is an overworld", () => {
	const grid = { cols: 8, rows: 6, offset: { x: 0, y: 0 }, stagger: "odd" as const };
	const made = (generatorId: string, extra: Record<string, unknown> = {}) => ({
		mapName: "world", generatorId, options: optionsWithTuning({ options: WORLD_BIOMES_OPTIONS, tuning: WORLD_BIOMES_TUNING }, { climate: "warm" }),
		seed: 7, grid, paletteName: "Expanded", choices: { makeAll: false }, onProgress: () => {}, ...extra,
	});

	it("World biomes: region settings, seed, and every hex's biome in the Biome column (no regions made by default)", async () => {
		const { plugin, map, hexes, saves } = fakePlugin();
		await runScaleMapMade(plugin as never, BIOMES_SCALE_ID, made(WORLD_BIOMES_ID));
		expect(map.regions).toMatchObject({ footprint: "rect", size: 8, blend: "normal", palette: "Expanded", stagger: "odd" });
		expect(map.regions?.worldId).toBeTruthy();
		expect(map.seed).toBe(7);
		expect(map.biomeGaps).toBe("fill gaps");
		expect(saves()).toBeGreaterThan(0);
		// The same layout the generator previewed: its terrain, with the biome beside it.
		const expected = worldBiomesFromOptions(gridKeys({ ...grid, orientation: "flat" }), "flat", "odd", PALETTE, 7, made(WORLD_BIOMES_ID).options);
		expect(hexes.size).toBe(expected.biomes.size);
		for (const [k, biome] of expected.biomes) expect(hexes.get(k)).toEqual({ terrain: expected.terrain.get(k), biome });
		// And the generator itself paints exactly that terrain.
		const helpers = { toPaths: () => ({ paths: [], missing: [] }), procGrid: (g: typeof grid) => ({ ...g, orientation: "flat" as const }) } as unknown as GeneratorHelpers;
		const gen = worldMapsRuntime.generators!(plugin as never, helpers).find((g) => g.id === WORLD_BIOMES_ID)!;
		const out = gen.generate({ terrains: PALETTE, grid, seed: 7, options: made(WORLD_BIOMES_ID).options } as never);
		expect(out.ok && [...out.cells].sort()).toEqual([...expected.terrain].sort());
	});

	it("Blank on the Biomes scale: the region settings only", async () => {
		const { plugin, map, hexes } = fakePlugin();
		await runScaleMapMade(plugin as never, BIOMES_SCALE_ID, made(BLANK_ID));
		expect(map.regions?.footprint).toBe("rect");
		expect(hexes.size).toBe(0);
	});

	it("other scales add nothing", async () => {
		const { plugin, map } = fakePlugin();
		await runScaleMapMade(plugin as never, "overland", made("procedural:overland"));
		expect(map.regions).toBeUndefined();
	});

	it("the wizard and New map both run the scale's setup after creating the map", () => {
		expect(readSurface("setup-wizard")).toMatch(/await runScaleMapMade\(plugin, scale\?\.id, made\);/);
		expect(readSurface("new-map-setup")).toMatch(/if \(scale\) await runScaleMapMade\(this\.plugin, scale\.id, madeWith\);/);
	});
});

describe("New map: What are you mapping? then the scale's generators (shared with the wizard)", () => {
	const modal = readSurface("new-map-setup");
	const wizard = readSurface("setup-wizard");

	it("both forms draw the scale cards, sliders and choices from src/ui/mapScaleForm.ts", () => {
		for (const src of [modal, wizard]) {
			expect(src).toMatch(/from "\.\.?\/ui\/mapScaleForm";/);
			expect(src).toContain("renderScaleCards(");
			expect(src).toContain("renderScaleChoices(");
			expect(src).not.toContain('"duckmage-wizard-orient-row duckmage-wizard-scale-row"');
		}
		expect(modal).toContain('renderScaleChoices(optsBox, moduleScaleChoices(scale?.id, kind?.id), this.scaleChoices, disclosure, "NewMap")');
		expect(wizard).toContain('renderScaleChoices(optsBox, moduleScaleChoices(ctx.scaleId, ctx.generatorId), ctx.scaleChoices, optsDisclosure, "Wizard")');
	});

	it("only new top-level maps get a scale, and none while placed next to a map", () => {
		expect(modal).toMatch(/private scales\(\): MapScaleDef\[\] \{\n\s+return this\.origin \|\| this\.asRegion \? \[\] :/);
		expect(modal).toMatch(/private activeScale\(\)[^{]*\{\n\s+if \(this\.placement\) return undefined;/);
		expect(modal).toContain("const pool = scale ? scaleGenerators(scale, shown) : shown;");
		expect(modal).toContain("const first = scale ? scaleStarter(fitting) : firstMapGenerator(");
		expect(modal).toContain("scaleField?.toggle(!locked);");
	});

	it("saved submap defaults keep the options only (tuning is per map)", () => {
		expect(modal).toContain("const opts = optionsWithDefaults(kind, this.options);");
		expect(modal).toMatch(/private resolvedOptions\(kind: TerrainGeneratorKind\)[^{]*\{\n\s+return optionsWithTuning\(kind, this\.options\);/);
	});
});
