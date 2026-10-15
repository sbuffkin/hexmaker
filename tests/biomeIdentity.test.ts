/**
 * A region keeps its own biome among made neighbours (owner 2026-10-12:
 * "new regions mesh with their neighbours at the seams, but the region must
 * still clearly be its own biome"). Found in a demo sandbox: plain Alpine
 * set on a region ringed by forest regions came out all forest, its peaks
 * never placed. The neighbours' lean now fades with distance from the seam,
 * keepMix brings the type shares back to the biome's Mix (away from the
 * seams first, the seam band keeping its land and water), and min patches
 * may paint over a type the context pushed over its share.
 *
 * Numbers before and after: tests/measureBiomeIdentity.ts.
 */
import { describe, it, afterEach } from "node:test";
import expect from "expect";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { BIOME_PRESETS, biomePreset } from "../src/overworld/biomePresets";
import { profileFromFields, representativeTerrain, setBiomeSource, type BiomeProfile } from "../src/overworld/biomes";
import { childNeighbours, regionCells, type RegionLayout } from "../src/overworld/layout";
import { keepMix, mixDistance, placePatches, seamContinuity } from "../src/overworld/regionGen";
import { TUNING_PARAMS } from "../src/overworld/biomeTuning";
import { dominantTerrain, paletteTypeOf, planRegion, regionOrder, worldSeed } from "../src/overworld/regionWorld";
import { mulberry32 } from "../packages/hex-wfc/src/rng";
import { SCENARIOS, scenarioBiomes, scenarioProfiles } from "./biomeParityFixtures";
import { OWNER_BIOMES, OWNER_LAYOUT, OWNER_WORLD_ID, ownerProfiles, ownerTypeOf } from "./regionMeshFixtures";
import { allProfiles, ringCase, typeShares } from "./measureBiomeIdentity";

const typeOf = paletteTypeOf(DEFAULT_TERRAIN_PALETTE);
const profile = (id: string) => profileFromFields(biomePreset(id)!, DEFAULT_TERRAIN_PALETTE);
/** The old behaviour, for comparison: no seam fade, no Mix keeping. */
const OLD = { "neighbour-fade": 0, "keep-mix": 0 };

describe("mixDistance: the identity metric", () => {
	const p = { id: "t", types: new Map([["forest", 3], ["hills", 1]]), names: new Map() } as BiomeProfile;
	const tOf = (t: string) => t;
	it("0 for exactly the Mix, 1 for nothing in common, the moved share in between", () => {
		expect(mixDistance(new Map([["a", "forest"], ["b", "forest"], ["c", "forest"], ["d", "hills"]]), p, tOf)).toBeCloseTo(0);
		expect(mixDistance(new Map([["a", "water"], ["b", "water"]]), p, tOf)).toBeCloseTo(1);
		expect(mixDistance(new Map([["a", "forest"], ["b", "forest"], ["c", "forest"], ["d", "forest"]]), p, tOf)).toBeCloseTo(0.25);
	});
	it("untyped cells don't count; an empty region is 0", () => {
		expect(mixDistance(new Map([["a", "forest"], ["b", "forest"], ["c", "forest"], ["d", "hills"], ["e", "??"]]), p, (t) => (t === "??" ? undefined : t))).toBeCloseTo(0);
		expect(mixDistance(new Map(), p, tOf)).toBe(0);
	});
});

describe("Alpine among forest regions", () => {
	const mix = profile("alpine").types;
	const total = [...mix.values()].reduce((s, v) => s + v, 0);
	const want = (t: string) => (mix.get(t) ?? 0) / total;

	for (const around of ["temperate-forest", "taiga", "deep-forest"]) {
		it(`ringed by ${around}: peaks and mountains near their Mix share, the seams still continue`, () => {
			const now = ringCase("alpine", around);
			const old = ringCase("alpine", around, { tuning: OLD });
			const s = typeShares(now.cells);
			expect(s.get("peaks") ?? 0).toBeGreaterThanOrEqual(want("peaks") * 0.7);
			expect(s.get("mountains") ?? 0).toBeGreaterThanOrEqual(want("mountains") * 0.7);
			expect(s.get("forest") ?? 0).toBeLessThan(0.3);
			expect(mixDistance(now.cells, now.profile, typeOf)).toBeLessThan(0.2);
			// Without the fade and the Mix keeping, the forest takes most of it.
			expect(mixDistance(old.cells, old.profile, typeOf)).toBeGreaterThan(mixDistance(now.cells, now.profile, typeOf) + 0.3);
			// The forest still runs in at the seams: every edge hex continues its neighbour's land.
			const c = seamContinuity(now.layout, [2, 2], now.cells, now.pinned, typeOf);
			expect(c.share).toBe(1);
			const band = [...now.cells].filter(([k]) => {
				const [x, y] = k.split("_").map(Number);
				return childNeighbours(now.layout, x, y).some(([a, b]) => now.pinned.has(`${a}_${b}`));
			});
			const bandForest = band.filter(([, t]) => typeOf(t) === "forest").length / band.length;
			expect(bandForest).toBeGreaterThanOrEqual(0.35);
		});
	}

	it("the owner's demo world, every region made, then 4, 2 as Alpine: its own biome, every seam continued", () => {
		const ws = worldSeed(OWNER_WORLD_ID);
		const plain = ownerProfiles();
		const made = new Map<string, string>();
		const order = regionOrder([...OWNER_BIOMES.keys()].map((k) => k.split("_").map(Number) as [number, number]), OWNER_LAYOUT.orientation, OWNER_LAYOUT.parentStagger);
		for (const [px, py] of order) {
			const plan = planRegion({ layout: OWNER_LAYOUT, parent: [px, py], biomes: OWNER_BIOMES, profiles: plain, pinned: new Map(made), typeOf: ownerTypeOf, worldSeed: ws, seed: ws });
			for (const [k, t] of plan.cells) made.set(k, t);
		}
		const own = new Set(regionCells(OWNER_LAYOUT, 4, 2).map(([x, y]) => `${x}_${y}`));
		const pinned = new Map([...made].filter(([k]) => !own.has(k)));
		const biomes = new Map(OWNER_BIOMES).set("4_2", "alpine");
		const profiles = allProfiles();
		const plan = planRegion({ layout: OWNER_LAYOUT, parent: [4, 2], biomes, profiles, pinned, typeOf: ownerTypeOf, worldSeed: ws, seed: ws });
		expect(mixDistance(plan.cells, profiles.get("alpine")!, ownerTypeOf)).toBeLessThan(0.1);
		expect(seamContinuity(OWNER_LAYOUT, [4, 2], plan.cells, pinned, ownerTypeOf).share).toBe(1);
		expect(typeShares(plan.cells, ownerTypeOf).get("peaks") ?? 0).toBeGreaterThanOrEqual(want("peaks") * 0.7);
	});
});

describe("underground biomes among surface regions", () => {
	const cases: [string, string][] = [
		["caverns", "temperate-forest"], ["underdark", "grassland"], ["fungal-forest", "temperate-forest"],
		["underground-lake", "grassland"], ["mines", "taiga"], ["magma-caves", "temperate-forest"],
	];
	it("need no tuning of their own to keep their ground (the neighbour lean is on, as for every biome)", () => {
		for (const [id] of cases) {
			const t = biomePreset(id)!.tuning ?? {};
			expect({ id, influence: t["neighbour-influence"], depth: t["context-depth"] }).toEqual({ id, influence: undefined, depth: undefined });
		}
	});
	for (const [id, around] of cases) {
		it(`${id} ringed by ${around}: mostly its own types, close to its Mix, seams continued`, () => {
			const w = ringCase(id, around);
			const ownTypes = [...typeShares(w.cells)].filter(([t]) => w.profile.types.has(t)).reduce((s, [, v]) => s + v, 0);
			expect(ownTypes).toBeGreaterThanOrEqual(0.7);
			expect(mixDistance(w.cells, w.profile, typeOf)).toBeLessThan(0.3);
			expect(seamContinuity(w.layout, [2, 2], w.cells, w.pinned, typeOf).share).toBe(1);
		});
	}
});

describe("Magma caves reads as lava on the overworld", () => {
	afterEach(() => setBiomeSource(undefined));
	it("lava is its heaviest type, and its overworld hex is lava", () => {
		const mix = biomePreset("magma-caves")!.mix;
		const top = [...mix].sort((a, b) => b.weight - a.weight)[0];
		expect(top.type).toBe("lava");
		setBiomeSource(BIOME_PRESETS);
		expect(representativeTerrain("magma-caves", DEFAULT_TERRAIN_PALETTE)).toBe("lava flow");
	});
	it("still caves: cave floor and solid rock together outweigh the lava", () => {
		const w = (t: string) => biomePreset("magma-caves")!.mix.find((r) => r.type === t)?.weight ?? 0;
		expect(w("cave") + w("cave-wall")).toBeGreaterThan(w("lava"));
	});
	it("a region of it on its own is mostly lava (its parent hex fills with lava)", () => {
		const layout: RegionLayout = { footprint: "rect", size: 8, orientation: "flat", parentStagger: "odd", childStagger: "odd" };
		for (const seed of [1, 2, 3]) {
			const plan = planRegion({ layout, parent: [0, 0], biomes: new Map([["0_0", "magma-caves"]]), profiles: allProfiles(), typeOf, worldSeed: seed, seed, blend: "narrow" });
			expect(typeOf(dominantTerrain(plan.cells.values(), typeOf)!)).toBe("lava");
		}
	});
});

describe("keepMix and patches, directly", () => {
	// A 6×6 region, its left column next to a pinned forest neighbour.
	const layout: RegionLayout = { footprint: "rect", size: 6, orientation: "flat", parentStagger: "odd", childStagger: "odd" };
	const cells = regionCells(layout, 1, 0);
	const left = Math.min(...cells.map(([x]) => x));
	const pinned = new Map<string, string>(cells.filter(([x]) => x === left).map(([, y]) => [`${left - 1}_${y}`, "forest"]));
	const alpine = profile("alpine");
	const forestAll = () => new Map(cells.map(([x, y]) => [`${x}_${y}`, "forest"] as [string, string]));
	const run = (work: Map<string, string>, strength = 1) => keepMix({
		layout, cells, work, terrainAt: (k) => work.get(k) ?? pinned.get(k), typeOf, profile: alpine, pinned, strength,
		namesAt: (_x, _y, t) => alpine.names.get(t) ?? new Map(), rng: mulberry32(5),
	});

	it("brings an all-forest region to the Alpine Mix, the far side first, half the seam band still forest", () => {
		const work = forestAll();
		run(work);
		expect(mixDistance(work, alpine, typeOf)).toBeLessThan(0.25);
		const band = cells.filter(([x]) => x === left).map(([x, y]) => work.get(`${x}_${y}`)!);
		expect(band.filter((t) => typeOf(t) === "forest").length / band.length).toBeGreaterThanOrEqual(0.5);
		// The far column (no neighbour made there) changed.
		const right = Math.max(...cells.map(([x]) => x));
		expect(cells.filter(([x]) => x === right).some(([x, y]) => typeOf(work.get(`${x}_${y}`)!) !== "forest")).toBe(true);
	});

	it("strength 0 changes nothing; deterministic", () => {
		const a = forestAll();
		run(a, 0);
		expect([...a.values()].every((t) => t === "forest")).toBe(true);
		const b = forestAll(), c = forestAll();
		run(b); run(c);
		expect([...b]).toEqual([...c]);
	});

	it("never turns the seam band from land into water", () => {
		const open = profileFromFields(biomePreset("open-sea")!, DEFAULT_TERRAIN_PALETTE);
		const work = forestAll();
		keepMix({ layout, cells, work, terrainAt: (k) => work.get(k) ?? pinned.get(k), typeOf, profile: open, pinned, strength: 1, namesAt: (_x, _y, t) => open.names.get(t) ?? new Map(), rng: mulberry32(5) });
		for (const [x, y] of cells.filter(([x]) => x === left)) expect(typeOf(work.get(`${x}_${y}`)!)).toBe("forest");
		// Inside, the sea came back.
		expect([...work.values()].some((t) => typeOf(t) === "water" || typeOf(t) === "deep-water")).toBe(true);
	});

	it("min patches paint over a type with its own minimum only while it's over its Mix share", () => {
		const patch = (overShare: boolean) => {
			const work = forestAll();
			placePatches({ layout, cells, work, terrainAt: (k) => work.get(k) ?? pinned.get(k), typeOf, profile: alpine, influence: () => 1, overShare, rng: mulberry32(9) });
			return [...work.values()].filter((t) => typeOf(t) === "peaks").length;
		};
		// Forest (Alpine's forest has Min patches 1) filled every cell: no room before.
		expect(patch(false)).toBe(0);
		expect(patch(true)).toBeGreaterThan(0);
	});
});

describe("worlds: regions with neighbours keep closer to their biome", () => {
	it("every parity world: the mean identity of regions made after a neighbour drops, continuity stays at least 92%", () => {
		for (const s of SCENARIOS) {
			const measure = (tuning?: Record<string, number>) => {
				const profiles = scenarioProfiles(s, tuning ? (f) => ({ ...f, tuning: { ...(f.tuning ?? {}), ...tuning } }) : undefined);
				if (tuning && s.profiles === "models") for (const p of profiles.values()) p.tuning = { ...(p.tuning ?? {}), ...tuning };
				const biomes = scenarioBiomes(s, [...profiles.keys()].sort());
				const tOf = paletteTypeOf(s.palette);
				const ws = worldSeed(`parity-${s.name}`);
				const pin = new Map<string, string>();
				let d = 0, n = 0, edge = 0, matched = 0;
				const hexes = [...biomes.keys()].map((k) => k.split("_").map(Number) as [number, number]);
				for (const [px, py] of regionOrder(hexes, s.layout.orientation, s.layout.parentStagger)) {
					const plan = planRegion({ layout: s.layout, parent: [px, py], biomes, profiles, pinned: pin, typeOf: tOf, worldSeed: ws, seed: ws ^ (px * 131 + py * 17), ...(s.blend ? { blend: s.blend } : {}), ...(s.warp !== undefined ? { warp: s.warp } : {}) });
					const c = seamContinuity(s.layout, [px, py], plan.cells, pin, tOf);
					if (c.edge) { d += mixDistance(plan.cells, profiles.get(biomes.get(`${px}_${py}`)!)!, tOf); n++; }
					edge += c.edge; matched += c.matched;
					for (const [k, t] of plan.cells) pin.set(k, t);
				}
				return { identity: d / n, continuity: matched / edge };
			};
			const now = measure(), old = measure(OLD);
			expect({ name: s.name, closer: now.identity < old.identity - 0.05, continuity: now.continuity >= 0.92 }).toEqual({ name: s.name, closer: true, continuity: true });
		}
	});
});

describe("Seam band keeps neighbours (tuning band-keep)", () => {
	/** Share of the seam band (own cells next to a made neighbour) on the neighbours' type. */
	const bandShare = (w: ReturnType<typeof ringCase>, ty: string) => {
		const band = [...w.cells].filter(([k]) => {
			const [x, y] = k.split("_").map(Number);
			return childNeighbours(w.layout, x, y).some(([a, b]) => w.pinned.has(`${a}_${b}`));
		});
		return band.filter(([, t]) => typeOf(t) === ty).length / band.length;
	};

	it("is a Borders & transitions param, 0–1, defaulting to the old constant (0.5)", () => {
		const p = TUNING_PARAMS.find((x) => x.key === "band-keep")!;
		expect({ label: p.label, section: p.section, default: p.default, min: p.min, max: p.max }).toEqual({
			label: "Seam band keeps neighbours", section: "Borders & transitions", default: 0.5, min: 0, max: 1,
		});
	});

	it("parity: unset and set to its default make the same region", () => {
		for (const around of ["temperate-forest", "taiga"]) {
			const unset = ringCase("alpine", around);
			const atDefault = ringCase("alpine", around, { tuning: { "band-keep": 0.5 } });
			expect([...atDefault.cells]).toEqual([...unset.cells]);
		}
	});

	it("higher keeps more of the neighbours' terrain at the seam; lower keeps more of the region's own Mix", () => {
		const low = ringCase("alpine", "temperate-forest", { tuning: { "band-keep": 0 } });
		const mid = ringCase("alpine", "temperate-forest");
		const high = ringCase("alpine", "temperate-forest", { tuning: { "band-keep": 1 } });
		const [l, m, h] = [low, mid, high].map((w) => bandShare(w, "forest"));
		expect(l).toBeLessThanOrEqual(m);
		expect(m).toBeLessThanOrEqual(h);
		expect(h).toBeGreaterThan(l + 0.3);
		expect(h).toBeGreaterThanOrEqual(0.75);
		const [dl, dh] = [low, high].map((w) => mixDistance(w.cells, w.profile, typeOf));
		expect(dl).toBeLessThan(dh);
	});

	it("keepMix directly: 1 keeps the whole band on the neighbours' type, lower lets more of it go", () => {
		const layout: RegionLayout = { footprint: "rect", size: 6, orientation: "flat", parentStagger: "odd", childStagger: "odd" };
		const cells = regionCells(layout, 1, 0);
		const left = Math.min(...cells.map(([x]) => x));
		const pinned = new Map<string, string>(cells.filter(([x]) => x === left).map(([, y]) => [`${left - 1}_${y}`, "forest"]));
		const alpine = profile("alpine");
		const bandForest = (bandKeep?: number) => {
			const work = new Map(cells.map(([x, y]) => [`${x}_${y}`, "forest"] as [string, string]));
			keepMix({ layout, cells, work, terrainAt: (k) => work.get(k) ?? pinned.get(k), typeOf, profile: alpine, pinned, strength: 1, bandKeep,
				namesAt: (_x, _y, t) => alpine.names.get(t) ?? new Map(), rng: mulberry32(5) });
			const band = cells.filter(([x]) => x === left).map(([x, y]) => work.get(`${x}_${y}`)!);
			return { share: band.filter((t) => typeOf(t) === "forest").length / band.length, work: [...work] };
		};
		expect(bandForest(1).share).toBe(1);
		expect(bandForest(1).share).toBeGreaterThan(bandForest(0.5).share);
		expect(bandForest(0).share).toBeLessThanOrEqual(bandForest(0.5).share);
		// Default parity: omitted is exactly 0.5.
		expect(bandForest(undefined).work).toEqual(bandForest(0.5).work);
	});
});
