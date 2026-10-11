import { describe, it } from "node:test";
import expect from "expect";
import { mulberry32 } from "../packages/hex-wfc/src/rng";
import { MemVault } from "./helpers/memVault";
import {
	DEFAULT_WORLD_TYPES,
	buildWorldTypes,
	featureCells,
	formatChance,
	parseWorldTypes,
	pickSectorFeature,
	pickStar,
	pickWorldType,
	readChance,
	readFeatureCells,
	readStarCells,
	rollSectorFeatures,
	rollStars,
	sectorFeatureChances,
	sectorFeatureOdds,
	starCells,
	starOdds,
	starWeights,
	updateWorldTypes,
	upgradeWorldTypes,
	type SectorFeatureRow,
	type StarTypeRow,
	type WorldTypeTable,
} from "../src/space/worldTypes";
import {
	DEFAULT_SECTOR_FEATURE_ROWS,
	DEFAULT_STAR_ROWS,
	DEFAULT_WORLD_TYPE_EXTRAS,
	DEFAULT_WORLD_TYPE_ROWS,
} from "../src/space/worldTypePresets";
import { WorldTypeStore } from "../src/space/WorldTypeStore";
import { SPACE_SECTOR_TERRAINS, SPACE_SYSTEM_TERRAINS } from "../src/palettes/presets";
import type { TerrainColor } from "../src/types";

const DEFAULT: WorldTypeTable = {
	name: DEFAULT_WORLD_TYPES,
	rows: [...DEFAULT_WORLD_TYPE_ROWS],
	stars: [...DEFAULT_STAR_ROWS],
	features: [...DEFAULT_SECTOR_FEATURE_ROWS],
};

// ── frozen copy of the old built-in numbers (before stars and features were rows) ──
// src/worldgen/procedural/orbits.ts and starScatter.ts at 5133006. Do not
// update these to match new code: they are what Default space must equal.

const OLD_STAR_WEIGHTS: Record<string, number> = {
	"red dwarf": 6, "yellow star": 3, "brown dwarf": 1.5, "white dwarf": 1, "blue giant": 0.5,
};
const OLD_FEATURE_CHANCE = 0.04; // `roll < 0.04`
const OLD_FEATURE_WEIGHTS: Record<string, number> = { "deep-space station": 3, anomaly: 2, "black hole": 1 };
const OLD_FEATURE_TYPE_WEIGHTS: Record<string, number> = { station: 3, starport: 3, "jump-point": 3, anomaly: 1.5 };
const OLD_WORLD_WEIGHTS: Record<string, number> = {
	"garden world": 3, "desert world": 3, "barren world": 3.5, "ocean world": 2,
	"ice world": 2, "asteroid belt": 1.5, "molten world": 1, "gas giant": 1,
};
function oldWeightedPick(rand: () => number, names: string[], weights: Record<string, number>, fallback = 1): string | undefined {
	if (names.length === 0) return undefined;
	const w = names.map((n) => Math.max(0, weights[n.toLowerCase()] ?? fallback));
	const total = w.reduce((a, b) => a + b, 0);
	if (total <= 0) return names[Math.floor(rand() * names.length)];
	let r = rand() * total;
	for (let i = 0; i < names.length; i++) {
		r -= w[i];
		if (r < 0) return names[i];
	}
	return names[names.length - 1];
}
const ofTypes = (terrains: TerrainColor[], types: string[]) => terrains.filter((t) => types.includes(t.type ?? "")).map((t) => t.name);
/** Old starScatter weightsFor(features): name weight, else type weight. */
function oldFeatureWeights(terrains: TerrainColor[]): Record<string, number> {
	const out: Record<string, number> = {};
	for (const t of terrains) {
		if (!["station", "starport", "jump-point", "anomaly"].includes(t.type ?? "")) continue;
		const k = t.name.toLowerCase();
		const w = OLD_FEATURE_WEIGHTS[k] ?? OLD_FEATURE_TYPE_WEIGHTS[t.type ?? ""];
		if (w !== undefined) out[k] = w;
	}
	return out;
}

describe("Default space reproduces the old star and sector feature odds", () => {
	const stars = ofTypes(SPACE_SYSTEM_TERRAINS, ["star"]);
	const features = ofTypes(SPACE_SECTOR_TERRAINS, ["station", "starport", "jump-point", "anomaly"]);
	const worlds = ofTypes(SPACE_SECTOR_TERRAINS, ["world", "gas-giant", "asteroids"]);

	it("Orbits: the star weights are the old ones", () => {
		expect(starWeights(DEFAULT, { palette: SPACE_SYSTEM_TERRAINS })).toEqual(Object.fromEntries(stars.map((s) => [s, OLD_STAR_WEIGHTS[s]])));
	});

	it("Star scatter: each feature's chance per system hex is the old 4% split by the old weights", () => {
		const fw = oldFeatureWeights(SPACE_SECTOR_TERRAINS);
		const total = Object.values(fw).reduce((a, b) => a + b, 0);
		const chances = sectorFeatureChances(DEFAULT, { palette: SPACE_SECTOR_TERRAINS });
		expect(Object.keys(chances).sort()).toEqual(Object.keys(fw).sort());
		for (const [k, w] of Object.entries(fw)) expect(chances[k]).toBeCloseTo((OLD_FEATURE_CHANCE * w) / total, 15);
		expect(sectorFeatureOdds(DEFAULT, { palette: SPACE_SECTOR_TERRAINS }).total).toBeCloseTo(OLD_FEATURE_CHANCE, 15);
	});

	it("pickStar: the same random stream gives the same star, one draw", () => {
		for (let seed = 1; seed <= 1000; seed++) {
			const a = mulberry32(seed), b = mulberry32(seed);
			const old = oldWeightedPick(a, stars, OLD_STAR_WEIGHTS);
			expect(pickStar(DEFAULT, { seed, rand: b, palette: SPACE_SYSTEM_TERRAINS })?.terrain).toBe(old);
			expect(b()).toBe(a());
		}
	});

	it("pickSectorFeature: the same hexes become features, and ordinary systems stay in step", () => {
		let featureHexes = 0;
		for (let seed = 1; seed <= 300; seed++) {
			const a = mulberry32(seed), b = mulberry32(seed);
			for (let hex = 0; hex < 40; hex++) {
				// Old: `roll < 0.04` then a feature pick (a second draw), else a world pick.
				const roll = a();
				const f = pickSectorFeature(DEFAULT, { seed, rand: b, palette: SPACE_SECTOR_TERRAINS });
				expect(!!f).toBe(roll < OLD_FEATURE_CHANCE);
				if (f) {
					// One draw instead of the old two: the streams part here.
					featureHexes++;
					expect(features).toContain(f.terrain);
					break;
				}
				const old = oldWeightedPick(a, worlds, OLD_WORLD_WEIGHTS);
				expect(pickWorldType(DEFAULT, { map: "sector", seed, rand: b, palette: SPACE_SECTOR_TERRAINS })?.terrain).toBe(old);
				expect(b()).toBe(a());
			}
		}
		expect(featureHexes).toBeGreaterThan(50);
	});

	it("each feature takes its slice of the one draw, in palette order", () => {
		const at = (u: number) => pickSectorFeature(DEFAULT, { seed: 0, rand: () => u, palette: SPACE_SECTOR_TERRAINS })?.terrain ?? null;
		// Palette order: deep-space station, black hole, anomaly.
		expect(at(0)).toBe("deep-space station");
		expect(at(0.0199)).toBe("deep-space station");
		expect(at(0.0201)).toBe("black hole");
		expect(at(0.0266)).toBe("black hole");
		expect(at(0.0267)).toBe("anomaly");
		expect(at(0.0399)).toBe("anomaly");
		expect(at(0.04)).toBeNull();
		expect(at(0.99)).toBeNull();
	});

	it("over many hexes the features come up 3 : 2 : 1 in 4% of systems", () => {
		const counts = Object.fromEntries(rollSectorFeatures(DEFAULT, { palette: SPACE_SECTOR_TERRAINS }, 60000).map((c) => [c.feature, c.count]));
		const n = (k: string) => counts[k] / 60000;
		expect(n("deep-space station")).toBeGreaterThan(0.017);
		expect(n("deep-space station")).toBeLessThan(0.023);
		expect(n("anomaly")).toBeGreaterThan(0.011);
		expect(n("anomaly")).toBeLessThan(0.016);
		expect(n("black hole")).toBeGreaterThan(0.005);
		expect(n("black hole")).toBeLessThan(0.0085);
	});
});

describe("pickStar and pickSectorFeature", () => {
	const t: WorldTypeTable = {
		name: "T",
		rows: [],
		stars: [{ star: "Red dwarf", weight: 3 }, { star: "Pulsar", weight: 0 }, { star: "red dwarf", weight: 1 }, { star: "Blue giant" }],
		features: [{ feature: "Wreck", chance: 0.1 }, { feature: "Gate", chance: 0 }, { feature: "wreck", chance: 0.05 }, { feature: "Rift", chance: 0.2 }],
	};

	it("are deterministic for a seed", () => {
		for (let seed = 0; seed < 50; seed++) {
			expect(pickStar(t, { seed })).toEqual(pickStar(t, { seed }));
			expect(pickSectorFeature(t, { seed })).toEqual(pickSectorFeature(t, { seed }));
		}
	});

	it("add up a name's rows, never pick weight or chance 0, and keep to the palette (its spelling, its order)", () => {
		expect(starWeights(t)).toEqual({ "red dwarf": 4, "blue giant": 1 });
		expect(starOdds(t)).toEqual([{ star: "Red dwarf", odds: 0.8 }, { star: "Blue giant", odds: 0.2 }]);
		const counts = Object.fromEntries(rollStars(t, {}, 2000).map((c) => [c.star, c.count]));
		expect(counts.Pulsar).toBeUndefined();
		expect(counts["Red dwarf"] / 2000).toBeGreaterThan(0.75);
		expect(pickStar(t, { seed: 1, palette: [{ name: "BLUE GIANT" }, "pulsar"] })?.terrain).toBe("BLUE GIANT");
		expect(sectorFeatureChances(t)).toEqual({ wreck: 0.15000000000000002, rift: 0.2 });
		expect(sectorFeatureChances(t, { palette: ["rift", "gate"] })).toEqual({ rift: 0.2 });
		const at = (u: number, palette?: string[]) => pickSectorFeature(t, { seed: 0, rand: () => u, palette })?.terrain ?? null;
		expect(at(0.1)).toBe("Wreck");
		expect(at(0.16)).toBe("Rift");
		expect(at(0.1, ["RIFT", "Wreck"])).toBe("RIFT");
		expect(at(0.36)).toBeNull();
	});

	it("draw exactly once from the given stream (pickStar not at all when no star fits)", () => {
		let draws = 0;
		const rand = () => { draws++; return 0.5; };
		pickStar(t, { seed: 1, rand });
		expect(draws).toBe(1);
		expect(pickStar(t, { seed: 1, rand, palette: ["pulsar"] })).toBeNull();
		expect(draws).toBe(1);
		pickSectorFeature(t, { seed: 1, rand });
		expect(draws).toBe(2);
		expect(pickSectorFeature({ name: "none", rows: [] }, { seed: 1, rand })).toBeNull();
		expect(draws).toBe(3);
		expect(pickStar({ name: "none", rows: [] }, { seed: 1 })).toBeNull();
	});

	it("caps chances that add up past 100%", () => {
		const over: WorldTypeTable = { name: "O", rows: [], features: [{ feature: "A", chance: 0.7 }, { feature: "B", chance: 0.6 }] };
		expect(sectorFeatureOdds(over)).toEqual({ features: [{ feature: "A", chance: 0.7 }, { feature: "B", chance: 0.30000000000000004 }], total: 1 });
	});
});

describe("chance cells", () => {
	it("reads 1 in N, N/M, percents, fractions and never", () => {
		expect(readChance("1 in 50")).toBe(1 / 50);
		expect(readChance("1/75")).toBe(1 / 75);
		expect(readChance("2 out of 100")).toBe(0.02);
		expect(readChance("2%")).toBe(0.02);
		expect(readChance("0.5 %")).toBe(0.005);
		expect(readChance("0.04")).toBe(0.04);
		expect(readChance("never")).toBe(0);
		expect(readChance("0")).toBe(0);
		for (const bad of ["", "lots", "5", "150%", "3 in 2", "1 in 0", "-1%"]) expect(readChance(bad)).toBeNaN();
	});

	it("writes 1 in N when it is one, else a percent", () => {
		expect(formatChance(1 / 50)).toBe("1 in 50");
		expect(formatChance(1 / 150)).toBe("1 in 150");
		expect(formatChance(0.02)).toBe("1 in 50");
		expect(formatChance(0.03)).toBe("3%");
		expect(formatChance(0.375)).toBe("37.5%");
		expect(formatChance(0)).toBe("never");
		expect(formatChance(1)).toBe("100%");
		for (const c of [1 / 50, 1 / 75, 1 / 150, 0.03, 0.375, 0, 1]) expect(readChance(formatChance(c))).toBeCloseTo(c, 12);
	});
});

describe("Stars and Sector features in the note", () => {
	it("round-trips the shipped rows, each table under its heading", () => {
		const text = buildWorldTypes(DEFAULT_WORLD_TYPES, DEFAULT_WORLD_TYPE_ROWS, DEFAULT_WORLD_TYPE_EXTRAS);
		const p = parseWorldTypes(text);
		expect(p.problems).toEqual([]);
		expect(p.format).toBe(2);
		expect(p.rows).toEqual(DEFAULT_WORLD_TYPE_ROWS);
		expect(p.stars).toEqual(DEFAULT_STAR_ROWS);
		expect(p.features).toEqual(DEFAULT_SECTOR_FEATURE_ROWS);
		expect(text).toContain("## Stars");
		expect(text).toContain("| red dwarf | 6 |  |");
		expect(text).toContain("## Sector features");
		expect(text).toContain("| deep-space station | 1 in 50 |  |");
		expect(text).toContain("| black hole | 1 in 150 |  |");
		expect(text.indexOf("## Stars")).toBeLessThan(text.indexOf("## Sector features"));
	});

	it("reads forgivingly: any order, aliases, links, without headings; the worlds table's Stars column isn't a Stars table", () => {
		const text = [
			"| Odds | Sun |",
			"|--:|---|",
			"| 2 | [[Red dwarf]] |",
			"",
			"| World | Stars |",
			"|---|---|",
			"| rock | red dwarf |",
			"",
			"| Notes | Special | Chance per system |",
			"|---|---|---|",
			"| spooky | Black hole | 1/150 |",
			"|  | Station | 2% |",
		].join("\n");
		const p = parseWorldTypes(text);
		expect(p.problems).toEqual([]);
		expect(p.rows).toEqual([{ world: "rock", stars: ["red dwarf"] }]);
		expect(p.stars).toEqual([{ star: "Red dwarf", weight: 2 }]);
		expect(p.features).toEqual([{ feature: "Black hole", chance: 1 / 150, notes: "spooky" }, { feature: "Station", chance: 0.02 }]);
		expect(p.format).toBeUndefined();
		// A note with no such tables has none (not empty ones).
		const only = parseWorldTypes("| World |\n|---|\n| rock |");
		expect(only.stars).toBeUndefined();
		expect(only.features).toBeUndefined();
	});

	it("keeps rows it can't read, reports them, never uses them", () => {
		const text = buildWorldTypes("T", [{ world: "A" }], { stars: [{ star: "Sun" }], features: [{ feature: "Gate", chance: 0.1 }] })
			.replace("| Sun |", "| Dim | lots |  |\n| Sun |")
			.replace("| Gate |", "| Wreck | often |  |\n|  |  | just a note |\n| Gate |");
		const p = parseWorldTypes(text);
		expect(p.stars).toEqual([{ star: "Sun" }]);
		expect(p.features).toEqual([{ feature: "Gate", chance: 0.1 }]);
		expect(p.problems.map((x) => x.text)).toEqual([
			expect.stringMatching(/^Stars row \d+: weight "lots"/),
			expect.stringMatching(/^Sector features row \d+: chance "often" should look like 1 in 50 or 2%/),
			expect.stringMatching(/^Sector features row \d+: no feature/),
		]);
		const next = updateWorldTypes(text, [{ world: "A" }], { stars: [{ star: "Sun", weight: 2 }], features: [] });
		expect(next).toContain("| Dim | lots |");
		expect(next).toContain("| Wreck | often |");
		const q = parseWorldTypes(next);
		expect(q.stars).toEqual([{ star: "Sun", weight: 2 }]);
		expect(q.features).toEqual([]);
		for (const bad of [["", "2", ""], ["X", "much", ""]]) expect(readStarCells(bad).problem).toBeTruthy();
		for (const bad of [["", "2%", ""], ["X", "", ""], ["X", "7", ""]]) expect(readFeatureCells(bad).problem).toBeTruthy();
		expect(parseWorldTypes(buildWorldTypes("T", [], { features: [{ feature: "A", chance: 0.8 }, { feature: "B", chance: 0.5 }] })).problems[0].text).toMatch(/over 100%/);
	});

	it("the editor's cells read back as the row", () => {
		for (const r of [...DEFAULT_STAR_ROWS, { star: "Pulsar", weight: 0.25, notes: "rare | odd" }] as StarTypeRow[]) expect(readStarCells(starCells(r)).row).toEqual(r);
		for (const r of [...DEFAULT_SECTOR_FEATURE_ROWS, { feature: "Gate", chance: 0.03, notes: "n" }] as SectorFeatureRow[]) expect(readFeatureCells(featureCells(r)).row).toEqual(r);
	});

	it("rewrites only the tables that changed; same note when nothing did", () => {
		const text = buildWorldTypes("T", [{ world: "A" }], { stars: [{ star: "Sun" }], features: [{ feature: "Gate", chance: 0.02 }] })
			.replace("| Gate | 1 in 50 |", "| Gate | 2% |");
		expect(updateWorldTypes(text, [{ world: "A" }], { stars: [{ star: "Sun" }], features: [{ feature: "Gate", chance: 0.02 }] })).toBe(text);
		const next = updateWorldTypes(text, [{ world: "A" }], { stars: [{ star: "Sun", weight: 3 }] });
		expect(next).toContain("| Gate | 2% |"); // features untouched, as written
		expect(next).toContain("| Sun | 3 |  |");
		// Without extras the Stars / Sector features tables are left alone.
		expect(updateWorldTypes(text, [{ world: "B" }])).toContain("| Gate | 2% |");
	});

	it("a format 1 note is given the shipped stars and features once, and marked format 2", () => {
		const v2 = buildWorldTypes(DEFAULT_WORLD_TYPES, DEFAULT_WORLD_TYPE_ROWS);
		const v1 = v2.slice(0, v2.indexOf("## Stars")).replace("hexmaker-world-types: 2", "hexmaker-world-types: 1").trimEnd() + "\n\nMy own words.\n";
		const up = upgradeWorldTypes(v1, DEFAULT_WORLD_TYPE_EXTRAS);
		const p = parseWorldTypes(up);
		expect(p.format).toBe(2);
		expect(p.rows).toEqual(DEFAULT_WORLD_TYPE_ROWS);
		expect(p.stars).toEqual(DEFAULT_STAR_ROWS);
		expect(p.features).toEqual(DEFAULT_SECTOR_FEATURE_ROWS);
		expect(up).toContain("My own words.");
		expect(up.startsWith(v1.slice(0, v1.indexOf("My own words.")).replace("world-types: 1", "world-types: 2"))).toBe(true);
		expect(upgradeWorldTypes(up, DEFAULT_WORLD_TYPE_EXTRAS)).toBe(up);
		// A format 2 note whose Stars table was deleted stays without it.
		const deleted = up.slice(0, up.indexOf("## Stars")) + up.slice(up.indexOf("## Sector features"));
		expect(upgradeWorldTypes(deleted, DEFAULT_WORLD_TYPE_EXTRAS)).toBe(deleted);
		// A format 1 note that already has a Stars table keeps its own.
		const own = v1 + "\n| Star | Weight |\n| --- | --- |\n| Sun | 1 |\n";
		const ownUp = parseWorldTypes(upgradeWorldTypes(own, DEFAULT_WORLD_TYPE_EXTRAS));
		expect(ownUp.stars).toEqual([{ star: "Sun", weight: 1 }]);
		expect(ownUp.features).toEqual(DEFAULT_SECTOR_FEATURE_ROWS);
		// CRLF notes stay CRLF.
		expect(upgradeWorldTypes(v1.replace(/\n/g, "\r\n"), DEFAULT_WORLD_TYPE_EXTRAS)).toBe(up.replace(/\n/g, "\r\n"));
	});
});

// ── the store ────────────────────────────────────────────────────────────

function storePlugin(vault: MemVault, settings: Record<string, unknown> = {}) {
	return {
		app: vault.app(),
		manifest: { dir: ".obsidian/plugins/hexmaker" },
		settings: { worldFolder: "world", ...settings } as Record<string, unknown>,
		saveSettings: async () => {},
	};
}
const NOTE = `world/world-types/${DEFAULT_WORLD_TYPES}.md`;

describe("WorldTypeStore: stars and sector features", () => {
	it("seeds them, edits them, restores them", async () => {
		const v = new MemVault();
		const store = new WorldTypeStore(storePlugin(v) as never);
		await store.init();
		const t = store.get(DEFAULT_WORLD_TYPES)!;
		expect(t.stars).toEqual(DEFAULT_STAR_ROWS);
		expect(t.features).toEqual(DEFAULT_SECTOR_FEATURE_ROWS);
		await store.update(DEFAULT_WORLD_TYPES, t.rows, { stars: [{ star: "red dwarf", weight: 1 }], features: [{ feature: "anomaly", chance: 0.5 }] });
		expect(v.files.get(NOTE)).toContain("| anomaly | 1 in 2 |  |");
		expect(store.get(DEFAULT_WORLD_TYPES)!.stars).toEqual([{ star: "red dwarf", weight: 1 }]);
		await store.restoreDefault();
		expect(store.get(DEFAULT_WORLD_TYPES)!.stars).toEqual(DEFAULT_STAR_ROWS);
		expect(store.get(DEFAULT_WORLD_TYPES)!.features).toEqual(DEFAULT_SECTOR_FEATURE_ROWS);
		await store.create("Mine");
		expect(store.get("Mine")!.features).toEqual(DEFAULT_SECTOR_FEATURE_ROWS);
		await store.create("Bare", [], { stars: [], features: [] });
		expect(store.get("Bare")!.stars).toEqual([]);
	});

	it("upgrades a format 1 note when it reads it", async () => {
		const v2 = buildWorldTypes(DEFAULT_WORLD_TYPES, DEFAULT_WORLD_TYPE_ROWS);
		const v1 = v2.slice(0, v2.indexOf("## Stars")).replace("hexmaker-world-types: 2", "hexmaker-world-types: 1");
		const v = new MemVault({ [NOTE]: v1 });
		const store = new WorldTypeStore(storePlugin(v, { worldTypesSeeded: true }) as never);
		await store.init();
		expect(v.files.get(NOTE)).toContain("hexmaker-world-types: 2");
		expect(v.files.get(NOTE)).toContain("## Sector features");
		expect(store.get(DEFAULT_WORLD_TYPES)!.stars).toEqual(DEFAULT_STAR_ROWS);
		expect(store.get(DEFAULT_WORLD_TYPES)!.features).toEqual(DEFAULT_SECTOR_FEATURE_ROWS);
		expect(store.problemsOf(DEFAULT_WORLD_TYPES)).toEqual([]);
	});
});
