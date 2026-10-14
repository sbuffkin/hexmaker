import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatOptions, markFreshMap, nextRecipeSeed, recipeOf, setRecipe } from "../src/worldgen/freshMap";
import { readOptions } from "../src/worldgen/cellReaders";
import { canRerollPlace, handEditLocks, isOpenPlace } from "../src/workMode";
import { buildMapNote, parseMapNote } from "../src/maps/mapNote";
import type { MapData } from "../src/types";

/**
 * SF7 (owner 2026-10-14, A): a fresh plain map made by New map → Generate
 * gets the region rule: `arrival: open` with a Reroll / Lock bar until its
 * first hand edit. How it was made is kept readably in its note so Reroll
 * can run it again with a new seed.
 */

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");

describe("SF7: a fresh map's recipe", () => {
	it("writes options readably and reads them back", () => {
		const opts = { water: "30", sea: "west", "paths.River": "2", "tune.features": "3.5" };
		const text = formatOptions(opts);
		expect(text).toBe("paths.River=2, sea=west, tune.features=3.5, water=30");
		expect(readOptions(text)).toEqual(opts);
		expect(formatOptions({})).toBe("");
	});

	it("setRecipe opens the map; recipeOf reads it back", () => {
		const m = { name: "m" } as MapData;
		setRecipe(m, { generator: "procedural:overland", options: { water: "30" }, seed: 42 });
		expect(m.arrival).toBe("open");
		expect(m.generator).toBe("procedural:overland");
		expect(m.generatorOptions).toBe("water=30");
		expect(m.generatorSeed).toBe(42);
		expect(recipeOf(m)).toEqual({ generator: "procedural:overland", options: { water: "30" }, seed: 42 });
		expect(recipeOf({ name: "x" } as MapData)).toBeUndefined();
		// A reroll records the new seed without reopening a locked map.
		m.arrival = "locked";
		setRecipe(m, { generator: "procedural:overland", options: {}, seed: 7 }, false);
		expect(m.arrival).toBe("locked");
		expect(m.generatorOptions).toBeUndefined();
	});

	it("markFreshMap marks the named map", () => {
		const m = { name: "m" } as MapData;
		markFreshMap({ getMap: (n) => (n === "m" ? m : undefined) }, "m", { generator: "builtin:valley", options: {}, seed: 1 });
		expect(isOpenPlace(m)).toBe(true);
	});

	it("each reroll gets a new seed, the same sequence everywhere", () => {
		const a = nextRecipeSeed(42);
		expect(a).not.toBe(42);
		expect(nextRecipeSeed(42)).toBe(a);
		expect(nextRecipeSeed(a)).not.toBe(a);
		expect(nextRecipeSeed(0)).not.toBe(0);
	});

	it("is stored in the map note and read back", () => {
		const note = buildMapNote("m", {
			settings: { paletteName: "Default", generator: "procedural:overland", generatorOptions: "sea=west, water=30", generatorSeed: 9, arrival: "open" },
			hexes: new Map(),
			paths: [],
		});
		expect(note).toMatch(/^generator: "?procedural:overland"?$/m);
		expect(note).toMatch(/^generator-options: "?sea=west, water=30"?$/m);
		expect(note).toMatch(/^generator-seed: 9$/m);
		expect(note).toMatch(/^arrival: open$/m);
		const back = parseMapNote(note)!.settings;
		expect(back.generator).toBe("procedural:overland");
		expect(back.generatorOptions).toBe("sea=west, water=30");
		expect(back.generatorSeed).toBe(9);
	});
});

describe("SF7: the region rule on a fresh map", () => {
	it("the first hand edit locks an open fresh map, as a new region's", () => {
		expect(handEditLocks({ arrival: "open", generator: "procedural:overland" })).toBe(true);
		expect(handEditLocks({ arrival: "locked", generator: "procedural:overland" })).toBe(false);
		// A map with no recipe and no parent was never open.
		expect(handEditLocks({ arrival: "open" })).toBe(false);
		expect(handEditLocks({ arrival: "open", generator: "  " })).toBe(false);
	});

	it("rerolls in any mode while open, only in God once locked", () => {
		expect(canRerollPlace({ arrival: "open", workMode: "play" })).toBe(true);
		expect(canRerollPlace({ arrival: "locked", workMode: "build" })).toBe(false);
		expect(canRerollPlace({ arrival: "locked", workMode: "god" })).toBe(true);
	});

	it("New map → Generate and the setup wizard mark the map; Open in generator and Blank don't", () => {
		const modal = read("src", "worldgen", "NewMapSetupModal.ts");
		expect(modal).toMatch(/if \(!openGenerator && kind && kind\.id !== BLANK_ID && outcome\?\.ok && !this\.asRegion && !this\.plugin\.arrival\.isOverworld\(result\.name\)\) \{\s*markFreshMap\(this\.plugin, result\.name, \{ generator: kind\.id, options: this\.resolvedOptions\(kind\), seed: this\.seed \}\);/);
		expect(read("src", "SetupWizardView.ts")).toMatch(/markFreshMap\(plugin, result\.name, \{ generator: kind\.id, options: resolvedOptions\(kind, ctx\), seed: ctx\.seed \}\)/);
	});

	it("the map's bar shows for a fresh map and Reroll runs its recipe", () => {
		const view = read("src", "hex-map", "HexMapView.ts");
		expect(view).toMatch(/const fresh = !map\?\.parent && !!recipeOf\(map\);/);
		const arrival = read("src", "arrival", "ArrivalService.ts");
		expect(arrival).toMatch(/if \(recipe\) return this\.rerollFromRecipe\(mapName, recipe\);/);
		// Where it sits is kept: its neighbours (with its Neighbour influence) or its parent hex.
		expect(arrival).toMatch(/region \? \{ region, neighbourWeight: map\.neighbourInfluence \} : \{\}/);
		expect(arrival).toMatch(/buildRegionContext\(plugin, region\)/);
	});
});
