/**
 * Neighbour-conditioned region generation (owner 2026-10-12: "the newest
 * block should consider itself one super-region … all neighbors that
 * already exist should be treated as set tiles … and should imply
 * influence"). A new or rerolled region is made on an enlarged canvas: its
 * own cells plus a margin of its made neighbours' real hexes, held fixed,
 * read by the draws, smoothing, a shore's land side and patches.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { PARITY_FILE, SCENARIOS, digest, runScenario, scenarioProfiles } from "./biomeParityFixtures";
import { OWNER_LAYOUT, ownerCase, ownerContinuity, ownerRun, ownerTypeOf, landClass } from "./regionMeshFixtures";
import { neighbourContext, seamContinuity, generateRegion } from "../src/overworld/regionGen";
import { regionCells, type RegionLayout } from "../src/overworld/layout";
import { BlendField } from "../src/overworld/blendField";
import { paletteTypeOf, planRegion, regionOrder, worldSeed } from "../src/overworld/regionWorld";
import { TUNING_PARAMS, tuned, tuningControlId } from "../src/overworld/biomeTuning";
import { layerOf, subSectionOf } from "../src/ui/placement";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import type { BiomeProfile } from "../src/overworld/biomes";

const parity = JSON.parse(readFileSync(PARITY_FILE, "utf8")) as Record<string, Record<string, string>>;
/** A scenario's profiles, every biome tuned (copies: the shipped-generator profiles are shared). */
const tunedProfiles = (s: (typeof SCENARIOS)[number], tuning: Record<string, number>) =>
	new Map([...scenarioProfiles(s)].map(([k, p]) => [k, { ...p, tuning: { ...(p.tuning ?? {}), ...tuning } } as BiomeProfile]));
const digests = (regions: Map<string, Map<string, string>>) => Object.fromEntries([...regions].map(([k, c]) => [k, digest(c)]));

describe("super-region: the owner's coast (demo world, region 4, 0)", () => {
	const before = ownerCase({ "neighbour-influence": 0 });
	const after = ownerCase();

	it("with no neighbour influence it is exactly the region the owner got", () => {
		expect(before.cells.size).toBe(64);
		for (const [k, t] of before.owner) expect(before.cells.get(k)).toBe(t);
	});

	it("its edge continues the neighbours' land and water: 15 of 22 edge hexes before, at least 20 after", () => {
		const b = seamContinuity(OWNER_LAYOUT, [4, 0], before.cells, before.pinned, ownerTypeOf);
		const a = seamContinuity(OWNER_LAYOUT, [4, 0], after.cells, after.pinned, ownerTypeOf);
		expect(b).toMatchObject({ edge: 22, matched: 15 });
		expect(a.edge).toBe(22);
		expect(a.matched).toBeGreaterThanOrEqual(20);
	});

	it("the land is on the right, below the northern neighbour's land (before: along the whole top)", () => {
		const xs = regionCells(OWNER_LAYOUT, 4, 0).map(([x]) => x);
		const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
		const land = (cells: Map<string, string>) => [...cells].filter(([, t]) => landClass(t) === "land").map(([k]) => Number(k.split("_")[0]));
		const meanX = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
		// The northern neighbour's bottom row: land only in its right two columns.
		const north = [...after.pinned].filter(([k]) => k.endsWith("_-1") && Number(k.split("_")[0]) >= 32).filter(([, t]) => landClass(t) === "land").map(([k]) => Number(k.split("_")[0]));
		expect(Math.min(...north)).toBeGreaterThan(mid);
		// Before: land along the whole top row, both halves.
		expect(land(before.cells).some((x) => x < mid)).toBe(true);
		// After: every land hex in the right half.
		expect(land(after.cells).length).toBeGreaterThan(0);
		expect(land(after.cells).every((x) => x > mid)).toBe(true);
		expect(meanX(land(after.cells))).toBeGreaterThan(meanX(land(before.cells)));
	});

	it("stays fast: an 8×8 region with four made neighbours takes about what it did (median of 15; under 2× the no-neighbour run, 60 ms ceiling for loaded machines)", () => {
		const median = (tuning?: Record<string, number>) => {
			const ms = Array.from({ length: 15 }, () => ownerCase(tuning).ms).sort((x, y) => x - y);
			return ms[7];
		};
		median(); // warm up
		const before = median({ "neighbour-influence": 0 }), after = median();
		expect(after).toBeLessThan(60);
		expect(after).toBeLessThan(before * 2 + 3);
	});
});

describe("super-region: seam continuity rises across the owner's demo world", () => {
	// Before: the whole world made without neighbour context (influence 0 everywhere; the
	// owner's own vault, with the world around made at the defaults then, matched 32).
	it("the four regions the owner added: from 38 of 49 edge hexes without context to at least 46", () => {
		const sum = (run: ReturnType<typeof ownerRun>) => {
			let edge = 0, matched = 0;
			for (const c of ownerContinuity(run).values()) { edge += c.edge; matched += c.matched; }
			return { edge, matched };
		};
		const b = sum(ownerRun({ "neighbour-influence": 0 }, { addedOnly: false }));
		const a = sum(ownerRun());
		expect(b).toEqual({ edge: 49, matched: 38 });
		expect(a.edge).toBe(49);
		expect(a.matched).toBeGreaterThanOrEqual(46);
	});

	it("every parity world: land/water continuity at the seams goes up", () => {
		for (const s of SCENARIOS) {
			const rate = (tuning: Record<string, number>) => {
				const profiles = tunedProfiles(s, tuning);
				const regions = runScenario(s, profiles);
				const typeOf = paletteTypeOf(s.palette);
				const pinned = new Map<string, string>();
				let edge = 0, matched = 0;
				const hexes = [...regions.keys()].map((k) => k.split("_").map(Number) as [number, number]);
				for (const [px, py] of regionOrder(hexes, s.layout.orientation, s.layout.parentStagger)) {
					const cells = regions.get(`${px}_${py}`)!;
					const c = seamContinuity(s.layout, [px, py], cells, pinned, typeOf);
					edge += c.edge; matched += c.matched;
					for (const [k, t] of cells) pinned.set(k, t);
				}
				return matched / edge;
			};
			const b = rate({ "neighbour-influence": 0 }), a = rate({});
			expect({ name: s.name, better: a > b + 0.03 }).toEqual({ name: s.name, better: true });
		}
	});
});

describe("super-region: no neighbours, no change (biome-tuning parity snapshots)", () => {
	it("with neighbour influence 0 every region is the snapshot", () => {
		for (const s of SCENARIOS) expect(digests(runScenario(s, tunedProfiles(s, { "neighbour-influence": 0 })))).toEqual(parity[s.name]);
	});

	it("with context depth 0 every region is the snapshot", () => {
		for (const s of SCENARIOS) expect(digests(runScenario(s, tunedProfiles(s, { "context-depth": 0 })))).toEqual(parity[s.name]);
	});

	it("at the defaults, the first region of each world (nothing made around it) is the snapshot", () => {
		for (const s of SCENARIOS) {
			const regions = runScenario(s);
			const first = [...regions.keys()][0];
			expect(digest(regions.get(first)!)).toBe(parity[s.name][first]);
		}
	});

	it("a region whose neighbours have a biome but no hexes yet is the snapshot's", () => {
		// The snapshot regions made first in each world had only biome neighbours: covered above;
		// here a lone region with pinned cells far from it (out of the context depth).
		const s = SCENARIOS[0];
		const profiles = scenarioProfiles(s);
		const biomes = new Map<string, string>([["0_0", "grassland"], ["1_0", "taiga"]]);
		const far = new Map<string, string>([["500_500", "forest"]]);
		const base = { layout: s.layout, parent: [0, 0] as [number, number], biomes, profiles, typeOf: paletteTypeOf(s.palette), worldSeed: 5, seed: 5 };
		expect(digest(planRegion({ ...base, pinned: far }).cells)).toBe(digest(planRegion(base).cells));
		expect(neighbourContext(s.layout, regionCells(s.layout, 0, 0), far, paletteTypeOf(s.palette), 3, 1)).toBeUndefined();
	});
});

describe("super-region: locked hexes and the context", () => {
	const layout: RegionLayout = { footprint: "rect", size: 8, orientation: "flat", parentStagger: "odd", childStagger: "odd" };
	const typeOf = paletteTypeOf(DEFAULT_TERRAIN_PALETTE);
	const profiles = scenarioProfiles(SCENARIOS[0]);
	const biomes = new Map<string, string>([["0_0", "coast"], ["1_0", "grassland"], ["0_1", "open-sea"]]);
	const field = new BlendField(layout, biomes, "normal", { seed: 3 });

	it("locked own hexes are never written and the rest of the region is made around them", () => {
		const own = regionCells(layout, 0, 0);
		const locked = new Map<string, string>(own.slice(0, 6).map(([x, y]) => [`${x}_${y}`, "mountain"]));
		const out = generateRegion({ layout, parent: [0, 0], field, profiles, pinned: locked, typeOf, seed: 11 });
		for (const k of locked.keys()) expect(out.has(k)).toBe(false);
		expect(out.size).toBe(own.length - locked.size);
	});

	it("the made neighbours' hexes are never written either: only the region's own cells come out", () => {
		const neighbour = new Map<string, string>(regionCells(layout, 1, 0).map(([x, y]) => [`${x}_${y}`, "forest"]));
		const out = generateRegion({ layout, parent: [0, 0], field, profiles, pinned: neighbour, typeOf, seed: 11 });
		const own = new Set(regionCells(layout, 0, 0).map(([x, y]) => `${x}_${y}`));
		for (const k of out.keys()) expect(own.has(k)).toBe(true);
		expect(out.size).toBe(own.size);
	});

	it("a forest next door carries on across the seam", () => {
		const neighbour = new Map<string, string>(regionCells(layout, 1, 0).map(([x, y]) => [`${x}_${y}`, "forest"]));
		const share = (influence: number) => {
			const t = { "neighbour-influence": influence };
			const tunedP = new Map([...profiles].map(([k, p]) => [k, { ...p, tuning: t }]));
			const out = generateRegion({ layout, parent: [0, 0], field, profiles: tunedP, pinned: neighbour, typeOf, seed: 11 });
			const c = seamContinuity(layout, [0, 0], out, neighbour, typeOf);
			const edgeForest = [...out].filter(([k, v]) => {
				const [x, y] = k.split("_").map(Number);
				return typeOf(v) === "forest" && regionCells(layout, 1, 0).some(([a, b]) => Math.abs(a - x) <= 1 && Math.abs(b - y) <= 1);
			}).length;
			return { c, edgeForest };
		};
		expect(share(1).edgeForest).toBeGreaterThan(share(0).edgeForest);
		expect(share(1).c.share).toBeGreaterThanOrEqual(share(0).c.share);
	});
});

describe("super-region: tuning", () => {
	it("context depth and neighbour influence are per-biome tuning, in Debug on the biome page", () => {
		const keys = TUNING_PARAMS.map((p) => p.key);
		expect(keys).toContain("context-depth");
		expect(keys).toContain("neighbour-influence");
		expect(tuned(undefined, "context-depth")).toBe(3);
		expect(tuned(undefined, "neighbour-influence")).toBe(1);
		for (const key of ["context-depth", "neighbour-influence"]) {
			expect(layerOf(tuningControlId(key))).toBe("debug");
			expect(subSectionOf(tuningControlId(key))).toBe("Borders & transitions");
		}
	});

	it("seam continuity counts edge hexes against the cells across the seam", () => {
		const layout: RegionLayout = { footprint: "rect", size: 2, orientation: "flat", parentStagger: "odd", childStagger: "odd" };
		const own = new Map(regionCells(layout, 0, 0).map(([x, y]) => [`${x}_${y}`, "grass"] as [string, string]));
		const water = new Map(regionCells(layout, 1, 0).map(([x, y]) => [`${x}_${y}`, "ocean"] as [string, string]));
		const land = new Map(regionCells(layout, 1, 0).map(([x, y]) => [`${x}_${y}`, "grass"] as [string, string]));
		const typeOf = paletteTypeOf(DEFAULT_TERRAIN_PALETTE);
		expect(seamContinuity(layout, [0, 0], own, water, typeOf).share).toBe(0);
		expect(seamContinuity(layout, [0, 0], own, land, typeOf).share).toBe(1);
		expect(seamContinuity(layout, [0, 0], own, new Map(), typeOf)).toEqual({ edge: 0, matched: 0, share: 1 });
		expect(worldSeed("x")).toBe(worldSeed("x"));
	});
});
