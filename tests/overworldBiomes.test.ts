import { describe, it } from "node:test";
import expect from "expect";
import { hexDistance, hexNeighbors } from "../packages/hex-wfc/src/grid";
import { DEFAULT_TERRAIN_PALETTE, LIMITED_TERRAIN_PALETTE } from "../src/constants";
import {
	BIOMES,
	biomeForTerrain,
	biomeGeneratorId,
	compatible,
	ecotoneBetween,
	isSeaBiome,
	representableBiomes,
	representativeTerrain,
	resolveBiome,
} from "../src/overworld/biomes";
import { MAX_PATCH, MAX_SHARE, lowland, worldBiomes, type WorldBiomesOptions } from "../src/overworld/worldBiomes";
import { BUILTIN_GENERATORS } from "../src/worldgen/builtinGenerators";

const EXP = DEFAULT_TERRAIN_PALETTE;

/** Hex-shaped overworld of radius R around (R, R). */
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

function landPatches(cells: [number, number][], res: ReturnType<typeof worldBiomes>): string[][] {
	const inMap = new Set(cells.map(([x, y]) => `${x}_${y}`));
	const seen = new Set<string>();
	const out: string[][] = [];
	for (const k of inMap) {
		if (seen.has(k) || res.sea.has(k)) continue;
		const b = res.biomes.get(k);
		const group = [k];
		seen.add(k);
		for (let i = 0; i < group.length; i++) {
			const [x, y] = group[i].split("_").map(Number);
			for (const [a, c] of hexNeighbors(x, y, "flat", "odd")) {
				const n = `${a}_${c}`;
				if (inMap.has(n) && !seen.has(n) && !res.sea.has(n) && res.biomes.get(n) === b) { seen.add(n); group.push(n); }
			}
		}
		out.push(group);
	}
	return out;
}

describe("biomes: terrain ↔ biome", () => {
	it("maps every land biome to a generator that ships", () => {
		const slugs = new Set(BUILTIN_GENERATORS.map((g) => g.slug));
		for (const b of BIOMES) {
			if (b.id === "open-sea") { expect(biomeGeneratorId(b.id)).toBeUndefined(); continue; }
			expect(slugs.has(b.slug!)).toBe(true);
		}
	});

	it("reads biomes from terrain: label, name hints, then type (§4.1)", () => {
		expect(biomeForTerrain("Taiga", EXP)).toBe("taiga");
		expect(biomeForTerrain("evergreen hills", EXP)).toBe("taiga");
		expect(biomeForTerrain("forest heavy", EXP)).toBe("deep-forest");
		expect(biomeForTerrain("mixed forest", EXP)).toBe("temperate-forest");
		expect(biomeForTerrain("jungle hills", EXP)).toBe("karst");
		expect(biomeForTerrain("jungle heavy", EXP)).toBe("jungle");
		expect(biomeForTerrain("mountains snow", EXP)).toBe("alpine");
		expect(biomeForTerrain("evergreen mountain", EXP)).toBe("alpine");
		expect(biomeForTerrain("hills", EXP)).toBe("valley");
		expect(biomeForTerrain("dunes", EXP)).toBe("badlands");
		expect(biomeForTerrain("bog", EXP)).toBe("swamp");
		expect(biomeForTerrain("ocean", EXP)).toBe("open-sea");
		expect(biomeForTerrain("shallows", EXP)).toBe("archipelago");
		expect(biomeForTerrain("beach", EXP)).toBe("coastal-fjord");
		expect(biomeForTerrain("volcano dormant", EXP)).toBe("volcanic");
		expect(biomeForTerrain("urban", EXP)).toBeUndefined();
		expect(biomeForTerrain("", EXP)).toBeUndefined();
		// custom names fall back to their type
		expect(biomeForTerrain("glass wastes", [{ name: "glass wastes", color: "#000", type: "desert" }])).toBe("badlands");
	});

	it("each representative terrain reads back as its biome (round trip)", () => {
		for (const palette of [EXP, LIMITED_TERRAIN_PALETTE]) {
			for (const b of representableBiomes(palette)) {
				expect(biomeForTerrain(representativeTerrain(b, palette)!, palette)).toBe(b);
			}
		}
	});

	it("Expanded shows every biome but the delta; Limited shows fewer and the rest fall back", () => {
		const exp = representableBiomes(EXP);
		expect(exp.size).toBe(BIOMES.length - 1);
		expect(exp.has("river-delta")).toBe(false);
		const lim = representableBiomes(LIMITED_TERRAIN_PALETTE);
		expect([...lim].sort()).toEqual(["alpine", "badlands", "grassland", "open-sea", "temperate-forest", "tundra", "valley"]);
		expect(resolveBiome("taiga", lim)).toBe("tundra");
		expect(resolveBiome("jungle", lim)).toBe("temperate-forest");
		expect(resolveBiome("archipelago", lim)).toBe("open-sea");
		expect(resolveBiome("river-delta", exp)).toBe("swamp");
	});

	it("ecotones: incompatible pairs and their transitions", () => {
		expect(ecotoneBetween("tundra", "temperate-forest")).toBe("taiga");
		expect(ecotoneBetween("badlands", "jungle")).toBe("savanna");
		expect(ecotoneBetween("grassland", "alpine")).toBe("valley");
		expect(compatible("taiga", "temperate-forest")).toBe(true);
		expect(compatible("tundra", "taiga")).toBe(true);
	});

	it("lowland climate table: cold → tundra, hot dry → badlands, hot wet → jungle", () => {
		expect(lowland(0.05, 0.5)).toBe("tundra");
		expect(lowland(0.3, 0.6)).toBe("taiga");
		expect(lowland(0.5, 0.5)).toBe("temperate-forest");
		expect(lowland(0.9, 0.1)).toBe("badlands");
		expect(lowland(0.9, 0.7)).toBe("jungle");
	});
});

describe("World biomes generator", () => {
	const SEEDS = Array.from({ length: 30 }, (_, i) => i * 7919 + 1);
	const opts = (seed: number, extra: Partial<WorldBiomesOptions> = {}): WorldBiomesOptions => ({ seed, climate: "varied", water: 0.3, ...extra });

	it("is deterministic for a seed and differs between seeds", () => {
		const cells = hexWorld(2);
		const a = worldBiomes(cells, "flat", "odd", EXP, opts(42));
		const b = worldBiomes([...cells].reverse(), "flat", "odd", EXP, opts(42));
		expect([...a.biomes].sort()).toEqual([...b.biomes].sort());
		expect([...a.terrain].sort()).toEqual([...b.terrain].sort());
		const different = SEEDS.some((s) => JSON.stringify([...worldBiomes(cells, "flat", "odd", EXP, opts(s)).biomes].sort()) !== JSON.stringify([...a.biomes].sort()));
		expect(different).toBe(true);
	});

	it("covers every hex with a biome and a palette terrain that reads back as it", () => {
		const cells = hexWorld(2);
		for (const seed of SEEDS) {
			const r = worldBiomes(cells, "flat", "odd", EXP, opts(seed));
			expect(r.biomes.size).toBe(19);
			for (const [k, b] of r.biomes) {
				expect(biomeForTerrain(r.terrain.get(k)!, EXP)).toBe(b);
				expect(isSeaBiome(b)).toBe(r.sea.has(k));
			}
		}
	});

	it("hits the water share exactly", () => {
		for (const water of [0.1, 0.3, 0.6]) {
			const r = worldBiomes(rectWorld(10, 8), "flat", "odd", EXP, opts(5, { water }));
			expect(r.sea.size).toBe(Math.round(water * 80));
		}
	});

	it("repairs for variety: patches of 1–5, no biome over 40% of land, enough distinct biomes", () => {
		for (const cells of [hexWorld(2), hexWorld(4), rectWorld(20, 20)]) {
			for (const seed of SEEDS.slice(0, cells.length > 100 ? 6 : 30)) {
				const r = worldBiomes(cells, "flat", "odd", EXP, opts(seed));
				const patches = landPatches(cells, r);
				expect(Math.max(...patches.map((p) => p.length))).toBeLessThanOrEqual(MAX_PATCH);
				const land = cells.length - r.sea.size;
				const counts = new Map<string, number>();
				for (const [k, b] of r.biomes) if (!r.sea.has(k)) counts.set(b, (counts.get(b) ?? 0) + 1);
				if (land >= 5) expect(Math.max(...counts.values()) / land).toBeLessThanOrEqual(MAX_SHARE + 1e-9);
				expect(counts.size).toBeGreaterThanOrEqual(Math.min(5, Math.floor(cells.length / 4), land));
			}
		}
	});

	it("puts transition biomes between incompatible neighbours", () => {
		let ecotones = 0, clashes = 0, pairs = 0;
		for (const seed of SEEDS) {
			const cells = rectWorld(12, 12);
			const r = worldBiomes(cells, "flat", "odd", EXP, opts(seed));
			ecotones += r.ecotones.size;
			for (const [x, y] of cells) {
				const k = `${x}_${y}`;
				if (r.sea.has(k)) continue;
				for (const [a, b] of hexNeighbors(x, y, "flat", "odd")) {
					const n = `${a}_${b}`;
					if (!r.biomes.has(n) || r.sea.has(n)) continue;
					pairs++;
					if (!compatible(r.biomes.get(k)!, r.biomes.get(n)!)) clashes++;
				}
			}
		}
		expect(ecotones).toBeGreaterThan(0);
		expect(clashes / pairs).toBeLessThan(0.01);
	});

	it("keeps rare biomes to about one per 20 hexes and builds a mountain chain on bigger land", () => {
		for (const seed of SEEDS) {
			const cells = hexWorld(2);
			const r = worldBiomes(cells, "flat", "odd", EXP, opts(seed, { water: 0.2 }));
			const rare = [...r.biomes.values()].filter((b) => BIOMES.find((i) => i.id === b)?.rare).length;
			expect(rare).toBeLessThanOrEqual(2); // cap 1, plus at most one ecotone (karst)
			expect([...r.biomes.values()].some((b) => b === "alpine" || b === "volcanic" || b === "valley")).toBe(true);
		}
	});

	it("climate options move the mix: cold worlds have tundra, warm ones jungle or savanna", () => {
		const cells = rectWorld(12, 12);
		const count = (climate: "cold" | "warm", ids: string[]) => SEEDS.slice(0, 10).reduce((n, seed) => {
			const r = worldBiomes(cells, "flat", "odd", EXP, opts(seed, { climate }));
			return n + [...r.biomes.values()].filter((b) => ids.includes(b)).length;
		}, 0);
		expect(count("cold", ["tundra", "taiga"])).toBeGreaterThan(count("warm", ["tundra", "taiga"]));
		expect(count("warm", ["jungle", "savanna", "badlands"])).toBeGreaterThan(count("cold", ["jungle", "savanna", "badlands"]));
	});

	it("traces a river from high ground to the sea", () => {
		const r = worldBiomes(rectWorld(10, 10), "flat", "odd", EXP, opts(9));
		expect(r.river.length).toBeGreaterThan(1);
		expect(r.sea.has(r.river[r.river.length - 1])).toBe(true);
		expect(worldBiomes(rectWorld(10, 10), "flat", "odd", EXP, opts(9, { river: false })).river).toEqual([]);
	});

	it("degrades sensibly on the Limited palette: only biomes it can show, all repairs still hold", () => {
		const shown = representableBiomes(LIMITED_TERRAIN_PALETTE);
		for (const seed of SEEDS.slice(0, 10)) {
			const cells = hexWorld(2);
			const r = worldBiomes(cells, "flat", "odd", LIMITED_TERRAIN_PALETTE, opts(seed));
			for (const [k, b] of r.biomes) {
				expect(shown.has(b)).toBe(true);
				expect(LIMITED_TERRAIN_PALETTE.some((t) => t.name === r.terrain.get(k))).toBe(true);
			}
			expect(Math.max(...landPatches(cells, r).map((p) => p.length))).toBeLessThanOrEqual(MAX_PATCH);
		}
	});

	it("handles tiny and all-sea worlds", () => {
		expect(worldBiomes([], "flat", "odd", EXP, opts(1)).biomes.size).toBe(0);
		const one = worldBiomes([[0, 0]], "flat", "odd", EXP, opts(1, { water: 0 }));
		expect(one.biomes.size).toBe(1);
		const sea = worldBiomes(rectWorld(3, 3), "pointy", "even", EXP, opts(1, { water: 0.9 }));
		expect(sea.sea.size).toBe(8);
	});

	it("is quick on a 400-hex continent", () => {
		const t0 = Date.now();
		worldBiomes(rectWorld(20, 20), "pointy", "even", EXP, opts(3, { land: "two" }));
		expect(Date.now() - t0).toBeLessThan(2000);
	});
});
