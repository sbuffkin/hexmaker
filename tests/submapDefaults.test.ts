import { describe, it } from "node:test";
import expect from "expect";
import {
	buildPaletteNote,
	parsePaletteNote,
	readChildPalette,
	readSubmapDefaults,
	setSubmapDefaults,
	submapDefaultsKey,
} from "../src/palettes/paletteNote";
import {
	PALETTE_PRESETS,
	SPACE_SECTOR_PALETTE_NAME,
	SPACE_SYSTEM_PALETTE_NAME,
	SPACE_SYSTEM_TERRAINS,
	SPACE_SECTOR_TERRAINS,
	presetToPalette,
} from "../src/palettes/presets";
import { DEFAULT_TERRAIN_PALETTE, EXPANDED_PALETTE_NAME, LIMITED_TERRAIN_PALETTE } from "../src/constants";
import { enabledKinds, isIconHiddenByKind, isKindEnabled } from "../src/mapKinds";
import { planetSurface, planetSurfaceFits, planetRoles } from "../src/worldgen/procedural/planetSurface";
import type { SubmapDefault } from "../src/types";

const terrains = [{ name: "void", color: "#000" }];

describe("submap defaults table", () => {
	const defaults: Record<string, SubmapDefault> = {
		"ocean world": { palette: "Space - System", cols: 13, rows: 13, generator: "procedural:orbits", baseTerrain: "void" },
		"ocean planet": { palette: "Expanded", generator: "procedural:planet-surface", options: { water: "85", climate: "lush" } },
	};

	it("round-trips through a note without disturbing the terrain table or frontmatter", () => {
		const note = setSubmapDefaults(buildPaletteNote(terrains, "Space - System"), defaults);
		expect(readSubmapDefaults(note)).toEqual(defaults);
		expect(parsePaletteNote(note)).toEqual(terrains);
		expect(readChildPalette(note)).toBe("Space - System");
		expect(note).toContain("## Submap defaults");
	});

	it("is a no-op when unchanged (no CRLF churn) and replaces in place when changed", () => {
		const note = setSubmapDefaults(buildPaletteNote(terrains), defaults).replace(/\n/g, "\r\n");
		expect(setSubmapDefaults(note, { ...defaults })).toBe(note);
		const changed = setSubmapDefaults(note, { "ocean world": { cols: 9, rows: 9 } });
		expect(readSubmapDefaults(changed)).toEqual({ "ocean world": { cols: 9, rows: 9 } });
		expect(changed.match(/## Submap defaults/g)).toHaveLength(1);
	});

	it("removes the table and its heading when cleared", () => {
		const base = buildPaletteNote(terrains);
		const withTable = setSubmapDefaults(base, defaults);
		const cleared = setSubmapDefaults(withTable, undefined);
		expect(readSubmapDefaults(cleared)).toBeUndefined();
		expect(cleared).not.toContain("Submap defaults");
		expect(parsePaletteNote(cleared)).toEqual(terrains);
	});

	it("parses hand-written rows: blank cells, size with ×, options with commas", () => {
		const note = buildPaletteNote(terrains) + "\n| Terrain | Generator | Size | Options |\n|---|---|---|---|\n| moon | procedural:planet-surface | 9×7 | water=10, climate=frozen |\n| comet |  |  |  |\n";
		expect(readSubmapDefaults(note)).toEqual({
			moon: { generator: "procedural:planet-surface", cols: 9, rows: 7, options: { water: "10", climate: "frozen" } },
			comet: {},
		});
	});

	it("comparison key ignores order and empty rows", () => {
		expect(submapDefaultsKey({ a: { cols: 1, rows: 1 }, b: { palette: "x" } }))
			.toBe(submapDefaultsKey({ b: { palette: "x" }, a: { rows: 1, cols: 1 } }));
		expect(submapDefaultsKey({ a: {} })).toBe("");
		expect(submapDefaultsKey(undefined)).toBe("");
	});
});

describe("preset submap defaults", () => {
	const sector = PALETTE_PRESETS.find((p) => p.name === SPACE_SECTOR_PALETTE_NAME)!;
	const system = PALETTE_PRESETS.find((p) => p.name === SPACE_SYSTEM_PALETTE_NAME)!;

	it("sector worlds open as Orbits star systems", () => {
		const d = sector.submapDefaults!["ocean world"];
		expect(d).toMatchObject({ palette: SPACE_SYSTEM_PALETTE_NAME, generator: "procedural:orbits", baseTerrain: "void" });
	});

	it("system planets open as planet-surface maps tuned per type", () => {
		expect(system.submapDefaults!["ocean planet"]).toMatchObject({
			palette: EXPANDED_PALETTE_NAME, generator: "procedural:planet-surface", options: { water: "85" },
		});
		expect(system.submapDefaults!["ice planet"].options!.climate).toBe("frozen");
		expect(system.submapDefaults!["desert planet"].options!.climate).toBe("arid");
	});

	it("every defaulted terrain exists in its palette, and base terrains exist in the target palette", () => {
		const terrainsOf = (name: string) => PALETTE_PRESETS.find((p) => p.name === name)!.terrains.map((t) => t.name);
		for (const p of PALETTE_PRESETS) {
			for (const [terrain, d] of Object.entries(p.submapDefaults ?? {})) {
				expect({ preset: p.name, terrain, ok: terrainsOf(p.name).includes(terrain) }).toMatchObject({ ok: true });
				if (d.baseTerrain && d.palette) {
					expect({ target: d.palette, base: d.baseTerrain, ok: terrainsOf(d.palette).includes(d.baseTerrain) }).toMatchObject({ ok: true });
				}
			}
		}
	});

	it("installed copies carry their own (independent) defaults", () => {
		const pal = presetToPalette(system);
		pal.submapDefaults!["moon"].cols = 99;
		expect(system.submapDefaults!["moon"].cols).not.toBe(99);
	});
});

describe("map kinds", () => {
	it("defaults to all kinds when unset; filters unknown ids", () => {
		expect([...enabledKinds({})].sort()).toEqual(["space", "world"]);
		expect([...enabledKinds({ mapKinds: ["space", "bogus"] })]).toEqual(["space"]);
		expect(isKindEnabled({ mapKinds: ["world"] }, "space")).toBe(false);
		expect(isKindEnabled({ mapKinds: ["world"] }, undefined)).toBe(true);
	});

	it("hides a disabled kind's icon pack only", () => {
		expect(isIconHiddenByKind({ mapKinds: ["world"] }, "space-world.svg")).toBe(true);
		expect(isIconHiddenByKind({ mapKinds: ["world"] }, "bw-forest.png")).toBe(false);
		expect(isIconHiddenByKind({ mapKinds: ["world", "space"] }, "space-world.svg")).toBe(false);
	});

	it("every preset declares a kind", () => {
		for (const p of PALETTE_PRESETS) expect(["world", "space"]).toContain(p.kind);
	});
});

describe("planet surface", () => {
	const grid = { cols: 20, rows: 14, offset: { x: 0, y: 0 }, stagger: "odd" as const, orientation: "flat" as const };

	it("fits overland palettes, not space ones", () => {
		expect(planetSurfaceFits(DEFAULT_TERRAIN_PALETTE)).toBe(true);
		expect(planetSurfaceFits(LIMITED_TERRAIN_PALETTE)).toBe(true);
		expect(planetSurfaceFits(SPACE_SYSTEM_TERRAINS)).toBe(false);
		expect(planetSurfaceFits(SPACE_SECTOR_TERRAINS)).toBe(false);
	});

	it("resolves roles on the Expanded palette", () => {
		const r = planetRoles(DEFAULT_TERRAIN_PALETTE)!;
		expect(r.sea).toBe("ocean");
		expect(r.plains).toBe("grass");
		expect(r.deep).toBe("trench");
		expect(r.mountain).toBe("mountain");
	});

	it("hits the requested water fraction (sea + deep + shallows + polar ice on water)", () => {
		const seaNames = new Set(["ocean", "trench", "shallows", "snow"]);
		for (const water of ["10", "50", "85"]) {
			const r = planetSurface(DEFAULT_TERRAIN_PALETTE, grid, 4, { water, climate: "temperate" });
			expect(r.cells.size).toBe(280);
			const wet = [...r.cells.values()].filter((t) => seaNames.has(t)).length / 280;
			expect(wet).toBeGreaterThanOrEqual(Number(water) / 100 - 0.05);
		}
	});

	it("climate shifts the land: frozen → snow, arid → desert", () => {
		const count = (climate: string, names: string[]) => {
			const r = planetSurface(DEFAULT_TERRAIN_PALETTE, grid, 8, { water: "30", climate });
			return [...r.cells.values()].filter((t) => names.includes(t)).length;
		};
		expect(count("frozen", ["snow"])).toBeGreaterThan(count("temperate", ["snow"]));
		expect(count("arid", ["desert", "dunes", "desert rocky"])).toBeGreaterThan(count("lush", ["desert", "dunes", "desert rocky"]));
	});

	it("is deterministic and uses only palette terrains (Limited palette too)", () => {
		const a = planetSurface(LIMITED_TERRAIN_PALETTE, grid, 3);
		expect([...a.cells]).toEqual([...planetSurface(LIMITED_TERRAIN_PALETTE, grid, 3).cells]);
		const names = new Set(LIMITED_TERRAIN_PALETTE.map((t) => t.name));
		for (const t of a.cells.values()) expect(names.has(t)).toBe(true);
	});
});
