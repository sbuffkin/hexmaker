import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SPACE_SECTOR_TERRAINS, SPACE_SYSTEM_TERRAINS } from "../src/modules/space/presets";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { STAR_SCATTER_TUNING, starScatter } from "../src/space/starScatter";
import { ORBITS_TUNING, orbits } from "../src/space/orbits";
import { OVERLAND_TUNING, PLANET_SURFACE_TUNING, planetSurface } from "../src/worldgen/procedural/planetSurface";
import { WORLD_BIOMES_TUNING, worldBiomesFromOptions } from "../src/overworld/worldBiomes";
import { gridKeys, tuneKey, type ProcGrid, type TuningDef } from "../src/worldgen/procedural/common";
import { wfcTuning, withWfcTuning } from "../src/worldgen/registry";
import { parseBuiltin } from "../src/worldgen/builtinGenerators";

// The .md imports are stubbed in tests: read the shipped model from disk.
const GRASSLAND = parseBuiltin(readFileSync(path.join(process.cwd(), "src", "worldgen", "builtin", "biome-grassland.md"), "utf8"), "biome-grassland")!;
import { DEFAULT_SETTINGS, solve } from "../packages/hex-wfc/src";
import { layerOf } from "../src/ui/placement";
import { WIZARD_TUNING_ID, tuningText, wizardOptionId } from "../src/wizardText";
import { countSet, setLabel } from "../src/ui/disclosure";

/** Owner 2026-10-12: generator options above the fold; Advanced = 5–10 layout sliders. */

const grid = (cols: number, rows: number): ProcGrid => ({ cols, rows, offset: { x: 0, y: 0 }, stagger: "odd", orientation: "flat" });
const all = (defs: readonly TuningDef[], pick: (t: TuningDef) => number) =>
	Object.fromEntries(defs.map((t) => [tuneKey(t.key), String(pick(t))]));
const moved = (t: TuningDef) => (t.default + t.step * 2 <= t.max ? t.default + t.step * 2 : t.default - t.step * 2);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const cellsOf = (r: { cells: Map<string, string> }) => [...r.cells].sort();

const SETS: [string, readonly TuningDef[]][] = [
	["Overland", OVERLAND_TUNING],
	["Planet surface", PLANET_SURFACE_TUNING],
	["World biomes", WORLD_BIOMES_TUNING],
	["Star scatter", STAR_SCATTER_TUNING],
	["Orbits", ORBITS_TUNING],
	["Learned / shipped (WFC)", wfcTuning(GRASSLAND)],
];

describe("the wizard's generator options are above the fold; Advanced is the tuning sliders", () => {
	it("every generator option is main (owner override of the worksheet's advanced)", () => {
		for (const k of ["water", "climate", "relief", "sea", "rivers", "density"]) expect(layerOf(wizardOptionId(k))).toBe("main");
		expect(layerOf(WIZARD_TUNING_ID)).toBe("advanced");
	});

	it("the wizard places each slider in Advanced with an isSet, so the header counts the moved ones", () => {
		const src = readFileSync(path.join(process.cwd(), "src", "SetupWizardView.ts"), "utf8");
		expect(src).toContain("disclosure.place(WIZARD_TUNING_ID, row, isSet)");
		expect(src).toContain("disclosure.refreshSet()");
		expect(src).toMatch(/if \(v === t\.default\) delete ctx\.generatorOptions\[key\];/);
	});
});

describe("each generator has 5–10 sliders, with readable defaults inside their range", () => {
	for (const [name, defs] of SETS) {
		it(name, () => {
			expect(defs.length).toBeGreaterThanOrEqual(5);
			expect(defs.length).toBeLessThanOrEqual(10);
			expect(new Set(defs.map((t) => t.key)).size).toBe(defs.length);
			for (const t of defs) {
				expect(t.label).not.toBe("");
				expect(t.help.length).toBeGreaterThan(10);
				expect(t.default).toBeGreaterThanOrEqual(t.min);
				expect(t.default).toBeLessThanOrEqual(t.max);
				expect(t.step).toBeGreaterThan(0);
			}
		});
	}
	it("shows values with at most two decimals", () => {
		expect(tuningText(3.2)).toBe("3.2");
		expect(tuningText(0.1 + 0.2)).toBe("0.3");
		expect(tuningText(-15)).toBe("-15");
	});
});

describe("sliders at their defaults change nothing; a moved one changes the map", () => {
	const g = grid(24, 18);
	const exp = DEFAULT_TERRAIN_PALETTE.map((t) => ({ ...t }));

	it("Overland and Planet surface", () => {
		for (const [defs, flavor, base] of [[OVERLAND_TUNING, "overland", { water: "30", sea: "west" }], [PLANET_SURFACE_TUNING, "planet", { water: "50" }]] as const) {
			const plain = planetSurface(exp, g, 7, { ...base }, undefined, flavor);
			const atDefaults = planetSurface(exp, g, 7, { ...base, ...all(defs, (t) => t.default) }, undefined, flavor);
			expect(same(cellsOf(atDefaults), cellsOf(plain))).toBe(true);
			for (const t of defs) {
				const r = planetSurface(exp, g, 7, { ...base, [tuneKey(t.key)]: String(t.key === "features" ? 1.4 : t.key === "warmth" || t.key === "wetness" ? -0.5 : t.max) }, undefined, flavor);
				expect({ key: t.key, changed: !same(cellsOf(r), cellsOf(plain)) }).toEqual({ key: t.key, changed: true });
			}
		}
	});

	it("World biomes", () => {
		const keys = gridKeys(grid(14, 10));
		const plain = worldBiomesFromOptions(keys, "flat", "odd", exp, 11, {});
		const atDefaults = worldBiomesFromOptions(keys, "flat", "odd", exp, 11, all(WORLD_BIOMES_TUNING, (t) => t.default));
		expect(same([...atDefaults.biomes].sort(), [...plain.biomes].sort())).toBe(true);
		const changed = WORLD_BIOMES_TUNING.filter((t) => !same([...worldBiomesFromOptions(keys, "flat", "odd", exp, 11, { [tuneKey(t.key)]: String(t.key === "features" || t.key === "spread" ? t.min : t.max) }).biomes].sort(), [...plain.biomes].sort()));
		expect(changed.length).toBe(WORLD_BIOMES_TUNING.length);
	});

	it("Star scatter", () => {
		const sector = SPACE_SECTOR_TERRAINS.map((t) => ({ ...t }));
		const plain = starScatter(sector, g, 3, { clouds: "many" });
		expect(same(cellsOf(starScatter(sector, g, 3, { clouds: "many", ...all(STAR_SCATTER_TUNING, (t) => t.default) })), cellsOf(plain))).toBe(true);
		for (const t of STAR_SCATTER_TUNING) {
			const r = starScatter(sector, g, 3, { clouds: "many", [tuneKey(t.key)]: String(t.key === "nebulaAmount" ? 0 : moved(t)) });
			expect({ key: t.key, changed: !same(cellsOf(r), cellsOf(plain)) }).toEqual({ key: t.key, changed: true });
		}
	});

	it("Orbits", () => {
		const system = SPACE_SYSTEM_TERRAINS.map((t) => ({ ...t }));
		const big = grid(17, 17);
		const run = (seed: number, opts: Record<string, string>) => cellsOf(orbits(system, big, seed, opts));
		const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
		for (const s of seeds) expect(same(run(s, all(ORBITS_TUNING, (t) => t.default)), run(s, {}))).toBe(true);
		for (const t of ORBITS_TUNING) {
			const v = String(t.key === "firstOrbit" ? 4 : t.key === "emptyOrbits" ? 40 : t.default > 0.5 ? 0 : 1);
			const changed = seeds.some((s) => !same(run(s, { [tuneKey(t.key)]: v }), run(s, {})));
			expect({ key: t.key, changed }).toEqual({ key: t.key, changed: true });
		}
	});

	it("learned and shipped generators: the sliders start on the generator's own settings and override them", () => {
		const model = GRASSLAND;
		const defs = wfcTuning(model);
		const own = { ...DEFAULT_SETTINGS, ...(model.settings ?? {}) };
		expect(defs.find((t) => t.key === "clumping")!.default).toBe(own.neighbourInfluence);
		expect(withWfcTuning(model, {})).toBe(model);
		const tuned = withWfcTuning(model, { [tuneKey("clumping")]: "0", [tuneKey("randomness")]: "0.8" });
		expect(tuned.settings).toMatchObject({ neighbourInfluence: 0, randomness: 0.8 });
		const spec = { cols: 18, rows: 14, orientation: "flat" as const, seed: 5 };
		const a = solve(model, spec), b = solve(tuned, spec);
		expect(a.ok && b.ok).toBe(true);
		if (a.ok && b.ok) expect(same([...a.cells].sort(), [...b.cells].sort())).toBe(false);
	});
});

describe("the Advanced header counts moved sliders (isSet)", () => {
	it("a slider counts once moved off its default, and stops counting when reset", () => {
		// The wizard's isSet for each slider: its tune.<key> is in the options.
		const options: Record<string, string> = {};
		const reporters = OVERLAND_TUNING.map((t) => ({ where: null, isSet: () => options[tuneKey(t.key)] !== undefined }));
		expect(setLabel("Advanced", countSet(reporters).total)).toBe("Advanced");
		options[tuneKey("features")] = "2";
		options[tuneKey("hills")] = "10";
		expect(setLabel("Advanced", countSet(reporters).total)).toBe("Advanced · 2 set");
		delete options[tuneKey("hills")];
		expect(countSet(reporters).total).toBe(1);
	});
});
