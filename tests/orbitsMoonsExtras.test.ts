/**
 * Phase 6 (plan-tables-everywhere, T12): Orbits' moons and system extras
 * are optional table roles. Without a table they roll on the Space
 * module's shipped tables, which give today's odds (T4: same odds, new
 * draws); a map's or setup's own table replaces them; the shipped tables
 * work on any palette (types, not names).
 */
import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { SPACE_SYSTEM_TERRAINS } from "../src/modules/space/presets";
import { extraWhere, orbitRoles, orbits, terrainOrType } from "../src/space/orbits";
import { distance, type ProcGrid } from "../src/worldgen/procedural/common";
import { readCount, roleTable, roleValueOdds, rollRoleEach, type TableSource } from "../src/worldgen/tableRoles";
import { notesTableSource } from "../src/worldgen/tableSources";
import { notesLookup, resolveEach } from "../src/random-tables/resolve";
import { parseRandomTableWithReport, readChance, rowInfoOf } from "../src/random-tables/randomTable";
import { mulberry32 } from "../packages/hex-wfc/src/rng";
import type { TerrainColor } from "../src/types";

const grid = (n: number): ProcGrid => ({ cols: n, rows: n, offset: { x: 0, y: 0 }, stagger: "odd", orientation: "flat" });
/** What Moons and System extras had to say (the other roles' "no table" notes aside). */
const extrasWarnings = (w: string[]) => w.filter((x) => /Moons|System extras|No room/.test(x));
const key = (k: string) => k.split("_").map(Number) as [number, number];

/** Odds of each moon count for a body type, from the role's table. */
function moonOdds(source: TableSource | undefined, type: string): Record<number, number> {
	const out: Record<number, number> = {};
	for (const o of roleValueOdds(source, "moons", { type })) {
		const n = readCount(o)!;
		out[n] = (out[n] ?? 0) + o.odds;
	}
	return out;
}

const close = (got: Record<number, number>, want: Record<number, number>) => {
	expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
	for (const k of Object.keys(want)) expect(got[Number(k)]).toBeCloseTo(want[Number(k)], 12);
};

describe("Moons: the shipped table gives the old odds", () => {
	it("is the shipped table when nothing names one", () => {
		expect(roleTable(undefined, "moons")).toMatchObject({ link: "space/Orbits/Moons.md", shipped: true });
	});

	it("a gas giant: none 30%, one 70% × 65%, two 70% × 35% (the old 0.7 / 0.35)", () => {
		close(moonOdds(undefined, "gas-giant"), { 0: 0.3, 1: 0.7 * 0.65, 2: 0.7 * 0.35 });
	});

	it("a rocky world: none 70%, one 30% (the old 0.3)", () => {
		close(moonOdds(undefined, "world"), { 0: 0.7, 1: 0.3 });
	});

	it("the code holds no moon or extras odds any more", () => {
		const code = readFileSync("src/space/orbits.ts", "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
		expect(code).not.toMatch(/rand\(\) < 0\.|rand\(\) < \(giant/);
		expect(code).not.toMatch(/roles\.(starport|station|comet|jumpPoint)\b/);
	});
});

describe("System extras: a pick-each table", () => {
	const lookup = notesLookup({ "x.md": "---\npick: each\n---\n| Result | Chance | Where |\n|---|---|---|\n| starport | always | beside mainworld |\n| station | 1 in 2 | beside |\n| comet | 60% | outside |\n| relay | 0.25 |  |\n| ghost | sometimes |  |\n" });

	it("reads each row's Chance; an unreadable one is reported and never comes up", () => {
		const { table, issues } = parseRandomTableWithReport("---\npick: each\n---\n| Result | Chance |\n|---|---|\n| a | always |\n| b | 1 in 2 |\n| c | 60% |\n| d | 0.25 |\n| e | sometimes |\n");
		expect(table.pick).toBe("each");
		expect(table.entries.map((_, i) => rowInfoOf(table, i).chance)).toEqual([1, 0.5, 0.6, 0.25, undefined]);
		expect(issues.map((i) => i.code)).toEqual(["chance-unknown"]);
		expect(readChance("6 in 10")).toBe(0.6);
		expect(readChance("never")).toBe(0);
		expect(readChance("3 in 2")).toBeUndefined();
	});

	it("each row comes up on its own chance, in table order", () => {
		const counts: Record<string, number> = {};
		const N = 4000;
		const rand = mulberry32(5);
		for (let i = 0; i < N; i++) for (const r of resolveEach("x.md", lookup, { rand })) counts[r.value] = (counts[r.value] ?? 0) + 1;
		expect(counts.starport).toBe(N);
		expect(counts.ghost).toBeUndefined();
		expect(counts.station / N).toBeCloseTo(0.5, 1);
		expect(counts.comet / N).toBeCloseTo(0.6, 1);
		expect(counts.relay / N).toBeCloseTo(0.25, 1);
		const one = resolveEach("x.md", lookup, { rand: () => 0 }).map((r) => r.value);
		expect(one).toEqual(["starport", "station", "comet", "relay"]);
	});

	it("the shipped table: starport and jump point always, a station 1 in 2, a comet 6 in 10 (the old odds)", () => {
		const always = rollRoleEach(undefined, "system-extras", { rand: () => 0.999 }).map((r) => r.value);
		expect(always).toEqual(["starport", "jump point"]);
		const all = rollRoleEach(undefined, "system-extras", { rand: () => 0.49 }).map((r) => [r.value, extraWhere(r.attrs)]);
		expect(all).toEqual([["starport", "beside"], ["station", "beside"], ["jump point", "outside"], ["comet", "outside"]]);
		expect(rollRoleEach(undefined, "system-extras", { rand: () => 0.55 }).map((r) => r.value)).toEqual(["starport", "jump point", "comet"]);
	});

	it("a result is a terrain, else a terrain type (the palette's first of it)", () => {
		const palette: TerrainColor[] = [{ name: "Highport", color: "#fff", type: "starport" }, { name: "Jump", color: "#fff", type: "jump-point" }];
		expect(terrainOrType("starport", palette)).toBe("Highport");
		expect(terrainOrType("jump point", palette)).toBe("Jump");
		expect(terrainOrType("highport", palette)).toBe("Highport");
		expect(terrainOrType("comet", palette)).toBeUndefined();
		expect(extraWhere({})).toBe("outside");
		expect(extraWhere({ Where: "near the mainworld" })).toBe("beside");
		expect(extraWhere({ Where: "upstairs" })).toBeUndefined();
	});
});

describe("Orbits with the shipped tables (no special defaults)", () => {
	// Every name is new: only the types say what's what.
	const custom: TerrainColor[] = [
		{ name: "Edge", color: "#000", type: "void" },
		{ name: "Sol", color: "#ff0", type: "star" },
		{ name: "Terra", color: "#0f0", type: "world" },
		{ name: "Jove", color: "#fa0", type: "gas-giant" },
		{ name: "Pale", color: "#ccc", type: "moon" },
		{ name: "Iceball", color: "#0ff", type: "comet" },
		{ name: "Highport", color: "#fff", type: "starport" },
		{ name: "Outpost", color: "#aaa", type: "station" },
		{ name: "Gateway", color: "#f0f", type: "jump-point" },
	];

	it("places a starport beside the mainworld, a jump point outside, stations and comets sometimes", () => {
		const roles = orbitRoles(custom)!;
		let station = 0, comet = 0;
		const N = 60;
		for (let seed = 1; seed <= N; seed++) {
			const r = orbits(custom, grid(13), seed, { bodies: "crowded" });
			const cells = [...r.cells];
			const of = (t: string) => cells.filter(([, v]) => v === t).map(([k]) => key(k));
			expect(of("Highport")).toHaveLength(1);
			expect(of("Gateway")).toHaveLength(1);
			const port = of("Highport")[0];
			expect(cells.some(([k, v]) => roles.bodies.includes(v) && distance(key(k), port, grid(13)) === 1)).toBe(true);
			if (of("Outpost").length) station++;
			if (of("Iceball").length) comet++;
			expect(extrasWarnings(r.warnings)).toEqual([]);
		}
		expect(station / N).toBeGreaterThan(0.3);
		expect(station / N).toBeLessThan(0.7);
		expect(comet / N).toBeGreaterThan(0.4);
		expect(comet / N).toBeLessThan(0.8);
	});

	it("a palette without stations or comets is fine: nothing to place, nothing to warn about", () => {
		const bare = custom.filter((t) => t.type !== "station" && t.type !== "comet");
		const r = orbits(bare, grid(13), 4, {});
		expect(extrasWarnings(r.warnings)).toEqual([]);
		expect([...r.cells.values()]).toContain("Highport");
	});

	it("the shipped palette gets the same pieces as before", () => {
		const r = orbits(SPACE_SYSTEM_TERRAINS, grid(13), 9, { bodies: "crowded" });
		const roles = orbitRoles(SPACE_SYSTEM_TERRAINS)!;
		const values = [...r.cells.values()];
		expect(values).toContain(roles.starport);
		expect(values).toContain(roles.jumpPoint);
		expect(values).toContain(roles.moon);
	});
});

describe("a map's or setup's own Moons and System extras tables", () => {
	const custom: TerrainColor[] = [
		{ name: "Edge", color: "#000", type: "void" },
		{ name: "Sol", color: "#ff0", type: "star" },
		{ name: "Terra", color: "#0f0", type: "world" },
		{ name: "Pale", color: "#ccc", type: "moon" },
		{ name: "Highport", color: "#fff", type: "starport" },
		{ name: "Shipyard", color: "#999", type: "station" },
	];
	const names = custom.map((t) => t.name);
	const source = (tables: Record<string, string>, links: Record<string, string>) => notesTableSource(links, notesLookup(tables), names, "Tables: test");

	it("a Moons table that never gives one: no moons at all (the one-moon promise follows the table)", () => {
		const s = source({ "never.md": "| Result | Weight |\n|---|---|\n| none | 1 |\n" }, { moons: "never.md" });
		for (let seed = 1; seed <= 20; seed++) {
			expect([...orbits(custom, grid(13), seed, { bodies: "crowded" }, undefined, undefined, s).cells.values()]).not.toContain("Pale");
		}
	});

	it("a Moons table of two: each world gets two moons when there's room", () => {
		const s = source({ "two.md": "| Result | Weight |\n|---|---|\n| 2 | 1 |\n" }, { moons: "two.md" });
		const r = orbits(custom, grid(13), 3, { bodies: "crowded" }, undefined, undefined, s);
		const values = [...r.cells.values()];
		const worlds = values.filter((v) => v === "Terra").length;
		expect(values.filter((v) => v === "Pale").length).toBeGreaterThanOrEqual(worlds);
	});

	it("an extras table naming a terrain: placed where its Where says; a word that is neither is reported", () => {
		const s = source({ "extras.md": "---\npick: each\n---\n| Result | Chance | Where |\n|---|---|---|\n| Shipyard | always | beside mainworld |\n| dyson sphere | always | outside |\n" }, { "system-extras": "extras.md" });
		const r = orbits(custom, grid(13), 2, {}, undefined, undefined, s);
		const values = [...r.cells.values()];
		expect(values).toContain("Shipyard");
		expect(values).not.toContain("Highport"); // the user's table replaces the shipped one
		expect(r.warnings.join(" ")).toMatch(/System extras: "dyson sphere" isn't a terrain or terrain type/);
	});

	it("counts read forgivingly", () => {
		expect(readCount({ kind: "text", value: "two moons" })).toBe(2);
		expect(readCount({ kind: "text", value: "3" })).toBe(3);
		expect(readCount({ kind: "nothing", value: "" })).toBe(0);
		expect(readCount({ kind: "text", value: "None" })).toBe(0);
		expect(readCount({ kind: "text", value: "lots" })).toBeUndefined();
	});
});
