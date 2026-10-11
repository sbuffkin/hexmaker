import { describe, it } from "node:test";
import expect from "expect";
import { hexDistance, hexNeighbors } from "../packages/hex-wfc/src/grid";
import { DEFAULT_TERRAIN_PALETTE, LIMITED_TERRAIN_PALETTE } from "../src/constants";
import { BlendField, REGION_WARP } from "../src/overworld/blendField";
import { WATER_TYPES, biomeInfo } from "../src/overworld/biomes";
import { regionCells, type RegionLayout } from "../src/overworld/layout";
import { generateRegion } from "../src/overworld/regionGen";
import { regionOrder } from "../src/overworld/regionWorld";
import { worldBiomes } from "../src/overworld/worldBiomes";
import type { TerrainColor } from "../src/types";
import { profilesFor, typeLookup } from "./overworldFixtures";

/**
 * Islands for watery biomes (#archipelago report: "the archipelago is just
 * open ocean"). Smoothing used to wash every scattered land cell out of an
 * archipelago region, so a region ringed by open sea was 100% water on
 * every seed. `landShare` / `minIslands` on the biome now guarantee islands.
 */

const brick = (size: number): RegionLayout => ({ footprint: "rect", size, orientation: "flat", parentStagger: "odd", childStagger: "odd" });
const flower = (size: number): RegionLayout => ({ footprint: "hex", size, orientation: "flat", parentStagger: "odd", childStagger: "odd" });

const water = new Set(WATER_TYPES);

function setup(palette: TerrainColor[]) {
	const profiles = profilesFor(palette);
	const typeOf = typeLookup(palette);
	const isLand = (t: string) => {
		const ty = typeOf(t);
		return ty !== undefined && !water.has(ty);
	};
	return { profiles, typeOf, isLand };
}

/** A 5×5 overworld: `centre` biome at 2,2, `around` everywhere else. */
function ringed(centre: string, around: string): Map<string, string> {
	const m = new Map<string, string>();
	for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) m.set(`${x}_${y}`, hexDistance([x, y], [2, 2], "flat", "odd") === 0 ? centre : around);
	return m;
}

/** Land patches (connected land cells) of a region's cells, by size. */
function islands(l: RegionLayout, cells: Map<string, string>, isLand: (t: string) => boolean): number[] {
	const land = new Set([...cells].filter(([, t]) => isLand(t)).map(([k]) => k));
	const seen = new Set<string>();
	const sizes: number[] = [];
	for (const k of land) {
		if (seen.has(k)) continue;
		let n = 0;
		const stack = [k];
		seen.add(k);
		while (stack.length) {
			const [x, y] = stack.pop()!.split("_").map(Number);
			n++;
			for (const [a, b] of hexNeighbors(x, y, l.orientation, l.childStagger)) {
				const nk = `${a}_${b}`;
				if (land.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
			}
		}
		sizes.push(n);
	}
	return sizes;
}

const allOcean = (l: RegionLayout) => {
	const pinned = new Map<string, string>();
	for (const [x, y] of hexNeighbors(2, 2, l.orientation, l.parentStagger)) for (const [a, b] of regionCells(l, x, y)) pinned.set(`${a}_${b}`, "ocean");
	return pinned;
};

describe("overworld islands (landShare / minIslands)", () => {
	const { profiles, typeOf, isLand } = setup(DEFAULT_TERRAIN_PALETTE);

	it("the archipelago biome asks for islands; open sea doesn't", () => {
		expect(biomeInfo("archipelago")?.minIslands).toBeGreaterThanOrEqual(1);
		expect(biomeInfo("archipelago")?.landShare).toBeGreaterThan(0);
		expect(biomeInfo("open-sea")?.minIslands).toBeUndefined();
		expect(biomeInfo("open-sea")?.landShare).toBeUndefined();
		expect(profiles.get("archipelago")?.minIslands).toBe(biomeInfo("archipelago")?.minIslands);
	});

	for (const [label, pinnedOf] of [["ringed by open sea", () => undefined], ["with all-ocean neighbour regions already made", allOcean]] as const) {
		it(`an 8×8 archipelago region ${label} always has 2+ small islands (200 seeds)`, () => {
			const l = brick(8);
			const biomes = ringed("archipelago", "open-sea");
			const pinned = pinnedOf(l);
			for (let seed = 1; seed <= 200; seed++) {
				const field = new BlendField(l, biomes, "normal", { warp: REGION_WARP, seed });
				const out = generateRegion({ layout: l, parent: [2, 2], field, profiles, typeOf, seed, pinned });
				const sizes = islands(l, out, isLand);
				const land = sizes.reduce((a, b) => a + b, 0);
				expect({ seed, islands: sizes.length >= 2 }).toEqual({ seed, islands: true });
				// Small islands, not a continent: under 45% land and no island over 16 hexes (beach included).
				expect({ seed, small: land / out.size < 0.45 && Math.max(...sizes) <= 16 }).toEqual({ seed, small: true });
				// Mostly still sea.
				expect([...out.values()].filter((t) => water.has(typeOf(t) ?? "")).length / out.size).toBeGreaterThan(0.6);
			}
		});
	}

	it("small regions still get land (rect 2–4, hex flowers 1–2)", () => {
		for (const l of [brick(2), brick(3), brick(4), flower(1), flower(2)]) {
			const biomes = ringed("archipelago", "open-sea");
			for (let seed = 1; seed <= 60; seed++) {
				const field = new BlendField(l, biomes, "normal", { warp: REGION_WARP, seed });
				const out = generateRegion({ layout: l, parent: [2, 2], field, profiles, typeOf, seed, pinned: allOcean(l) });
				expect({ l: `${l.footprint} ${l.size}`, seed, land: [...out.values()].some(isLand) }).toEqual({ l: `${l.footprint} ${l.size}`, seed, land: true });
			}
		}
	});

	it("open sea stays open", () => {
		const l = brick(8);
		for (let seed = 1; seed <= 50; seed++) {
			const field = new BlendField(l, ringed("open-sea", "open-sea"), "normal", { warp: REGION_WARP, seed });
			const out = generateRegion({ layout: l, parent: [2, 2], field, profiles, typeOf, seed });
			expect([...out.values()].filter(isLand)).toEqual([]);
		}
	});

	it("is deterministic and leaves pinned (locked) cells alone", () => {
		const l = brick(8);
		const field = new BlendField(l, ringed("archipelago", "open-sea"), "normal", { warp: REGION_WARP, seed: 4 });
		const own = regionCells(l, 2, 2).map(([x, y]) => `${x}_${y}`);
		const locked = new Map([own[0], own[27], own[36]].map((k) => [k, "ocean"]));
		const a = generateRegion({ layout: l, parent: [2, 2], field, profiles, typeOf, seed: 4, pinned: locked });
		const b = generateRegion({ layout: l, parent: [2, 2], field, profiles, typeOf, seed: 4, pinned: locked });
		expect([...a]).toEqual([...b]);
		for (const k of locked.keys()) expect(a.has(k)).toBe(false);
	});

	it("archipelago regions in generated worlds are never all water", () => {
		const l = brick(8);
		let n = 0;
		for (let seed = 1; seed <= 25; seed++) {
			const cells: [number, number][] = [];
			for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) cells.push([x, y]);
			const w = worldBiomes(cells, "flat", "odd", DEFAULT_TERRAIN_PALETTE, { seed, climate: "varied", water: 0.4 });
			const field = new BlendField(l, w.biomes, "normal", { warp: REGION_WARP, seed });
			const all = new Map<string, string>();
			for (const p of regionOrder(cells, "flat", "odd")) {
				const out = generateRegion({ layout: l, parent: p, field, profiles, typeOf, seed, pinned: all });
				for (const [k, v] of out) all.set(k, v);
				if (w.biomes.get(`${p[0]}_${p[1]}`) !== "archipelago") continue;
				n++;
				expect({ seed, p, land: [...out.values()].some(isLand) }).toEqual({ seed, p, land: true });
			}
		}
		expect(n).toBeGreaterThan(20);
	});

	it("works on the Limited palette too", () => {
		const lim = setup(LIMITED_TERRAIN_PALETTE);
		const l = brick(8);
		for (let seed = 1; seed <= 30; seed++) {
			const field = new BlendField(l, ringed("archipelago", "open-sea"), "normal", { warp: REGION_WARP, seed });
			const out = generateRegion({ layout: l, parent: [2, 2], field, profiles: lim.profiles, typeOf: lim.typeOf, seed });
			expect(islands(l, out, lim.isLand).length).toBeGreaterThanOrEqual(2);
		}
	});
});
