/**
 * SP1: Orbits rolls its star and each orbit's body on the World types
 * table (Star and Inner / Habitable / Outer orbits roles), and takes the
 * mainworld from the sector row's Mainworld column. No name rules.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { SPACE_SYSTEM_TERRAINS } from "../src/modules/space/presets";
import { mainworldFor, orbitRoles, orbits } from "../src/space/orbits";
import { centerHex, distance, type ProcGrid } from "../src/worldgen/procedural/common";
import { roleOdds } from "../src/worldgen/tableRoles";
import { worldTypesSource } from "../src/space/worldTypesSource";
import { DEFAULT_WORLD_TYPE_EXTRAS, DEFAULT_WORLD_TYPE_ROWS } from "../src/space/worldTypePresets";
import { orbitZone, type WorldTypeTable } from "../src/space/worldTypes";
import type { TerrainColor } from "../src/types";

const DEFAULT_SPACE: WorldTypeTable = { name: "Default space", rows: [...DEFAULT_WORLD_TYPE_ROWS], ...DEFAULT_WORLD_TYPE_EXTRAS };
const grid = (n: number): ProcGrid => ({ cols: n, rows: n, offset: { x: 0, y: 0 }, stagger: "odd", orientation: "flat" });
const key = (k: string) => k.split("_").map(Number) as [number, number];

/** The last full ring of a grid, as Orbits works it out. */
function lastRing(g: ProcGrid): number {
	const c = centerHex(g);
	let min = Infinity;
	for (let i = 0; i < g.cols; i++) for (let j = 0; j < g.rows; j++) {
		if (i === 0 || j === 0 || i === g.cols - 1 || j === g.rows - 1) min = Math.min(min, distance(c, [i, j], g));
	}
	return min;
}

describe("Orbits rolls on the World types table (SP1)", () => {
	it("each orbit's body comes from its zone's rows", () => {
		const palette: TerrainColor[] = [
			{ name: "Dark", color: "#000", type: "void" },
			{ name: "Sun", color: "#ff0", type: "star" },
			{ name: "Scorch", color: "#f00", type: "world" },
			{ name: "Eden", color: "#0f0", type: "world" },
			{ name: "Rime", color: "#0ff", type: "world" },
		];
		const table: WorldTypeTable = {
			name: "Zones",
			rows: [
				{ world: "Scorch", map: "system", zones: ["inner"] },
				{ world: "Eden", map: "system", zones: ["habitable"] },
				{ world: "Rime", map: "system", zones: ["outer"] },
			],
		};
		const g = grid(15);
		const c = centerHex(g);
		const last = lastRing(g);
		const zoneOf: Record<string, string> = { Scorch: "inner", Eden: "habitable", Rime: "outer" };
		let bodies = 0;
		for (let seed = 1; seed <= 60; seed++) {
			const r = orbits(palette, g, seed, { bodies: "crowded" }, undefined, undefined, worldTypesSource(table, palette));
			// No Stars table: equal odds, and the warning says so.
			expect(r.warnings.join(" ")).toMatch(/Star: no table/);
			for (const [k, t] of r.cells) {
				if (!(t in zoneOf)) continue;
				bodies++;
				expect({ t, zone: orbitZone(distance(c, key(k), g), 2, last) }).toEqual({ t, zone: zoneOf[t] });
			}
		}
		expect(bodies).toBeGreaterThan(200);
	});

	it("the star comes up at the Stars table's odds (the preview's)", () => {
		const g = grid(9);
		const c = centerHex(g);
		const src = worldTypesSource(DEFAULT_SPACE, SPACE_SYSTEM_TERRAINS);
		const odds = roleOdds(src, "star", {}, orbitRoles(SPACE_SYSTEM_TERRAINS)!.stars).odds;
		const n = 3000;
		const counts = new Map<string, number>();
		for (let seed = 1; seed <= n; seed++) {
			const star = orbits(SPACE_SYSTEM_TERRAINS, g, seed, { bodies: "few" }, undefined, undefined, worldTypesSource(DEFAULT_SPACE, SPACE_SYSTEM_TERRAINS)).cells.get(`${c[0]}_${c[1]}`)!;
			counts.set(star, (counts.get(star) ?? 0) + 1);
		}
		for (const o of odds) {
			const se = Math.sqrt((o.odds * (1 - o.odds)) / n);
			expect(Math.abs((counts.get(o.terrain) ?? 0) / n - o.odds)).toBeLessThan(4.5 * se);
		}
	});

	it("a custom body added to the palette and the table is placed in its zone at its weight", () => {
		const palette: TerrainColor[] = [...SPACE_SYSTEM_TERRAINS, { name: "Crystal planet", color: "#aef", type: "world" }];
		const table: WorldTypeTable = { ...DEFAULT_SPACE, rows: [...DEFAULT_SPACE.rows, { world: "crystal planet", weight: 40, map: "system", zones: ["outer"] }] };
		const src = worldTypesSource(table, palette);
		const outer = roleOdds(src, "outer-orbits", { zone: "outer" }, orbitRoles(palette)!.bodies);
		expect(outer.odds[0]).toEqual({ terrain: "Crystal planet", odds: expect.any(Number) });
		expect(outer.odds[0].odds).toBeGreaterThan(0.6);
		expect(roleOdds(src, "inner-orbits", { zone: "inner" }, orbitRoles(palette)!.bodies).odds.some((o) => o.terrain === "Crystal planet")).toBe(false);
		const g = grid(15);
		const c = centerHex(g);
		const last = lastRing(g);
		let crystal = 0;
		for (let seed = 1; seed <= 40; seed++) {
			for (const [k, t] of orbits(palette, g, seed, { bodies: "crowded" }, undefined, undefined, src).cells) {
				if (t !== "Crystal planet") continue;
				crystal++;
				expect(orbitZone(distance(c, key(k), g), 2, last)).toBe("outer");
			}
		}
		expect(crystal).toBeGreaterThan(20);
	});

	it("rows that aren't terrains of the palette are named in the warnings, never placed", () => {
		const table: WorldTypeTable = { ...DEFAULT_SPACE, rows: [...DEFAULT_SPACE.rows, { world: "Dyson sphere", weight: 50, map: "system" }] };
		const r = orbits(SPACE_SYSTEM_TERRAINS, grid(13), 3, { bodies: "crowded" }, undefined, undefined, worldTypesSource(table, SPACE_SYSTEM_TERRAINS));
		expect([...r.cells.values()]).not.toContain("Dyson sphere");
		expect(r.warnings.join(" ")).toMatch(/orbits row not a terrain of this palette, so never placed: Dyson sphere/);
	});

	it("Default space on the shipped palette: no warnings", () => {
		const r = orbits(SPACE_SYSTEM_TERRAINS, grid(13), 3, {}, undefined, undefined, worldTypesSource(DEFAULT_SPACE, SPACE_SYSTEM_TERRAINS));
		expect(r.warnings).toEqual([]);
	});
});

describe("the mainworld comes from the sector row's Mainworld (data, not names)", () => {
	const palette: TerrainColor[] = [
		{ name: "Dark", color: "#000", type: "void" },
		{ name: "Sun", color: "#ff0", type: "star" },
		{ name: "Paradise", color: "#0f0", type: "world" },
		{ name: "Rock", color: "#777", type: "world" },
	];
	const table: WorldTypeTable = {
		name: "Mine",
		rows: [
			{ world: "Eden", map: "sector", mainworld: "Paradise" },
			{ world: "Rock", map: "system" },
		],
	};

	it("a custom sector world opens on the body its row names, every time", () => {
		const src = worldTypesSource(table, palette);
		expect(mainworldFor("eden", ["Paradise", "Rock"], src)).toBe("Paradise");
		for (let seed = 1; seed <= 20; seed++) {
			const r = orbits(palette, grid(13), seed, { bodies: "few" }, undefined, { parent: { terrain: "Eden", type: "world" } }, src);
			expect([...r.cells.values()]).toContain("Paradise");
		}
	});

	it("no Mainworld and no such body: no mainworld forced; the shipped pairing lives in the table", () => {
		const src = worldTypesSource({ name: "Bare", rows: [{ world: "ocean world", map: "sector" }] }, SPACE_SYSTEM_TERRAINS);
		const bodies = orbitRoles(SPACE_SYSTEM_TERRAINS)!.bodies;
		expect(mainworldFor("ocean world", bodies, src)).toBeUndefined();
		expect(mainworldFor("ocean world", bodies, worldTypesSource(DEFAULT_SPACE, SPACE_SYSTEM_TERRAINS))).toBe("ocean planet");
	});
});
