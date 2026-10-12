/**
 * Phase 2 (plan-tables-everywhere §2.4, SP1): the engine role schema, the
 * World types adapter, and that the shipped Default space gives the old
 * built-in odds exactly (T4: same odds, new draws).
 */
import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { ENGINE_ROLES, ZONE_ROLES, engineRole, roleOdds, rolesOf, type RoleId } from "../src/worldgen/tableRoles";
import { STAR_SCATTER_ID, starScatterRoles } from "../src/space/starScatter";
import { ORBITS_ID, orbitRoles } from "../src/space/orbits";
import { SPACE_SECTOR_TERRAINS, SPACE_SYSTEM_TERRAINS } from "../src/modules/space/presets";
import {
	WORLD_TYPES_DEFAULT,
	WORLD_TYPES_NONE,
	chosenWorldTypes,
	defaultWorldTypesName,
	worldTypesOption,
	worldTypesSource,
} from "../src/space/worldTypesSource";
import { DEFAULT_WORLD_TYPE_EXTRAS, DEFAULT_WORLD_TYPE_ROWS } from "../src/space/worldTypePresets";
import {
	DEFAULT_WORLD_TYPES,
	WORLD_TYPES_FORMAT,
	buildWorldTypes,
	parseWorldTypes,
	upgradeWorldTypes,
	type WorldTypeTable,
} from "../src/space/worldTypes";

const DEFAULT_SPACE: WorldTypeTable = { name: DEFAULT_WORLD_TYPES, rows: [...DEFAULT_WORLD_TYPE_ROWS], ...DEFAULT_WORLD_TYPE_EXTRAS };

// Frozen copies of the weights Star scatter and Orbits had built in (now deleted from the code).
const OLD_WORLD_WEIGHTS: Record<string, number> = {
	"garden world": 3, "desert world": 3, "barren world": 3.5, "ocean world": 2,
	"ice world": 2, "asteroid belt": 1.5, "molten world": 1, "gas giant": 1,
};
const OLD_FEATURES: Record<string, number> = { "deep-space station": 3, anomaly: 2, "black hole": 1 };
const OLD_STAR_WEIGHTS: Record<string, number> = { "red dwarf": 6, "yellow star": 3, "brown dwarf": 1.5, "white dwarf": 1, "blue giant": 0.5 };
const OLD_ZONE_WEIGHTS: Record<string, Record<string, number>> = {
	inner: { "molten planet": 4, "rocky planet": 4, "desert planet": 2, "asteroid belt": 0.5 },
	habitable: { "terrestrial planet": 4, "ocean planet": 3, "desert planet": 3, "rocky planet": 2, "asteroid belt": 1 },
	outer: { "gas giant": 4, "ice giant": 3, "ice planet": 3, "asteroid belt": 1.5, "rocky planet": 1 },
};

const asMap = (odds: { terrain: string; odds: number }[]) => Object.fromEntries(odds.map((o) => [o.terrain, o.odds]));
const expectClose = (got: Record<string, number>, want: Record<string, number>) => {
	expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
	for (const k of Object.keys(want)) expect(got[k]).toBeCloseTo(want[k], 12);
};

describe("the engine role schema", () => {
	it("every role names its engine, rows, types, help and fallback; engines list their roles", () => {
		for (const r of ENGINE_ROLES) {
			expect([STAR_SCATTER_ID, ORBITS_ID]).toContain(r.engine);
			expect(r.name.trim()).not.toBe("");
			expect(r.help.length).toBeGreaterThan(20);
			expect(r.fallback.trim()).not.toBe("");
			expect(r.terrainTypes.length).toBeGreaterThan(0);
			expect(engineRole(r.id)).toBe(r);
		}
		expect(new Set(ENGINE_ROLES.map((r) => r.id)).size).toBe(ENGINE_ROLES.length);
		expect(rolesOf(STAR_SCATTER_ID).map((r) => r.id)).toEqual(["sector-hexes"]);
		expect(rolesOf(ORBITS_ID).map((r) => r.id)).toEqual(["star", "inner-orbits", "habitable-orbits", "outer-orbits"]);
		expect(Object.values(ZONE_ROLES).sort()).toEqual(["habitable-orbits", "inner-orbits", "outer-orbits"]);
	});

	it("the World types adapter gives a table for every role", () => {
		const s = worldTypesSource(DEFAULT_SPACE, SPACE_SYSTEM_TERRAINS);
		for (const r of ENGINE_ROLES) {
			const link = s.tableFor(r.id);
			expect(link).toBeDefined();
			expect(s.lookup.table(link!)).toBeDefined();
		}
		// A note with no Stars table: the Star role has none (equal odds, said so).
		expect(worldTypesSource({ ...DEFAULT_SPACE, stars: undefined }, SPACE_SYSTEM_TERRAINS).tableFor("star")).toBeUndefined();
	});

	it("the engines hold no terrain names and no built-in weights any more (no special defaults)", () => {
		for (const f of ["src/space/starScatter.ts", "src/space/orbits.ts"]) {
			const code = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
			for (const name of ["garden", "ocean", "desert", "barren", "molten", "red dwarf", "yellow star", "black hole", "deep-space", "terrestrial", "rocky", "ice giant"]) {
				expect({ f, name, found: code.toLowerCase().includes(name) }).toEqual({ f, name, found: false });
			}
			expect(code).not.toMatch(/WEIGHTS|_HINTS|BODY_NAMES|0\.04/);
		}
	});
});

describe("Default space gives the old built-in odds (T4: same odds, new draws)", () => {
	it("Sector hexes: 1 in 50 / 75 / 150 features, the rest the old mainworld mix", () => {
		const s = worldTypesSource(DEFAULT_SPACE, SPACE_SECTOR_TERRAINS);
		const o = roleOdds(s, "sector-hexes", {}, starScatterRoles(SPACE_SECTOR_TERRAINS)!.worlds);
		expect(o.notes).toEqual([]);
		expect(o.from).toBe("World types: Default space");
		const want: Record<string, number> = {};
		const featureTotal = Object.values(OLD_FEATURES).reduce((a, b) => a + b, 0);
		for (const [k, w] of Object.entries(OLD_FEATURES)) want[k] = 0.04 * w / featureTotal;
		const worldTotal = Object.values(OLD_WORLD_WEIGHTS).reduce((a, b) => a + b, 0);
		for (const [k, w] of Object.entries(OLD_WORLD_WEIGHTS)) want[k] = 0.96 * w / worldTotal;
		expectClose(asMap(o.odds), want);
	});

	it("Star: the old galactic mix", () => {
		const o = roleOdds(worldTypesSource(DEFAULT_SPACE, SPACE_SYSTEM_TERRAINS), "star", {}, orbitRoles(SPACE_SYSTEM_TERRAINS)!.stars);
		const total = Object.values(OLD_STAR_WEIGHTS).reduce((a, b) => a + b, 0);
		expectClose(asMap(o.odds), Object.fromEntries(Object.entries(OLD_STAR_WEIGHTS).map(([k, w]) => [k, w / total])));
	});

	for (const zone of ["inner", "habitable", "outer"] as const) {
		it(`${zone} orbits: the old zone weights (a body the zone didn't list weighed 0.5)`, () => {
			const roles = orbitRoles(SPACE_SYSTEM_TERRAINS)!;
			const o = roleOdds(worldTypesSource(DEFAULT_SPACE, SPACE_SYSTEM_TERRAINS), ZONE_ROLES[zone], { zone }, roles.bodies);
			expect(o.notes).toEqual([]);
			const w = Object.fromEntries(roles.bodies.map((b) => [b, OLD_ZONE_WEIGHTS[zone][b] ?? 0.5]));
			const total = Object.values(w).reduce((a, b) => a + b, 0);
			expectClose(asMap(o.odds), Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v / total])));
		});
	}
});

describe("the World types option", () => {
	it("Default means Default space, else the first table; None means no table", () => {
		expect(defaultWorldTypesName(["Hard SF", "default space"], DEFAULT_WORLD_TYPES)).toBe("default space");
		expect(defaultWorldTypesName(["Hard SF"], DEFAULT_WORLD_TYPES)).toBe("Hard SF");
		expect(defaultWorldTypesName([], DEFAULT_WORLD_TYPES)).toBeUndefined();
		expect(chosenWorldTypes(undefined, ["A"], "A")).toBe("A");
		expect(chosenWorldTypes(WORLD_TYPES_DEFAULT, ["A"], "A")).toBe("A");
		expect(chosenWorldTypes(WORLD_TYPES_NONE, ["A"], "A")).toBeUndefined();
		expect(chosenWorldTypes("B", ["A"], "A")).toBe("B");
		const opt = worldTypesOption(["Default space", "Hard SF"], "Default space");
		expect(opt.choices.map((c) => c.label)).toEqual(["Default (Default space)", "Default space", "Hard SF", "None (equal odds)"]);
		expect(opt.default).toBe(WORLD_TYPES_DEFAULT);
	});
});

describe("older World types notes get the Mainworld column (format 3)", () => {
	// A format 2 note: no Mainworld column, a hand-made row, and the Stars table deleted.
	const v3 = buildWorldTypes(DEFAULT_WORLD_TYPES, [...DEFAULT_WORLD_TYPE_ROWS, { world: "Eden", weight: 2, map: "sector" }], DEFAULT_WORLD_TYPE_EXTRAS);
	const v2 = v3
		.replace(`hexmaker-world-types: ${WORLD_TYPES_FORMAT}`, "hexmaker-world-types: 2")
		.split("\n")
		.map((l) => {
			if (!l.startsWith("|") || !l.includes("|")) return l;
			const cells = l.split("|");
			// Drop the 7th column (Mainworld) from the worlds table only.
			return cells.length === 15 ? [...cells.slice(0, 7), ...cells.slice(8)].join("|") : l;
		})
		.join("\n");
	const noStars = v2.slice(0, v2.indexOf("## Stars")) + v2.slice(v2.indexOf("## Sector features"));

	it("the shipped sector worlds get their mainworld; hand-made rows and deleted tables stay as they were", () => {
		expect(noStars).not.toContain("| Mainworld |");
		const p0 = parseWorldTypes(noStars);
		expect(p0.rows.every((r) => !r.mainworld)).toBe(true);
		const up = upgradeWorldTypes(noStars, { ...DEFAULT_WORLD_TYPE_EXTRAS, rows: DEFAULT_WORLD_TYPE_ROWS });
		const p = parseWorldTypes(up);
		expect(p.format).toBe(WORLD_TYPES_FORMAT);
		expect(p.rows).toEqual([...DEFAULT_WORLD_TYPE_ROWS, { world: "Eden", weight: 2, map: "sector" }]);
		expect(p.stars).toBeUndefined();
		expect(p.features).toEqual(DEFAULT_WORLD_TYPE_EXTRAS.features);
		expect(upgradeWorldTypes(up, { ...DEFAULT_WORLD_TYPE_EXTRAS, rows: DEFAULT_WORLD_TYPE_ROWS })).toBe(up);
	});

	it("a Mainworld someone typed is never overwritten", () => {
		const typed = buildWorldTypes("T", [{ world: "ocean world", map: "sector", mainworld: "waterworld" }]).replace(`hexmaker-world-types: ${WORLD_TYPES_FORMAT}`, "hexmaker-world-types: 2");
		expect(parseWorldTypes(upgradeWorldTypes(typed, { ...DEFAULT_WORLD_TYPE_EXTRAS, rows: DEFAULT_WORLD_TYPE_ROWS })).rows[0].mainworld).toBe("waterworld");
	});
});

// Keep the RoleId union and the schema in step.
const _all: Record<RoleId, true> = { "sector-hexes": true, star: true, "inner-orbits": true, "habitable-orbits": true, "outer-orbits": true };
void _all;
