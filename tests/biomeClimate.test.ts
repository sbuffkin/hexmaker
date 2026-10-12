import { describe, it, afterEach } from "node:test";
import expect from "expect";
import { hexDistance, hexNeighbors } from "../packages/hex-wfc/src/grid";
import { DEFAULT_TERRAIN_PALETTE, LIMITED_TERRAIN_PALETTE } from "../src/constants";
import {
	MOISTURE_WORDS,
	TEMPERATURE_WORDS,
	climateKeyValues,
	formatClimateRange,
	isPlaceable,
	parseClimateRange,
	readClimate,
} from "../src/overworld/biomeClimate";
import { buildBiomeNote, parseBiomeNote, updateBiomeNote, type BiomeNoteFields } from "../src/overworld/biomeNote";
import { BIOME_PRESETS, biomePreset } from "../src/overworld/biomePresets";
import { BIOMES, biomeInfo, representativeTerrain, setBiomeSource } from "../src/overworld/biomes";
import { placementPool, worldBiomes, type WorldBiomesOptions } from "../src/overworld/worldBiomes";
import { lowland, worldBiomes as legacyWorldBiomes } from "./fixtures/worldBiomesLegacy";
import { climatesToAdd } from "../src/overworld/BiomeStore";
import { climateFromForm, fieldsFromForm, formFromFields, formProblem, formTypes } from "../src/overworld/biomeForm";

const hexWorld = (R: number): [number, number][] => {
	const out: [number, number][] = [];
	for (let x = 0; x <= 2 * R; x++) for (let y = 0; y <= 2 * R; y++) if (hexDistance([x, y], [R, R], "flat", "odd") <= R) out.push([x, y]);
	return out;
};
const rectWorld = (c: number, r: number): [number, number][] => {
	const out: [number, number][] = [];
	for (let x = 0; x < c; x++) for (let y = 0; y < r; y++) out.push([x, y]);
	return out;
};
const sorted = (m: Map<string, string>) => JSON.stringify([...m].sort());

afterEach(() => setBiomeSource(undefined));

describe("biome climate: reading and writing", () => {
	it("reads words, word ranges and numbers", () => {
		expect(parseClimateRange("cold–mild", TEMPERATURE_WORDS).range).toEqual({ lo: 0, hi: 0.6 });
		expect(parseClimateRange("Cold - Mild", TEMPERATURE_WORDS).range).toEqual({ lo: 0, hi: 0.6 });
		expect(parseClimateRange("cool to warm", TEMPERATURE_WORDS).range).toEqual({ lo: 0.2, hi: 0.8 });
		expect(parseClimateRange("wet", MOISTURE_WORDS).range).toEqual({ lo: 2 / 3, hi: 1 });
		expect(parseClimateRange("0.2–0.5", MOISTURE_WORDS).range).toEqual({ lo: 0.2, hi: 0.5 });
		expect(parseClimateRange("0.2-0.5", MOISTURE_WORDS).range).toEqual({ lo: 0.2, hi: 0.5 });
		expect(parseClimateRange("20% to 50%", MOISTURE_WORDS).range).toEqual({ lo: 0.2, hi: 0.5 });
		expect(parseClimateRange("wet..dry", MOISTURE_WORDS).problem).toBeDefined(); // backwards: turned round
		expect(parseClimateRange("any", MOISTURE_WORDS)).toEqual({});
	});

	it("reports what it can't read", () => {
		expect(parseClimateRange("toasty", TEMPERATURE_WORDS).problem).toMatch(/cold, cool, mild, warm, hot/);
		expect(parseClimateRange("0.4", TEMPERATURE_WORDS).problem).toMatch(/two ends/);
		expect(parseClimateRange("150–200", TEMPERATURE_WORDS).problem).toBeDefined();
		const r = readClimate(new Map([["elevation", "orbit"], ["chance", "lots"], ["coastal", "maybe"], ["moisture", "wet"]]));
		expect(r.problems.map((p) => p.key).sort()).toEqual(["chance", "coastal", "elevation"]);
		expect(r.climate).toEqual({ moisture: { lo: 2 / 3, hi: 1 } });
	});

	it("turns a backwards range round", () => {
		expect(parseClimateRange("mild–cold", TEMPERATURE_WORDS).range).toEqual({ lo: 0, hi: 0.6 });
		expect(parseClimateRange("0.5–0.2", TEMPERATURE_WORDS).range).toEqual({ lo: 0.2, hi: 0.5 });
	});

	it("writes words when the ends fall on word bands, else numbers", () => {
		expect(formatClimateRange({ lo: 0, hi: 0.6 }, TEMPERATURE_WORDS)).toBe("cold–mild");
		expect(formatClimateRange({ lo: 0.4, hi: 0.6 }, TEMPERATURE_WORDS)).toBe("mild");
		expect(formatClimateRange({ lo: 0.36, hi: 0.66 }, TEMPERATURE_WORDS)).toBe("0.36–0.66");
		expect(formatClimateRange({ lo: 2 / 3, hi: 1 }, MOISTURE_WORDS)).toBe("wet");
	});

	it("round-trips through a biome note and keeps the user's spelling", () => {
		const f: BiomeNoteFields = {
			id: "glass-wastes", label: "Glass wastes", mix: [{ type: "desert", weight: 3 }], transitions: [],
			climate: { temperature: { lo: 0.6, hi: 1 }, moisture: { lo: 0, hi: 1 / 3 }, elevation: "low", coastal: true, chance: 0.4, rare: true },
		};
		const text = buildBiomeNote(f);
		expect(text).toContain("temperature: warm–hot");
		expect(text).toContain("moisture: dry");
		expect(text).toContain("chance: 40%");
		const back = parseBiomeNote(text, "Glass wastes");
		expect(back.problems).toEqual([]);
		expect(back.fields.climate).toEqual(f.climate);
		// Same values, other spelling: left alone.
		const hand = text.replace("temperature: warm–hot", "temperature: Warm to Hot").replace("chance: 40%", "chance: 0.4");
		expect(updateBiomeNote(hand, back.fields)).toBe(hand);
		// Climate dropped: its keys go.
		const none = updateBiomeNote(text, { ...back.fields, climate: undefined });
		expect(none.split("\n---")[0]).not.toMatch(/temperature:|moisture:|elevation:|coastal:|chance:|rare:/);
		expect(parseBiomeNote(none, "Glass wastes").fields.climate).toBeUndefined();
	});

	it("a note with no climate keys has no climate (only placed by hand)", () => {
		const f = parseBiomeNote(buildBiomeNote({ id: "x", label: "X", mix: [{ type: "forest", weight: 1 }], transitions: [] }), "X").fields;
		expect(f.climate).toBeUndefined();
		expect(isPlaceable(f.climate)).toBe(false);
	});

	it("every biome the old generator placed has a climate, and its note round-trips it", () => {
		// Coast (never placed by the old generator) has a climate too since BC3; Custom (blank) never does.
		for (const b of BIOMES) expect(isPlaceable(BIOME_PRESETS.find((p) => p.id === b.id)?.climate)).toBe(true);
		for (const p of BIOME_PRESETS.filter((x) => x.climate)) {
			const back = parseBiomeNote(buildBiomeNote(p), p.label);
			expect(back.problems).toEqual([]);
			for (const k of ["temperature", "moisture"] as const) {
				const a = back.fields.climate?.[k], b = p.climate?.[k];
				if (!b) { expect(a).toBeUndefined(); continue; }
				expect(a!.lo).toBeCloseTo(b.lo, 6);
				expect(a!.hi).toBeCloseTo(b.hi, 6);
			}
			expect(back.fields.climate?.elevation).toBe(p.climate?.elevation);
			expect(back.fields.climate?.chance).toBe(p.climate?.chance);
			expect(!!back.fields.climate?.rare).toBe(!!p.climate?.rare);
			expect(!!back.fields.climate?.coastal).toBe(!!p.climate?.coastal);
		}
		expect(biomePreset("karst")!.climate).not.toBe(BIOME_PRESETS.find((p) => p.id === "karst")!.climate);
	});

	it("the shipped lowland boxes give the old lowland table's biome", () => {
		// The old table's biomes (the 2026-10-12 lowland biomes take parts of these boxes on purpose).
		const low = placementPool(BIOME_PRESETS.filter((p) => BIOMES.some((b) => b.id === p.id))).tryOrder.filter((c) => c.elevation === "low" && !c.coastal);
		for (let t = 0.005; t < 1; t += 0.01) {
			for (let m = 0.005; m < 1; m += 0.01) {
				const hit = low.find((c) => (!c.temperature || (t >= c.temperature.lo && t < c.temperature.hi + (c.temperature.hi >= 1 ? 1e-9 : 0)))
					&& (!c.moisture || (m >= c.moisture.lo && m < c.moisture.hi + (c.moisture.hi >= 1 ? 1e-9 : 0))));
				expect(hit?.id).toBe(lowland(t, m));
			}
		}
	});

	it("adds the shipped climate to built-in notes written before climates, once", () => {
		const old = BIOME_PRESETS.map((p) => ({ ...p, climate: undefined }));
		const mine = { ...old[0], climate: { elevation: "high" as const } };
		const plan = climatesToAdd([], [mine, ...old.slice(1), { id: "mine", label: "Mine", mix: [], transitions: [] }]);
		const withClimate = BIOME_PRESETS.filter((p) => p.climate);
		expect(plan.done.length).toBe(withClimate.length);
		expect(plan.add.map((b) => b.id)).toEqual(withClimate.slice(1).map((p) => p.id)); // own climate kept, user biome untouched
		expect(plan.add[0].climate).toEqual(BIOME_PRESETS[1].climate);
		expect(climatesToAdd(plan.done, old).add).toEqual([]);
	});

	it("shipped zones and rarity match the old table", () => {
		setBiomeSource(BIOME_PRESETS);
		for (const b of BIOMES) {
			expect(biomeInfo(b.id)?.zone).toBe(b.zone);
			expect(!!biomeInfo(b.id)?.rare).toBe(!!b.rare);
			expect(biomeInfo(b.id)?.temp).toBe(b.temp);
		}
	});
});

describe("biome form: climate section", () => {
	it("round-trips every shipped climate through the form", () => {
		for (const p of BIOME_PRESETS) {
			const s = formFromFields(p, formTypes(DEFAULT_TERRAIN_PALETTE, p));
			const back = fieldsFromForm(s, p.id).climate;
			expect(climateKeyValues(back)).toEqual(climateKeyValues(p.climate));
		}
	});

	it("blank climate fields mean no climate; bad ones block saving", () => {
		const s = formFromFields(undefined, formTypes(DEFAULT_TERRAIN_PALETTE));
		s.label = "Ash";
		s.mix.set("badlands", 3);
		expect(fieldsFromForm(s).climate).toBeUndefined();
		s.climate.temperature = "toasty";
		expect(formProblem(s, [])).toMatch(/^Climate: /);
		s.climate.temperature = "warm–hot";
		s.climate.elevation = "low";
		s.climate.chancePercent = 50;
		expect(formProblem(s, [])).toBeUndefined();
		expect(fieldsFromForm(s).climate).toEqual({ temperature: { lo: 0.6, hi: 1 }, elevation: "low", chance: 0.5 });
		expect(climateFromForm(s.climate).problems).toEqual([]);
	});
});

describe("World biomes from climates", () => {
	const SEEDS = [1, 2, 3, 7, 11, 42, 99, 123, 777, 2024, 31337, 65535];
	/**
	 * Deliberately updated for BC3 (owner, 2026-10-11). Coast got a climate
	 * (coastal lowland), so the shipped presets no longer give the old
	 * placement: the frozen copy is compared with the old generator's biomes
	 * (every shipped biome except Coast). With them:
	 * - Limited: still exactly the old placement.
	 * - Expanded: the same sea, river and climate fields; the biomes differ
	 *   only through one fix that came with BC3: the repairs (majority filter,
	 *   patch splits, rare swaps, transitions) no longer move a coastal-only
	 *   biome (Coastal fjord) inland. The old generator put it on ~90 inland
	 *   hexes over these cases; now a handful (only where a patch is boxed
	 *   in by biomes it may not touch). Everything downstream of those
	 *   repairs can shift, so ≥ 90% of hexes keep their old biome.
	 * Existing overworlds only change when they're regenerated.
	 */
	// The biomes the old generator knew (the BIOMES table): note-only ones (Coast, the 2026-10-12 additions) aren't placeable without their notes.
	const OLD_SET = BIOME_PRESETS.filter((p) => BIOMES.some((b) => b.id === p.id));
	const inlandCoastal = (r: { biomes: Map<string, string>; sea: Set<string> }) => [...r.biomes].filter(([k, b]) => {
		if (!BIOME_PRESETS.find((p) => p.id === b)?.climate?.coastal || r.sea.has(k)) return false;
		const [x, y] = k.split("_").map(Number);
		return !hexNeighbors(x, y, "flat", "odd").some(([a, c]) => r.sea.has(`${a}_${c}`));
	}).length;
	const cases: { cells: [number, number][]; o: Partial<WorldBiomesOptions> }[] = [
		{ cells: hexWorld(2), o: {} },
		{ cells: hexWorld(3), o: { climate: "varied" } },
		{ cells: hexWorld(5), o: { climate: "varied", water: 0.25 } },
		{ cells: rectWorld(10, 8), o: { climate: "cold", land: "two" } },
		{ cells: rectWorld(12, 9), o: { climate: "warm", land: "islands", water: 0.5 } },
		{ cells: rectWorld(7, 6), o: { climate: "temperate", north: "none", water: 0.1 } },
		{ cells: hexWorld(6), o: { climate: "varied", north: "warmer", water: 0.4 } },
	];

	it("reproduces the old placement exactly with the old biomes (Limited)", () => {
		for (const { cells, o } of cases) {
			for (const seed of SEEDS) {
				const opts = { seed, ...o };
				const old = legacyWorldBiomes(cells, "flat", "odd", LIMITED_TERRAIN_PALETTE, opts);
				const now = worldBiomes(cells, "flat", "odd", LIMITED_TERRAIN_PALETTE, { ...opts, biomes: OLD_SET });
				expect(sorted(now.biomes)).toBe(sorted(old.biomes));
				expect(sorted(now.terrain)).toBe(sorted(old.terrain));
				expect(now.river).toEqual(old.river);
				expect([...now.ecotones].sort()).toEqual([...old.ecotones].sort());
			}
		}
	});

	it("matches the old placement with the old biomes (Expanded), except coastal-only biomes stay on the coast", () => {
		let same = 0, total = 0, oldInland = 0, newInland = 0;
		for (const { cells, o } of cases) {
			for (const seed of SEEDS) {
				const opts = { seed, ...o };
				const old = legacyWorldBiomes(cells, "flat", "odd", DEFAULT_TERRAIN_PALETTE, opts);
				const now = worldBiomes(cells, "flat", "odd", DEFAULT_TERRAIN_PALETTE, { ...opts, biomes: OLD_SET });
				expect([...now.sea].sort()).toEqual([...old.sea].sort());
				expect(now.river).toEqual(old.river);
				expect(sorted(now.temperature as never)).toBe(sorted(old.temperature as never));
				newInland += inlandCoastal(now);
				oldInland += inlandCoastal(old);
				for (const [k, b] of old.biomes) { total++; if (now.biomes.get(k) === b) same++; }
				// Every hex is painted with its own biome's terrain.
				for (const [k, b] of now.biomes) expect(now.terrain.get(k)).toBe(representativeTerrain(b, DEFAULT_TERRAIN_PALETTE));
			}
		}
		expect(oldInland).toBeGreaterThan(50);
		expect(newInland).toBeLessThanOrEqual(oldInland / 10);
		expect(same / total).toBeGreaterThanOrEqual(0.9);
	});

	it("gives the same placement with the biomes loaded from notes, in any order", () => {
		for (const { cells, o } of cases.slice(0, 4)) {
			for (const seed of SEEDS.slice(0, 6)) {
				const opts = { seed, ...o };
				setBiomeSource(undefined);
				const shipped = worldBiomes(cells, "flat", "odd", DEFAULT_TERRAIN_PALETTE, { ...opts, biomes: OLD_SET });
				setBiomeSource([...BIOME_PRESETS].reverse());
				expect(sorted(worldBiomes(cells, "flat", "odd", DEFAULT_TERRAIN_PALETTE, { ...opts, biomes: [...OLD_SET].reverse() }).biomes)).toBe(sorted(shipped.biomes));
			}
		}
	});

	const ASH: BiomeNoteFields = {
		id: "ash-plains", label: "Ash plains", color: "#555555", mix: [{ type: "badlands", weight: 5 }, { type: "hills", weight: 1 }], transitions: [],
		climate: { temperature: { lo: 0.4, hi: 0.6 }, moisture: { lo: 0.3, hi: 0.5 }, elevation: "low" },
	};

	it("places a user biome with a narrow climate band in the hexes that fit it", () => {
		setBiomeSource([...BIOME_PRESETS, ASH]);
		let placed = 0, fitting = 0;
		for (const seed of SEEDS) {
			const r = worldBiomes(hexWorld(5), "flat", "odd", DEFAULT_TERRAIN_PALETTE, { seed, climate: "temperate", river: false });
			for (const [k, b] of r.biomes) {
				const t = r.temperature.get(k)!, m = r.moisture.get(k)!;
				if (b === "ash-plains") {
					placed++;
					// Placed where it fits (repairs may spread it a step, never far).
					expect(Math.abs(t - 0.5)).toBeLessThan(0.25);
				}
				if (!r.sea.has(k) && t >= 0.4 && t < 0.6 && m >= 0.3 && m < 0.5) fitting++;
			}
		}
		expect(fitting).toBeGreaterThan(0);
		expect(placed).toBeGreaterThan(fitting / 4);
		// Painted with its own terrain (its heaviest type's).
		const r = worldBiomes(hexWorld(5), "flat", "odd", DEFAULT_TERRAIN_PALETTE, { seed: 42, climate: "temperate" });
		for (const [k, b] of r.biomes) if (b === "ash-plains") expect(DEFAULT_TERRAIN_PALETTE.find((t) => t.name === r.terrain.get(k))?.type).toBe("badlands");
	});

	it("never places a biome without a climate", () => {
		const plain = { ...ASH, id: "plain-ash", label: "Plain ash", climate: undefined };
		setBiomeSource([...BIOME_PRESETS, plain]);
		for (const seed of SEEDS) {
			const r = worldBiomes(hexWorld(4), "flat", "odd", DEFAULT_TERRAIN_PALETTE, { seed, climate: "varied" });
			expect([...r.biomes.values()]).not.toContain("plain-ash");
		}
	});

	it("is deterministic with user biomes", () => {
		setBiomeSource([...BIOME_PRESETS, ASH]);
		const a = worldBiomes(hexWorld(4), "flat", "odd", DEFAULT_TERRAIN_PALETTE, { seed: 9 });
		const b = worldBiomes(hexWorld(4), "flat", "odd", DEFAULT_TERRAIN_PALETTE, { seed: 9 });
		expect(sorted(a.biomes)).toBe(sorted(b.biomes));
	});

	it("a lower chance takes a share of the fitting hexes", () => {
		const half = { ...ASH, climate: { ...ASH.climate!, chance: 0.5 } };
		setBiomeSource([...BIOME_PRESETS, ASH]);
		const full = SEEDS.reduce((s, seed) => s + [...worldBiomes(hexWorld(5), "flat", "odd", DEFAULT_TERRAIN_PALETTE, { seed, climate: "temperate", river: false }).biomes.values()].filter((b) => b === "ash-plains").length, 0);
		setBiomeSource([...BIOME_PRESETS, half]);
		const some = SEEDS.reduce((s, seed) => s + [...worldBiomes(hexWorld(5), "flat", "odd", DEFAULT_TERRAIN_PALETTE, { seed, climate: "temperate", river: false }).biomes.values()].filter((b) => b === "ash-plains").length, 0);
		expect(some).toBeGreaterThan(0);
		expect(some).toBeLessThan(full);
	});
});
