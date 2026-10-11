/**
 * Phase 4 (SP4, GM4): the arrival setting, seeds, the place's setup
 * (row attributes → palette Submap defaults → engine), the write-up, and
 * who may reroll a place made on arrival.
 */
import { describe, it } from "node:test";
import expect from "expect";
import {
	arrivalLines,
	arrivalSeed,
	effectiveArrivalMode,
	hashSeed,
	parseArrivalMode,
	placeSetup,
	restateArrival,
	rowSubmapDefault,
	withArrivalSection,
	type EngineDefaults,
} from "../src/arrival/arrival";
import { ACTION_POLICY, allows, canRerollPlace, MENU_ACTIONS } from "../src/workMode";

const engine: EngineDefaults = {
	palette: "Child palette",
	cols: 13,
	rows: 13,
	generatorFor: (p) => (p === "Space - Planet" ? "procedural:planet-surface" : "procedural:region-detail"),
	baseFor: (p) => (p === "Space - System" ? "void" : undefined),
};

describe("the arrival setting (on-arrival:)", () => {
	it("reads forgivingly", () => {
		for (const t of ["make places", "Make", "generate", "yes", " ON "]) expect(parseArrivalMode(t)).toBe("make");
		for (const t of ["off", "no", "Do nothing", "none"]) expect(parseArrivalMode(t)).toBe("off");
		expect(parseArrivalMode("maybe")).toBeUndefined();
		expect(parseArrivalMode(undefined)).toBeUndefined();
	});

	it("is inherited down the map tree; unset everywhere = off", () => {
		const maps: Record<string, { mode?: string; parent?: string }> = {
			root: { mode: "make places" }, sector: { parent: "root" }, system: { parent: "sector", mode: "off" }, planet: { parent: "system" }, alone: {},
		};
		const of = (m: string) => maps[m]?.mode;
		const up = (m: string) => maps[m]?.parent;
		expect(effectiveArrivalMode("sector", of, up)).toEqual({ mode: "make", from: "root" });
		expect(effectiveArrivalMode("planet", of, up)).toEqual({ mode: "off", from: "system" });
		expect(effectiveArrivalMode("alone", of, up)).toEqual({ mode: "off" });
	});
});

describe("seeds", () => {
	it("depend only on the parent's seed, the hex, the purpose and the reroll", () => {
		expect(arrivalSeed(42, "4_7", "submap")).toBe(arrivalSeed(42, "4_7", "submap", 0));
		expect(arrivalSeed(42, "4_7", "submap", 1)).not.toBe(arrivalSeed(42, "4_7", "submap", 0));
		expect(arrivalSeed(42, "4_7", "arrival")).not.toBe(arrivalSeed(42, "4_7", "submap"));
		expect(arrivalSeed(42, "4_8", "submap")).not.toBe(arrivalSeed(42, "4_7", "submap"));
		expect(arrivalSeed(43, "4_7", "submap")).not.toBe(arrivalSeed(42, "4_7", "submap"));
		expect(hashSeed("a", 1)).toBe(hashSeed("a", 1));
		expect(hashSeed("a", 1)).toBeGreaterThanOrEqual(0);
	});
});

describe("a place's setup: the rolled row, then Submap defaults, then the engine (SP4)", () => {
	it("the row's attributes win, field by field", () => {
		const s = placeSetup(
			{ Size: "20×14", Generator: "procedural:planet-surface", Options: "water=85, climate=lush", Palette: "Space - Planet", Base: "ocean" },
			{ palette: "Other", cols: 9, rows: 9, generator: "procedural:orbits", options: { water: "10", relief: "rugged" }, baseTerrain: "regolith" },
			engine, 1,
		);
		expect(s).toEqual({
			palette: "Space - Planet", cols: 20, rows: 14, generator: "procedural:planet-surface",
			options: { water: "85", relief: "rugged", climate: "lush" }, baseTerrain: "ocean",
			from: { palette: "row", size: "row", generator: "row", options: "row", base: "row" },
		});
	});

	it("the palette's Submap defaults fill what the row doesn't say", () => {
		const s = placeSetup({ Size: "16×10" }, { palette: "Space - System", generator: "procedural:orbits" }, engine, 1);
		expect(s).toMatchObject({ palette: "Space - System", cols: 16, rows: 10, generator: "procedural:orbits", baseTerrain: "void" });
		expect(s.from).toEqual({ palette: "defaults", size: "row", generator: "defaults", options: "engine", base: "engine" });
	});

	it("the engine's defaults for the chosen palette fill the rest", () => {
		const s = placeSetup(undefined, undefined, engine, 1);
		expect(s).toEqual({ palette: "Child palette", cols: 13, rows: 13, generator: "procedural:region-detail", options: {}, from: { palette: "engine", size: "engine", generator: "engine", options: "engine", base: "engine" } });
		// The engine's generator follows the palette the row picked.
		expect(placeSetup({ Palette: "[[Space - Planet]]" }, undefined, engine, 1).generator).toBe("procedural:planet-surface");
	});

	it("a size range is rolled from the seed: the same seed, the same size", () => {
		const a = placeSetup({ Size: "16–24 × 10–14" }, undefined, engine, 99);
		const b = placeSetup({ Size: "16–24 × 10–14" }, undefined, engine, 99);
		expect([a.cols, a.rows]).toEqual([b.cols, b.rows]);
		expect(a.cols).toBeGreaterThanOrEqual(16);
		expect(a.cols).toBeLessThanOrEqual(24);
		const sizes = new Set(Array.from({ length: 40 }, (_, i) => placeSetup({ Size: "16–24 × 10–14" }, undefined, engine, i).cols));
		expect(sizes.size).toBeGreaterThan(3);
	});

	it("Build's form starts from the same row (the smallest of a size range)", () => {
		expect(rowSubmapDefault({ Size: "16–24 × 10–14", Generator: "preset-volcanic", Palette: "Space - Planet", Notes: "x" })).toEqual({ cols: 16, rows: 10, generator: "builtin:preset-volcanic", palette: "Space - Planet" });
		expect(rowSubmapDefault({ Notes: "x" })).toBeUndefined();
		expect(rowSubmapDefault(undefined)).toBeUndefined();
	});
});

describe("the write-up in the new map's note", () => {
	const report = {
		date: "2026-10-11", parentNote: "_the-drift", hex: "4, 7",
		rolled: { table: "world/tables/space/Default space/Sector/Mainworlds.md", result: "ocean world", chain: "Unexplored sector → Mainworlds → ocean world" },
		made: { generator: "Orbits", palette: "Space - System", cols: 13, rows: 13, seed: 1234 },
	};
	const note = "---\nhexmaker-map: 5\n---\n# Ocean world 4, 7\n\n## Hexes\n| Hex | Terrain |\n| --- | --- |\n| 0_0 | void |\n";

	it("is plain text: what was rolled, and how the place was made", () => {
		const lines = arrivalLines(report);
		expect(lines[0]).toBe("## Arrival");
		expect(lines).toContain("- Rolled on [[world/tables/space/Default space/Sector/Mainworlds]]: ocean world (Unexplored sector → Mainworlds → ocean world).");
		expect(lines).toContain("- Made with Orbits on Space - System, 13×13, seed 1234.");
		expect(lines.at(-1)).toMatch(/Not locked yet/);
		expect(arrivalLines({ ...report, extra: ["Rare event: none"] })).toContain("- Rare event: none");
	});

	it("goes at the end once, and is replaced (not repeated) when written again", () => {
		const once = withArrivalSection(note, arrivalLines(report));
		expect(once.startsWith(note.trimEnd())).toBe(true);
		const twice = withArrivalSection(once, arrivalLines(report));
		expect(twice).toBe(once);
		expect(once.match(/## Arrival/g)).toHaveLength(1);
	});

	it("a reroll or a lock restates the status lines; everything else stays", () => {
		const once = withArrivalSection(note, arrivalLines(report)).replace("- Made with", "My own line.\n- Made with");
		const rerolled = restateArrival(once, { made: { ...report.made, seed: 99 }, rerolls: 2, locked: false });
		expect(rerolled).toContain("My own line.");
		expect(rerolled).toContain("seed 99.");
		expect(rerolled).not.toContain("seed 1234.");
		expect(rerolled).toContain("- Rerolled 2 times.");
		const locked = restateArrival(rerolled, { rerolls: 2, locked: true });
		expect(locked).toContain("seed 99.");
		expect(locked).toContain("- Locked: rerolling it now needs God mode.");
		expect(locked).not.toContain("Not locked yet");
		expect(restateArrival(locked, { rerolls: 2, locked: true })).toBe(locked);
		expect(restateArrival(note, { rerolls: 1, locked: true })).toBe(note);
	});
});

describe("who may make and reroll a place (GM4, work modes)", () => {
	it("arriving somewhere new is allowed in every mode (only into places that don't exist)", () => {
		expect(ACTION_POLICY.discover.modes).toEqual(["play", "build", "god"]);
		expect(MENU_ACTIONS["hex.arrive"]).toBe("discover");
		expect(allows("play", "lock-place")).toBe(true);
	});

	it("reroll: any mode until locked; then only God", () => {
		for (const workMode of ["play", "build", "god"]) expect(canRerollPlace({ workMode, arrival: "open" })).toBe(true);
		expect(canRerollPlace({ workMode: "play", arrival: "locked" })).toBe(false);
		expect(canRerollPlace({ workMode: "build", arrival: "locked" })).toBe(false);
		expect(canRerollPlace({ workMode: "god", arrival: "locked" })).toBe(true);
		// A map not made on arrival: the usual rule (reshape is God's).
		expect(canRerollPlace({ workMode: "play" })).toBe(false);
	});
});
