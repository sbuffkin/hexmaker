/**
 * SP1 / F3: Star scatter places what the World types table says, a custom
 * world added to the palette included, and the World types preview's odds
 * (roleOdds over the same source) are the odds it really places.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { SPACE_SECTOR_TERRAINS } from "../src/palettes/presets";
import { starScatter, starScatterRoles } from "../src/worldgen/procedural/starScatter";
import { roleOdds } from "../src/worldgen/tableRoles";
import { worldTypesSource } from "../src/space/worldTypesSource";
import { DEFAULT_WORLD_TYPE_EXTRAS, DEFAULT_WORLD_TYPE_ROWS } from "../src/space/worldTypePresets";
import type { WorldTypeTable } from "../src/space/worldTypes";
import type { ProcGrid } from "../src/worldgen/procedural/common";
import type { TerrainColor } from "../src/types";

const DEFAULT_SPACE: WorldTypeTable = { name: "Default space", rows: [...DEFAULT_WORLD_TYPE_ROWS], ...DEFAULT_WORLD_TYPE_EXTRAS };
const grid = (n: number): ProcGrid => ({ cols: n, rows: n, offset: { x: 0, y: 0 }, stagger: "odd", orientation: "flat" });

/** Share of each terrain among the system hexes of many dense sectors. */
function placedShares(terrains: TerrainColor[], table: WorldTypeTable | undefined, seeds = 12): { shares: Record<string, number>; n: number; warnings: string[] } {
	const bg = starScatterRoles(terrains)!.background;
	const counts = new Map<string, number>();
	let n = 0;
	const warnings = new Set<string>();
	for (let seed = 1; seed <= seeds; seed++) {
		const src = table ? worldTypesSource(table, terrains) : undefined;
		const r = starScatter(terrains, grid(36), seed, { density: "cluster", clouds: "none", routes: "none" }, undefined, src);
		r.warnings.forEach((w) => warnings.add(w));
		for (const t of r.cells.values()) {
			if (t === bg) continue;
			counts.set(t, (counts.get(t) ?? 0) + 1);
			n++;
		}
	}
	return { shares: Object.fromEntries([...counts].map(([k, c]) => [k, c / n])), n, warnings: [...warnings] };
}

/** Each placed share within 4.5 standard errors of the preview's odds (and nothing else placed). */
function expectMatches(shares: Record<string, number>, n: number, odds: { terrain: string; odds: number }[]) {
	const want = Object.fromEntries(odds.map((o) => [o.terrain, o.odds]));
	for (const k of Object.keys(shares)) expect({ k, inOdds: k in want }).toEqual({ k, inOdds: true });
	for (const [k, p] of Object.entries(want)) {
		const got = shares[k] ?? 0;
		const se = Math.sqrt((p * (1 - p)) / n);
		expect({ k, ok: Math.abs(got - p) <= 4.5 * se + 1e-3 }).toEqual({ k, ok: true });
	}
}

describe("Star scatter rolls on the World types table (SP1)", () => {
	it("Default space: what it places matches the preview's odds, with no warnings", () => {
		const src = worldTypesSource(DEFAULT_SPACE, SPACE_SECTOR_TERRAINS);
		const preview = roleOdds(src, "sector-hexes", {}, starScatterRoles(SPACE_SECTOR_TERRAINS)!.worlds);
		const { shares, n, warnings } = placedShares(SPACE_SECTOR_TERRAINS, DEFAULT_SPACE);
		expect(n).toBeGreaterThan(10000);
		expect(warnings).toEqual([]);
		expectMatches(shares, n, preview.odds);
	});

	it("F3: a custom world added to the palette comes up at the odds the preview promises", () => {
		const palette: TerrainColor[] = [...SPACE_SECTOR_TERRAINS, { name: "Crystal world", color: "#aef", type: "world" }];
		const table: WorldTypeTable = { ...DEFAULT_SPACE, rows: [...DEFAULT_SPACE.rows, { world: "crystal world", weight: 17, map: "sector" }] };
		const preview = roleOdds(worldTypesSource(table, palette), "sector-hexes", {}, starScatterRoles(palette)!.worlds);
		// 17 of 34 world weight, of the 96% that aren't features. The palette's spelling.
		expect(preview.odds.find((o) => o.terrain === "Crystal world")!.odds).toBeCloseTo(0.48, 12);
		const { shares, n } = placedShares(palette, table);
		expectMatches(shares, n, preview.odds);
		expect(shares["Crystal world"]).toBeGreaterThan(0.45);
	});

	it("a weight change moves the odds (the table is what counts)", () => {
		const table: WorldTypeTable = { ...DEFAULT_SPACE, features: [], rows: DEFAULT_SPACE.rows.map((r) => (r.world === "ocean world" ? { ...r, weight: 100 } : r)) };
		const { shares } = placedShares(SPACE_SECTOR_TERRAINS, table, 4);
		expect(shares["ocean world"]).toBeGreaterThan(0.8);
		expect(shares["black hole"]).toBeUndefined();
	});

	it("rows that aren't terrains of the palette are never placed, and the warnings name them", () => {
		const table: WorldTypeTable = {
			...DEFAULT_SPACE,
			rows: [...DEFAULT_SPACE.rows, { world: "crystal world", weight: 50, map: "sector" }],
			features: [...(DEFAULT_SPACE.features ?? []), { feature: "wormhole", chance: 0.1 }],
		};
		const { shares, warnings } = placedShares(SPACE_SECTOR_TERRAINS, table, 2);
		expect(shares["crystal world"]).toBeUndefined();
		expect(warnings.join(" ")).toMatch(/Sector hexes row not a terrain of this palette, so never placed: crystal world/);
		expect(warnings.join(" ")).toMatch(/Sector features not a terrain of this palette, so never placed: wormhole/);
	});

	it("a custom palette with no shipped names, and its own table, works end to end", () => {
		const palette: TerrainColor[] = [
			{ name: "Abyssal Drift", color: "#000", type: "void" },
			{ name: "Hearthworld", color: "#0f0", type: "world" },
			{ name: "Cinder", color: "#f00", type: "world" },
			{ name: "Waystation", color: "#888", type: "station" },
		];
		const table: WorldTypeTable = {
			name: "Mine",
			rows: [{ world: "Hearthworld", weight: 3, map: "sector" }, { world: "Cinder", weight: 1, map: "sector" }],
			features: [{ feature: "Waystation", chance: 0.1 }],
		};
		const preview = roleOdds(worldTypesSource(table, palette), "sector-hexes", {}, starScatterRoles(palette)!.worlds);
		expect(Object.fromEntries(preview.odds.map((o) => [o.terrain, o.odds]))).toEqual({ Hearthworld: 0.9 * 0.75, Cinder: 0.9 * 0.25, Waystation: 0.1 });
		const { shares, n, warnings } = placedShares(palette, table);
		expect(warnings).toEqual([]);
		expectMatches(shares, n, preview.odds);
	});

	it("no table (None, or the shipped palette with nothing set): equal odds over the worlds, and it says so", () => {
		const worlds = starScatterRoles(SPACE_SECTOR_TERRAINS)!.worlds;
		const preview = roleOdds(undefined, "sector-hexes", {}, worlds);
		expect(preview.from).toBe("equal odds");
		for (const o of preview.odds) expect(o.odds).toBeCloseTo(1 / worlds.length, 12);
		const { shares, n, warnings } = placedShares(SPACE_SECTOR_TERRAINS, undefined, 6);
		expect(warnings.join(" ")).toMatch(/Sector hexes: no table, so equal odds/);
		expectMatches(shares, n, preview.odds);
	});

	it("a table with no row for this palette falls back to equal odds, and says so", () => {
		const palette: TerrainColor[] = [{ name: "Black", color: "#000", type: "void" }, { name: "Haven", color: "#0f0", type: "world" }];
		const r = starScatter(palette, grid(10), 1, { density: "dense" }, undefined, worldTypesSource(DEFAULT_SPACE, palette));
		expect(new Set(r.cells.values())).toEqual(new Set(["Black", "Haven"]));
		expect(r.warnings.join(" ")).toMatch(/never placed/);
	});

	it("a (nothing) row is empty space", () => {
		const table: WorldTypeTable = { name: "Empty", rows: [{ world: "(nothing)", weight: 1, map: "sector" }], features: [] };
		const r = starScatter(SPACE_SECTOR_TERRAINS, grid(10), 1, { density: "cluster", clouds: "none" }, undefined, worldTypesSource(table, SPACE_SECTOR_TERRAINS));
		expect(new Set(r.cells.values())).toEqual(new Set(["empty space"]));
	});
});
