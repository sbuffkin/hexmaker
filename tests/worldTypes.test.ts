import { describe, it } from "node:test";
import expect from "expect";
import { mulberry32 } from "../packages/hex-wfc/src/rng";
import { MemVault } from "./helpers/memVault";
import {
	DEFAULT_WORLD_TYPES,
	buildWorldTypes,
	matchingWorldTypes,
	orbitZone,
	parseWorldTypes,
	pickWorldType,
	readSize,
	readWorldTypeCells,
	rollWorldTypes,
	updateWorldTypes,
	worldTypeCells,
	worldTypeFor,
	worldTypeOdds,
	worldTypeSubmapDefault,
	worldTypeWeights,
	type OrbitZone,
	type WorldTypeRow,
	type WorldTypeTable,
} from "../src/space/worldTypes";
import { DEFAULT_WORLD_TYPE_ROWS } from "../src/space/worldTypePresets";
import { WorldTypeStore } from "../src/space/WorldTypeStore";
import { PALETTE_PRESETS, SPACE_SECTOR_TERRAINS, SPACE_SYSTEM_TERRAINS } from "../src/palettes/presets";
import type { TerrainColor } from "../src/types";

const table = (rows: WorldTypeRow[], name = "T"): WorldTypeTable => ({ name, rows });
const DEFAULT = table([...DEFAULT_WORLD_TYPE_ROWS], DEFAULT_WORLD_TYPES);

// ── frozen copy of the old built-in tables (before world types) ──────────
// src/worldgen/procedural/orbits.ts and starScatter.ts at 316bb50. Do not
// update these to match new code: they are what Default space must equal.

type Zone = "inner" | "habitable" | "outer";
const OLD_ZONE_WEIGHTS: Record<Zone, Record<string, number>> = {
	inner: { "molten planet": 4, "rocky planet": 4, "desert planet": 2, "asteroid belt": 0.5 },
	habitable: { "terrestrial planet": 4, "ocean planet": 3, "desert planet": 3, "rocky planet": 2, "asteroid belt": 1 },
	outer: { "gas giant": 4, "ice giant": 3, "ice planet": 3, "asteroid belt": 1.5, "rocky planet": 1 },
};
const OLD_BODY_NAMES = [
	"terrestrial planet", "ocean planet", "desert planet", "ice planet", "rocky planet",
	"molten planet", "gas giant", "ice giant", "asteroid belt",
];
const OLD_WORLD_WEIGHTS: Record<string, number> = {
	"garden world": 3, "desert world": 3, "barren world": 3.5, "ocean world": 2,
	"ice world": 2, "asteroid belt": 1.5, "molten world": 1, "gas giant": 1,
};
function oldWeightedPick(rand: () => number, names: string[], weights: Record<string, number>, fallback = 1): string | undefined {
	if (names.length === 0) return undefined;
	const w = names.map((n) => Math.max(0, weights[n.toLowerCase()] ?? fallback));
	const total = w.reduce((a, b) => a + b, 0);
	if (total <= 0) return names[Math.floor(rand() * names.length)];
	let r = rand() * total;
	for (let i = 0; i < names.length; i++) {
		r -= w[i];
		if (r < 0) return names[i];
	}
	return names[names.length - 1];
}
/** Old orbitRoles().zoneWeights for the shipped (named) bodies. */
const oldZoneWeights = (bodies: string[], zone: Zone) =>
	Object.fromEntries(bodies.filter((b) => OLD_BODY_NAMES.includes(b)).map((b) => [b, OLD_ZONE_WEIGHTS[zone][b] ?? 0.5]));
const ofTypes = (terrains: TerrainColor[], types: string[]) => terrains.filter((t) => types.includes(t.type ?? "")).map((t) => t.name);
// Planet surfaces open on Space - Planet since SP3 (were Expanded, "desert" bases).
const OLD_SURFACE = { palette: "Space - Planet", cols: 20, rows: 14, generator: "procedural:planet-surface" };
const OLD_SYSTEM_DEFAULTS: Record<string, object> = {
	"terrestrial planet": { ...OLD_SURFACE, options: { water: "65", climate: "temperate", relief: "normal" }, baseTerrain: "ocean" },
	"ocean planet": { ...OLD_SURFACE, options: { water: "85", climate: "lush", relief: "normal" }, baseTerrain: "ocean" },
	"desert planet": { ...OLD_SURFACE, options: { water: "10", climate: "arid", relief: "normal" }, baseTerrain: "dunes" },
	"ice planet": { ...OLD_SURFACE, options: { water: "30", climate: "frozen", relief: "normal" }, baseTerrain: "ocean" },
	"rocky planet": { ...OLD_SURFACE, options: { water: "10", climate: "arid", relief: "rugged" }, baseTerrain: "regolith" },
	"molten planet": { ...OLD_SURFACE, options: { water: "10", climate: "volcanic", relief: "rugged" }, baseTerrain: "regolith" },
	moon: { ...OLD_SURFACE, options: { water: "10", climate: "frozen", relief: "rugged" }, baseTerrain: "regolith" },
};
const OLD_SECTOR_DEFAULT = { palette: "Space - System", cols: 13, rows: 13, generator: "procedural:orbits", baseTerrain: "void" };

describe("Default space reproduces the old built-in odds", () => {
	const bodies = ofTypes(SPACE_SYSTEM_TERRAINS, ["world", "gas-giant", "asteroids"]);
	const worlds = ofTypes(SPACE_SECTOR_TERRAINS, ["world", "gas-giant", "asteroids"]);

	it("Orbits: every zone's weights are the old ones", () => {
		for (const zone of ["inner", "habitable", "outer"] as Zone[]) {
			expect(worldTypeWeights(DEFAULT, { map: "system", zone, palette: SPACE_SYSTEM_TERRAINS })).toEqual(oldZoneWeights(bodies, zone));
		}
	});

	it("Star scatter: the sector weights are the old ones", () => {
		const old = Object.fromEntries(worlds.map((w) => [w, OLD_WORLD_WEIGHTS[w]]));
		expect(worldTypeWeights(DEFAULT, { map: "sector", palette: SPACE_SECTOR_TERRAINS })).toEqual(old);
	});

	it("the same random stream gives the same choices, one draw each", () => {
		for (let seed = 1; seed <= 300; seed++) {
			for (const zone of ["inner", "habitable", "outer"] as Zone[]) {
				const a = mulberry32(seed), b = mulberry32(seed);
				const old = oldWeightedPick(a, bodies, oldZoneWeights(bodies, zone), 0.5);
				const now = pickWorldType(DEFAULT, { map: "system", zone, seed, rand: b, palette: SPACE_SYSTEM_TERRAINS });
				expect(now?.terrain).toBe(old);
				expect(b()).toBe(a()); // streams still in step
			}
			const a = mulberry32(seed), b = mulberry32(seed);
			const old = oldWeightedPick(a, worlds, OLD_WORLD_WEIGHTS);
			expect(pickWorldType(DEFAULT, { map: "sector", seed, rand: b, palette: SPACE_SECTOR_TERRAINS })?.terrain).toBe(old);
			expect(b()).toBe(a());
		}
	});

	it("each world's map setup is the old palette submap default", () => {
		for (const [world, want] of Object.entries(OLD_SYSTEM_DEFAULTS)) {
			expect(worldTypeSubmapDefault(worldTypeFor(DEFAULT, world, { map: "system" })!)).toEqual(want);
		}
		for (const w of worlds) expect(worldTypeSubmapDefault(worldTypeFor(DEFAULT, w, { map: "sector" })!)).toEqual(OLD_SECTOR_DEFAULT);
		// And they still match what the shipped palettes carry.
		const sys = PALETTE_PRESETS.find((p) => p.name === "Space - System")!.submapDefaults!;
		for (const [world, d] of Object.entries(sys)) expect(worldTypeSubmapDefault(worldTypeFor(DEFAULT, world, { map: "system" })!)).toEqual(d);
	});

	it("orbitZone is Orbits' split", () => {
		expect([2, 3, 4, 5, 6, 7, 8].map((d) => orbitZone(d, 2, 8))).toEqual(["inner", "inner", "habitable", "habitable", "outer", "outer", "outer"]);
	});

	it("the note round-trips the shipped rows", () => {
		const text = buildWorldTypes(DEFAULT_WORLD_TYPES, DEFAULT_WORLD_TYPE_ROWS);
		const back = parseWorldTypes(text);
		expect(back.problems).toEqual([]);
		expect(back.rows).toEqual(DEFAULT_WORLD_TYPE_ROWS);
		expect(text).toContain("hexmaker-world-types: 2");
		expect(text).toContain("| ocean planet | 3 | system | habitable |  |  | 20×14 | procedural:planet-surface | water=85, climate=lush, relief=normal | Space - Planet | ocean |  |");
	});
});

describe("world types note", () => {
	const rows: WorldTypeRow[] = [
		{ world: "Lava world", weight: 2, map: "system", zones: ["inner"], distance: { lo: 2, hi: 4 }, stars: ["red dwarf", "blue giant"], temperature: { lo: 0.8, hi: 1 }, size: { cols: { lo: 16, hi: 24 }, rows: { lo: 10, hi: 14 } }, generator: { path: "world/generators/Lava" }, options: { relief: "rugged" }, palette: "Expanded", baseTerrain: "desert", notes: "hot | dry" },
		{ world: "Garden", generator: { builtin: "preset-volcanic" } },
		{ world: "Ocean", weight: 0.5, generator: { id: "procedural:planet-surface" } },
	];

	it("round-trips every column and keeps prose", () => {
		const text = buildWorldTypes("Mine", rows).replace("# Mine", "# Mine\n\nMy own words.");
		expect(parseWorldTypes(text)).toEqual({ rows, problems: [], unreadable: [], stars: [], features: [], unreadableStars: [], unreadableFeatures: [], format: 2 });
		expect(updateWorldTypes(text, rows)).toBe(text);
		const next = updateWorldTypes(text, rows.slice(1));
		expect(next).toContain("My own words.");
		expect(parseWorldTypes(next).rows).toEqual(rows.slice(1));
	});

	it("reads forgivingly: header names in any order, missing columns, × or x, % weights, links", () => {
		const text = [
			"| Notes | Type | Odds | Size | Zone | Star |",
			"|---|---|--:|---|---|---|",
			"| a note | [[Ice world]] | 50% | 20x14 | Outer zone | Red dwarf; white dwarf |",
			"|  | Rock |  | 10 - 12 by 8 | rings 3 to 5 |  |",
			"|  |  |  |  |  |  |",
		].join("\n");
		const p = parseWorldTypes(text);
		expect(p.problems).toEqual([]);
		expect(p.rows).toEqual([
			{ world: "Ice world", weight: 0.5, zones: ["outer"], stars: ["Red dwarf", "white dwarf"], size: { cols: { lo: 20, hi: 20 }, rows: { lo: 14, hi: 14 } }, notes: "a note" },
			{ world: "Rock", distance: { lo: 3, hi: 5 }, size: { cols: { lo: 10, hi: 12 }, rows: { lo: 8, hi: 8 } } },
		]);
		expect(readSize("16–24 × 10–14")).toEqual({ cols: { lo: 16, hi: 24 }, rows: { lo: 10, hi: 14 } });
	});

	it("keeps rows it can't read, reports them, never uses them", () => {
		const text = buildWorldTypes("T", [{ world: "A" }]).replace("| A |", "| B | lots |  |  |  |  |  |  |  |  |  |  |\n| A |");
		const p = parseWorldTypes(text);
		expect(p.rows.map((r) => r.world)).toEqual(["A"]);
		expect(p.problems.length).toBe(1);
		expect(p.problems[0].text).toMatch(/weight "lots"/);
		const next = updateWorldTypes(text, [{ world: "A", weight: 2 }, { world: "C" }]);
		expect(next).toContain("| B | lots |");
		expect(parseWorldTypes(next).rows.map((r) => r.world)).toEqual(["A", "C"]);
		for (const bad of [["X", "", "galaxy"], ["X", "", "", "nowhere"], ["X", "", "", "", "", "", "big"], ["X", "", "", "", "", "boiling"], ["X", "", "", "", "", "", "", "", "water"]]) {
			const cells = [...bad, ...Array(12 - bad.length).fill("")];
			expect(readWorldTypeCells(cells).problem).toBeTruthy();
		}
		expect(parseWorldTypes("no table").problems[0].text).toMatch(/no table/);
	});

	it("the editor's cells read back as the row", () => {
		for (const r of [...rows, ...DEFAULT_WORLD_TYPE_ROWS]) expect(readWorldTypeCells(worldTypeCells(r)).row).toEqual(r);
	});
});

describe("pickWorldType", () => {
	const t = table([
		{ world: "Hot rock", weight: 3, map: "system", zones: ["inner"], size: { cols: { lo: 10, hi: 20 }, rows: { lo: 8, hi: 8 } }, generator: { id: "procedural:planet-surface" }, options: { climate: "volcanic" } },
		{ world: "Garden", weight: 1, map: "system", zones: ["habitable"], stars: ["Yellow star"] },
		{ world: "Snowball", weight: 1, map: "system", distance: { lo: 6, hi: 99 }, temperature: { lo: 0, hi: 0.2 } },
		{ world: "Station", weight: 0, map: "system" },
		{ world: "Mainworld", map: "sector" },
	]);

	it("is deterministic for a seed", () => {
		for (let seed = 0; seed < 50; seed++) expect(pickWorldType(t, { seed })).toEqual(pickWorldType(t, { seed }));
	});

	it("respects every filter (a filter the context doesn't know passes)", () => {
		const worlds = (ctx: Parameters<typeof matchingWorldTypes>[1]) => matchingWorldTypes(t, ctx).map((r) => r.world);
		expect(worlds({ map: "sector" })).toEqual(["Mainworld"]);
		expect(worlds({ map: "system", zone: "inner" as OrbitZone, distance: 3 })).toEqual(["Hot rock"]);
		expect(worlds({ map: "system", zone: "habitable", starType: "red dwarf", distance: 4 })).toEqual([]);
		expect(worlds({ map: "system", zone: "habitable", starType: "yellow STAR", distance: 4 })).toEqual(["Garden"]);
		expect(worlds({ map: "system", zone: "outer", distance: 7, temperature: 0.1 })).toEqual(["Snowball"]);
		expect(worlds({ map: "system", zone: "outer", distance: 7, temperature: 0.5 })).toEqual([]);
		expect(worlds({ map: "system" })).toEqual(["Hot rock", "Garden", "Snowball"]);
		expect(pickWorldType(t, { map: "system", zone: "habitable", starType: "red dwarf", distance: 4, seed: 1 })).toBeNull();
	});

	it("follows the weights, never picks weight 0, and only palette worlds (in palette order)", () => {
		const counts = rollWorldTypes(t, { map: "system" }, 5000);
		const n = Object.fromEntries(counts.map((c) => [c.world, c.count]));
		expect(n.Station).toBeUndefined();
		expect(n["Hot rock"] / 5000).toBeGreaterThan(0.55);
		expect(n["Hot rock"] / 5000).toBeLessThan(0.65);
		expect(worldTypeOdds(t, { map: "system" })).toEqual([{ world: "Hot rock", odds: 0.6 }, { world: "Garden", odds: 0.2 }, { world: "Snowball", odds: 0.2 }]);
		const pal = ["snowball", "Station", "hot rock"];
		expect(matchingWorldTypes(t, { map: "system", palette: pal }).map((r) => r.world)).toEqual(["Snowball", "Hot rock"]);
		expect(pickWorldType(t, { map: "system", zone: "inner", seed: 3, palette: [{ name: "HOT ROCK" }] })?.terrain).toBe("HOT ROCK");
	});

	it("rolls the size in range and passes the map setup on", () => {
		const sizes = new Set<number>();
		for (let seed = 0; seed < 200; seed++) {
			const p = pickWorldType(t, { map: "system", zone: "inner", distance: 2, seed })!;
			expect(p.size!.cols).toBeGreaterThanOrEqual(10);
			expect(p.size!.cols).toBeLessThanOrEqual(20);
			expect(p.size!.rows).toBe(8);
			sizes.add(p.size!.cols);
			expect(p.generator).toEqual({ id: "procedural:planet-surface" });
			expect(p.options).toEqual({ climate: "volcanic" });
		}
		expect(sizes.size).toBeGreaterThan(5);
		expect(pickWorldType(t, { map: "sector", seed: 1 })!.size).toBeUndefined();
	});

	it("a world with several fitting rows adds them up, then picks one of its rows", () => {
		const two = table([
			{ world: "Rock", weight: 1, notes: "a" },
			{ world: "Rock", weight: 3, notes: "b" },
			{ world: "Ice", weight: 4 },
		]);
		expect(worldTypeWeights(two, {})).toEqual({ rock: 4, ice: 4 });
		const seen = new Set<string>();
		for (let seed = 0; seed < 100; seed++) {
			const p = pickWorldType(two, { seed })!;
			if (p.terrain === "Rock") seen.add(p.row.notes!);
		}
		expect([...seen].sort()).toEqual(["a", "b"]);
	});
});

// ── the store ────────────────────────────────────────────────────────────

function storePlugin(vault: MemVault, settings: Record<string, unknown> = {}) {
	return {
		app: vault.app(),
		manifest: { dir: ".obsidian/plugins/hexmaker" },
		settings: { worldFolder: "world", ...settings } as Record<string, unknown>,
		saveSettings: async () => {},
	};
}
const NOTE = `world/world-types/${DEFAULT_WORLD_TYPES}.md`;

describe("WorldTypeStore", () => {
	it("writes the shipped table once, and not again once deleted", async () => {
		const v = new MemVault();
		const plugin = storePlugin(v);
		const store = new WorldTypeStore(plugin as never);
		await store.init();
		expect(v.files.get(NOTE)).toContain("hexmaker-world-types: 2");
		expect(store.get(DEFAULT_WORLD_TYPES)!.rows).toEqual(DEFAULT_WORLD_TYPE_ROWS);
		expect(plugin.settings.worldTypesSeeded).toBe(true);
		v.files.delete(NOTE);
		const again = new WorldTypeStore(plugin as never);
		await again.init();
		await again.ensureDefault();
		expect(v.files.has(NOTE)).toBe(false);
		// Restore default writes it back.
		expect(await again.restoreDefault()).toBe(true);
		expect(again.get(DEFAULT_WORLD_TYPES)!.rows).toEqual(DEFAULT_WORLD_TYPE_ROWS);
	});

	it("doesn't seed when space maps are off (until asked)", async () => {
		const v = new MemVault();
		const store = new WorldTypeStore(storePlugin(v, { mapKinds: ["world"] }) as never);
		await store.init();
		expect(v.files.has(NOTE)).toBe(false);
		await store.ensureDefault();
		expect(v.files.has(NOTE)).toBe(true);
	});

	it("reads hand edits live, keeps unreadable rows on update, restores with a backup", async () => {
		const v = new MemVault();
		const store = new WorldTypeStore(storePlugin(v) as never);
		await store.init();
		let changes = 0;
		store.onChange(() => changes++);
		const text = v.files.get(NOTE)!.replace("| garden world | 3 |", "| garden world | 9 |").replace("| moon |", "| ??? | huge |  |  |  |  |  |  |  |  |  |  |\n| moon |");
		v.files.set(NOTE, text);
		store.onModify(v.app().vault.getAbstractFileByPath(NOTE)!);
		await store.ensureDefault(); // waits for the read
		expect(changes).toBeGreaterThan(0);
		expect(worldTypeWeights(store.get(DEFAULT_WORLD_TYPES)!, { map: "sector" })["garden world"]).toBe(9);
		expect(store.problemsOf(DEFAULT_WORLD_TYPES).length).toBe(1);
		await store.update(DEFAULT_WORLD_TYPES, [{ world: "garden world" }]);
		expect(v.files.get(NOTE)).toContain("| ??? | huge |");
		expect(store.get(DEFAULT_WORLD_TYPES)!.rows).toEqual([{ world: "garden world" }]);
		await store.restoreDefault();
		expect(store.get(DEFAULT_WORLD_TYPES)!.rows).toEqual(DEFAULT_WORLD_TYPE_ROWS);
		expect([...v.binaries.keys(), ...v.files.keys()].some((p) => p.includes("backups/world-types-"))).toBe(true);
	});

	it("creates tables and lists them by name", async () => {
		const v = new MemVault();
		const store = new WorldTypeStore(storePlugin(v) as never);
		await store.init();
		expect(await store.create("Hard SF", [{ world: "rocky planet", weight: 2 }])).toEqual({ name: "Hard SF" });
		expect("error" in (await store.create("hard sf"))).toBe(true);
		expect("error" in (await store.create("  "))).toBe(true);
		expect(store.list().map((t) => t.name)).toEqual([DEFAULT_WORLD_TYPES, "Hard SF"]);
		expect(store.get("world/world-types/Hard SF.md")!.rows).toEqual([{ world: "rocky planet", weight: 2 }]);
	});
});
