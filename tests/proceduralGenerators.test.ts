import { describe, it } from "node:test";
import expect from "expect";
import {
	SPACE_SECTOR_TERRAINS,
	SPACE_SYSTEM_TERRAINS,
} from "../src/palettes/presets";
import { DEFAULT_TERRAIN_PALETTE, LIMITED_TERRAIN_PALETTE } from "../src/constants";
import { starScatter, starScatterFits, starScatterRoles } from "../src/worldgen/procedural/starScatter";
import { orbits, orbitsFits, orbitRoles } from "../src/worldgen/procedural/orbits";
import { centerHex, distance, findTerrain, weightedPick, type ProcGrid } from "../src/worldgen/procedural/common";
import { mulberry32 } from "../packages/hex-wfc/src";
import { suggestBaseTerrain } from "../src/worldgen/registry";

const grid = (cols: number, rows: number, orientation: "flat" | "pointy" = "flat"): ProcGrid => ({
	cols, rows, offset: { x: 0, y: 0 }, stagger: "odd", orientation,
});

const count = (cells: Map<string, string>, pred: (t: string) => boolean) =>
	[...cells.values()].filter(pred).length;

describe("procedural helpers", () => {
	it("findTerrain matches names case-insensitively, then falls back to a category", () => {
		const t = [{ name: "Void", color: "#000", category: "space" }, { name: "x", color: "#111", category: "space" }];
		expect(findTerrain(t, ["void"])).toBe("Void");
		expect(findTerrain(t, ["nothing"], "space")).toBe("Void");
		expect(findTerrain(t, ["nothing"])).toBeUndefined();
	});

	it("weightedPick honours weights and is deterministic per seed", () => {
		const r = mulberry32(1);
		const picks = Array.from({ length: 2000 }, () => weightedPick(r, ["a", "b"], { a: 9, b: 1 }));
		const a = picks.filter((p) => p === "a").length;
		expect(a).toBeGreaterThan(1600);
		expect(weightedPick(mulberry32(5), [], {})).toBeUndefined();
	});

	it("suggests void / empty space as the base terrain", () => {
		expect(suggestBaseTerrain(SPACE_SYSTEM_TERRAINS)).toBe("void");
		expect(suggestBaseTerrain(SPACE_SECTOR_TERRAINS)).toBe("empty space");
		expect(suggestBaseTerrain(DEFAULT_TERRAIN_PALETTE)).toBeUndefined();
	});
});

describe("star scatter", () => {
	it("fits the sector palette but not fantasy palettes", () => {
		expect(starScatterFits(SPACE_SECTOR_TERRAINS)).toBe(true);
		expect(starScatterFits(LIMITED_TERRAIN_PALETTE)).toBe(false);
		expect(starScatterFits(DEFAULT_TERRAIN_PALETTE)).toBe(false);
	});

	it("resolves roles from the sector preset", () => {
		const roles = starScatterRoles(SPACE_SECTOR_TERRAINS)!;
		expect(roles.background).toBe("empty space");
		expect(roles.worlds).toContain("garden world");
		expect(roles.clouds).toEqual(expect.arrayContaining(["nebula", "dust cloud"]));
		expect(roles.clouds).not.toContain("rift");
		expect(roles.features).not.toContain("star system");
	});

	it("fills every hex, deterministically for a seed", () => {
		const g = grid(8, 10);
		const a = starScatter(SPACE_SECTOR_TERRAINS, g, 42);
		const b = starScatter(SPACE_SECTOR_TERRAINS, g, 42);
		expect(a.cells.size).toBe(80);
		expect([...a.cells]).toEqual([...b.cells]);
		const c = starScatter(SPACE_SECTOR_TERRAINS, g, 43);
		expect([...c.cells]).not.toEqual([...a.cells]);
	});

	it("density changes how many systems roll", () => {
		const g = grid(32, 40);
		const names = new Set(SPACE_SECTOR_TERRAINS.filter((t) => t.category !== "space").map((t) => t.name));
		const systems = (density: string) =>
			count(starScatter(SPACE_SECTOR_TERRAINS, g, 7, { density, clouds: "none" }).cells, (t) => names.has(t));
		const sparse = systems("sparse"), standard = systems("standard"), dense = systems("dense");
		expect(sparse).toBeLessThan(standard);
		expect(standard).toBeLessThan(dense);
		// Standard ≈ half of 1280 hexes.
		expect(standard).toBeGreaterThan(1280 * 0.42);
		expect(standard).toBeLessThan(1280 * 0.58);
	});

	it("only uses palette terrains", () => {
		const names = new Set(SPACE_SECTOR_TERRAINS.map((t) => t.name));
		const r = starScatter(SPACE_SECTOR_TERRAINS, grid(16, 16), 3, { clouds: "many" });
		for (const t of r.cells.values()) expect(names.has(t)).toBe(true);
	});

	it("draws jump routes between systems within range, only when a path type is given", () => {
		const g = grid(16, 16);
		const without = starScatter(SPACE_SECTOR_TERRAINS, g, 9, { routes: "2" });
		expect(without.paths).toEqual([]);
		expect(without.warnings.join(" ")).toMatch(/Jump route/);

		const r = starScatter(SPACE_SECTOR_TERRAINS, g, 9, { routes: "2" }, "Jump route");
		expect(r.paths.length).toBeGreaterThan(0);
		for (const p of r.paths) {
			expect(p.type).toBe("Jump route");
			const [a, b] = p.hexes.map((k) => k.split("_").map(Number) as [number, number]);
			expect(distance(a, b, g)).toBeLessThanOrEqual(2);
		}
		const none = starScatter(SPACE_SECTOR_TERRAINS, g, 9, { routes: "none" }, "Jump route");
		expect(none.paths).toEqual([]);
	});

	it("works on a minimal custom palette (renamed terrains, categories only)", () => {
		const custom = [
			{ name: "Black", color: "#000", category: "space" },
			{ name: "Haven", color: "#0f0", category: "worlds" },
		];
		expect(starScatterFits(custom)).toBe(true);
		const r = starScatter(custom, grid(6, 6), 1, { density: "dense" });
		expect(new Set(r.cells.values())).toEqual(new Set(["Black", "Haven"]));
	});
});

describe("orbits", () => {
	it("fits the system palette but not the sector or fantasy palettes", () => {
		expect(orbitsFits(SPACE_SYSTEM_TERRAINS)).toBe(true);
		expect(orbitsFits(SPACE_SECTOR_TERRAINS)).toBe(false);
		expect(orbitsFits(LIMITED_TERRAIN_PALETTE)).toBe(false);
	});

	it("resolves roles from the system preset", () => {
		const roles = orbitRoles(SPACE_SYSTEM_TERRAINS)!;
		expect(roles.background).toBe("void");
		expect(roles.stars).toHaveLength(5);
		expect(roles.bodies).not.toContain("moon");
		expect(roles.belt).toBe("asteroid belt");
		expect(roles.jumpPoint).toBe("jump point");
	});

	for (const orientation of ["flat", "pointy"] as const) {
		it(`puts a star at the centre and bodies on rings (${orientation})`, () => {
			const g = grid(13, 13, orientation);
			const r = orbits(SPACE_SYSTEM_TERRAINS, g, 11, { bodies: "crowded" });
			expect(r.cells.size).toBe(169);
			const [cx, cy] = centerHex(g);
			const stars = new Set(orbitRoles(SPACE_SYSTEM_TERRAINS)!.stars);
			expect(stars.has(r.cells.get(`${cx}_${cy}`)!)).toBe(true);
			// Exactly one star.
			expect(count(r.cells, (t) => stars.has(t))).toBe(1);
			// Non-belt planets: at most one per ring.
			const planets = new Set(["terrestrial planet", "ocean planet", "desert planet", "ice planet", "rocky planet", "molten planet", "gas giant", "ice giant"]);
			const ringsUsed = new Map<number, number>();
			for (const [k, t] of r.cells) {
				if (!planets.has(t)) continue;
				const d = distance([cx, cy], k.split("_").map(Number) as [number, number], g);
				ringsUsed.set(d, (ringsUsed.get(d) ?? 0) + 1);
			}
			expect(ringsUsed.size).toBeGreaterThan(1);
			for (const n of ringsUsed.values()) expect(n).toBe(1);
		});
	}

	it("honours a chosen star", () => {
		const g = grid(9, 9);
		const r = orbits(SPACE_SYSTEM_TERRAINS, g, 5, { star: "blue giant" });
		const [cx, cy] = centerHex(g);
		expect(r.cells.get(`${cx}_${cy}`)).toBe("blue giant");
	});

	it("is deterministic and only uses palette terrains", () => {
		const g = grid(13, 13);
		const a = orbits(SPACE_SYSTEM_TERRAINS, g, 77);
		expect([...a.cells]).toEqual([...orbits(SPACE_SYSTEM_TERRAINS, g, 77).cells]);
		const names = new Set(SPACE_SYSTEM_TERRAINS.map((t) => t.name));
		for (const t of a.cells.values()) expect(names.has(t)).toBe(true);
	});

	it("draws each occupied orbit as a closed ring of adjacent hexes when given a path type", () => {
		const g = grid(13, 13);
		expect(orbits(SPACE_SYSTEM_TERRAINS, g, 21).paths).toEqual([]);
		const r = orbits(SPACE_SYSTEM_TERRAINS, g, 21, { bodies: "crowded" }, "Orbit");
		expect(r.paths.length).toBeGreaterThan(1);
		const [cx, cy] = centerHex(g);
		for (const p of r.paths) {
			expect(p.type).toBe("Orbit");
			expect(p.hexes[0]).toBe(p.hexes[p.hexes.length - 1]);
			const pts = p.hexes.map((k) => k.split("_").map(Number) as [number, number]);
			const d = distance([cx, cy], pts[0], g);
			expect(pts.length - 1).toBe(6 * d); // a full ring has 6d hexes
			for (let i = 1; i < pts.length; i++) {
				expect(distance(pts[i - 1], pts[i], g)).toBe(1);
				expect(distance([cx, cy], pts[i], g)).toBe(d);
			}
		}
	});

	it("warns on maps too small for orbits", () => {
		const r = orbits(SPACE_SYSTEM_TERRAINS, grid(3, 3), 1);
		expect(r.warnings.join(" ")).toMatch(/too small/);
	});
});
