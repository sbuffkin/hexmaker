import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_PATH_TYPES, DEFAULT_TERRAIN_PALETTE, LIMITED_TERRAIN_PALETTE } from "../src/constants";
import { drawPathRows, PATH_COUNT_AUTO, pathRowCount, pathRowKey, pathRowOptions } from "../src/worldgen/procedural/pathRows";
import { OVERLAND_ID, overlandDescription, planetSurface } from "../src/worldgen/procedural/planetSurface";
import { kindOptions, optionsWithDefaults, optionsWithTuning } from "../src/worldgen/registry";
import { worldRuntime } from "../src/modules/world/runtime";
import { effectiveTerrainType } from "../src/terrainTypes";
import type { PathType } from "../src/types";
import type { ProcGrid } from "../src/worldgen/procedural/common";
import type HexmakerPlugin from "../src/HexmakerPlugin";

/**
 * SF8 (owner 2026-10-14, A + note): the Overland generator draws roads and
 * rivers. One generator row per path type the palette has (by whatever
 * name), each set to how many; on by default ("Auto"). The layout follows
 * each type's own options (Avoid impassable off: a river from high ground
 * to water), never its name, and routes with the shared path routing.
 */

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");
const grid: ProcGrid = { cols: 20, rows: 16, offset: { x: 0, y: 0 }, stagger: "odd", orientation: "flat" };
const overlandCells = (seed: number) => planetSurface(DEFAULT_TERRAIN_PALETTE, grid, seed, { water: "30", sea: "west", relief: "rugged" }, undefined, "overland").cells;

/** The palette's default types under other names, to show nothing goes by name. */
const RENAMED: PathType[] = DEFAULT_PATH_TYPES.map((t, i) => ({ ...t, name: i === 0 ? "Old way" : "Brook" }));

const typeOf = new Map(DEFAULT_TERRAIN_PALETTE.map((t) => [t.name, effectiveTerrainType(t)]));
const WATER = new Set(["water", "deep-water", "shallows"]);

describe("SF8: one row per path type", () => {
	it("lists the palette's own path types, on (Auto) by default", () => {
		const rows = pathRowOptions(RENAMED);
		expect(rows.map((r) => [r.key, r.label, r.default])).toEqual([
			["paths.Old way", "Old way", PATH_COUNT_AUTO],
			["paths.Brook", "Brook", PATH_COUNT_AUTO],
		]);
		expect(rows[0].choices.map((c) => c.value)).toContain("0");
		expect(pathRowOptions([])).toEqual([]);
		expect(pathRowOptions(undefined)).toEqual([]);
	});

	it("Auto counts by map size; a number is that many; None is none", () => {
		expect(pathRowCount(undefined, 100)).toBe(1);
		expect(pathRowCount(PATH_COUNT_AUTO, 800)).toBe(4);
		expect(pathRowCount("3", 50)).toBe(3);
		expect(pathRowCount("0", 800)).toBe(0);
		expect(pathRowCount("lots", 400)).toBe(2);
	});

	it("Overland offers the rows for the palette, and a chosen count survives into the run", () => {
		const overland = worldRuntime.generators!({} as HexmakerPlugin, {
			toPaths: () => ({ paths: [], missing: [] }),
			procGrid: (g) => ({ ...g, orientation: "flat" }),
		}).find((k) => k.id === OVERLAND_ID)!;
		const opts = kindOptions(overland, DEFAULT_TERRAIN_PALETTE, RENAMED);
		expect(opts.map((o) => o.key)).toEqual(expect.arrayContaining(["water", "sea", pathRowKey("Old way"), pathRowKey("Brook")]));
		expect(optionsWithDefaults(overland, { [pathRowKey("Brook")]: "3" })[pathRowKey("Brook")]).toBe("3");
		expect(optionsWithTuning(overland, { [pathRowKey("Brook")]: "0" })[pathRowKey("Brook")]).toBe("0");

		const run = (options: Record<string, string>) => overland.generate({ terrains: DEFAULT_TERRAIN_PALETTE, grid, seed: 5, options, pathTypes: RENAMED });
		const on = run({});
		expect(on.ok).toBe(true);
		if (!on.ok) return;
		expect(new Set(on.paths.map((p) => p.type))).toEqual(new Set(["Old way", "Brook"]));
		const off = run({ [pathRowKey("Old way")]: "0", [pathRowKey("Brook")]: "0" });
		expect(off.ok && off.paths).toEqual([]);
		// No path types, no rows and no paths.
		const none = overland.generate({ terrains: DEFAULT_TERRAIN_PALETTE, grid, seed: 5, options: {}, pathTypes: [] });
		expect(none.ok && none.paths).toEqual([]);
	});

	it("the card no longer says it draws none", () => {
		expect(overlandDescription(DEFAULT_TERRAIN_PALETTE)).toMatch(/draws your path types too/);
		expect(read("src", "modules", "world", "runtime.ts")).not.toMatch(/draws no rivers or roads/);
	});
});

describe("SF8: laid out by each type's options", () => {
	it("a river-like type runs from higher ground down to water", () => {
		let checked = 0;
		for (const seed of [1, 2, 3, 4, 5, 6]) {
			const cells = overlandCells(seed);
			const paths = drawPathRows(cells, DEFAULT_TERRAIN_PALETTE, grid, RENAMED, { [pathRowKey("Old way")]: "0", [pathRowKey("Brook")]: "2" }, seed);
			for (const p of paths) {
				expect(p.type).toBe("Brook");
				const end = typeOf.get(cells.get(p.hexes[p.hexes.length - 1])!);
				const start = typeOf.get(cells.get(p.hexes[0])!);
				expect(WATER.has(start ?? "")).toBe(false);
				expect(WATER.has(end ?? "")).toBe(true);
				checked++;
			}
		}
		expect(checked).toBeGreaterThan(6);
	});

	it("a road-like type starts and ends on land and keeps off water where it can", () => {
		for (const seed of [1, 2, 3]) {
			const cells = overlandCells(seed);
			const paths = drawPathRows(cells, DEFAULT_TERRAIN_PALETTE, grid, RENAMED, { [pathRowKey("Old way")]: "2", [pathRowKey("Brook")]: "0" }, seed);
			expect(paths.length).toBeGreaterThan(0);
			for (const p of paths) {
				expect(p.type).toBe("Old way");
				for (const end of [p.hexes[0], p.hexes[p.hexes.length - 1]]) expect(WATER.has(typeOf.get(cells.get(end)!) ?? "")).toBe(false);
				const wet = p.hexes.filter((h) => WATER.has(typeOf.get(cells.get(h)!) ?? "")).length;
				expect(wet).toBeLessThanOrEqual(2);
			}
		}
	});

	it("every step of a path is to a neighbouring hex, inside the map", () => {
		const cells = overlandCells(9);
		for (const p of drawPathRows(cells, DEFAULT_TERRAIN_PALETTE, grid, DEFAULT_PATH_TYPES, {}, 9)) {
			expect(p.hexes.length).toBeGreaterThanOrEqual(2);
			for (const h of p.hexes) expect(cells.has(h)).toBe(true);
		}
	});

	it("is deterministic, and works on a palette with no sea", () => {
		const cells = overlandCells(3);
		expect(drawPathRows(cells, DEFAULT_TERRAIN_PALETTE, grid, DEFAULT_PATH_TYPES, {}, 3)).toEqual(drawPathRows(cells, DEFAULT_TERRAIN_PALETTE, grid, DEFAULT_PATH_TYPES, {}, 3));
		const dry = planetSurface(LIMITED_TERRAIN_PALETTE, grid, 3, { sea: "none", water: "10" }, undefined, "overland").cells;
		const paths = drawPathRows(dry, LIMITED_TERRAIN_PALETTE, grid, DEFAULT_PATH_TYPES, {}, 3);
		expect(paths.length).toBeGreaterThan(0);
	});
});
