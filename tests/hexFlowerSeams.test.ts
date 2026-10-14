import { describe, it } from "node:test";
import expect from "expect";
import { MODULES, registry } from "../src/modules";
import { MODULE_RUNTIMES, moduleHexMenu, moduleUnchartedKeys, runPartyEntered } from "../src/modules/runtime";
import { buildMapNote, parseMapNote, type MapNoteData } from "../src/maps/mapNote";
import { scaleGenerators } from "../src/mapScales";
import { scaleStarter } from "../src/wizardKinds";
import { defaultGeneratorFor } from "../src/worldgen/registry";
import type { MapSettings } from "../src/maps/mapNote";

/** plan-hex-flower phase 1: the core seams a module uses (map-note fields, Play, menus, the generator page). */

const hexFlower = MODULES.find((m) => m.id === "hex-flower")!;

describe("hex flower module: one unreleased slice", () => {
	it("is registered in the hexflower slice with its map-note keys owned", () => {
		expect(hexFlower.slice).toBe("hexflower");
		expect(hexFlower.owns.mapNoteKeys).toEqual(["explore-with", "hex-flower-at", "explore-reveal"]);
		expect(registry.mapNoteFields().map((f) => f.key)).toEqual(expect.arrayContaining(["explore-with", "hex-flower-at", "explore-reveal"]));
		expect(MODULE_RUNTIMES.some((r) => r.id === "hex-flower")).toBe(true);
	});
});

describe("module map-note fields round-trip like the core's", () => {
	it("a list with commas in its items, and a plain value, read back as written", () => {
		const settings = {
			paletteName: "Expanded",
			gridSize: { cols: 4, rows: 3 },
			gridOffset: { x: 0, y: 0 },
			exploreWith: ["[[Wilds]] -> terrain", "[[Weather]] -> play log, every step"],
			hexFlowerAt: ["Wilds: 10"],
			exploreReveal: "neighbours",
		} as Partial<MapSettings>;
		const data: MapNoteData = { settings, hexes: new Map(), paths: [] };
		const note = buildMapNote("m", data);
		expect(note).toMatch(/^explore-with: /m);
		expect(note).toMatch(/^hex-flower-at: /m);
		expect(note).toMatch(/^explore-reveal: neighbours$/m);
		const back = parseMapNote(note)!.settings as Record<string, unknown>;
		expect(back.exploreWith).toEqual(["[[Wilds]] -> terrain", "[[Weather]] -> play log, every step"]);
		expect(back.hexFlowerAt).toEqual(["Wilds: 10"]);
		expect(back.exploreReveal).toBe("neighbours");
	});

	it("hand-written YAML lists read too", () => {
		const note = buildMapNote("m", { settings: { paletteName: "P", gridSize: { cols: 2, rows: 2 }, gridOffset: { x: 0, y: 0 } }, hexes: new Map(), paths: [] })
			.replace(/^(hexmaker-map: .*)$/m, "$1\nexplore-with:\n  - \"[[Wilds]] -> terrain\"\n  - \"[[Ruins]] into Features\"");
		expect((parseMapNote(note)!.settings as Record<string, unknown>).exploreWith).toEqual(["[[Wilds]] -> terrain", "[[Ruins]] into Features"]);
	});
});

describe("generators offered on every scale", () => {
	const scale = registry.mapScales()[0];
	const all: { id: string; source: "blank" | "built-in"; everyScale?: boolean }[] = [
		{ id: "blank", source: "blank" },
		{ id: scale.generators[0], source: "built-in" },
		{ id: "every", source: "built-in", everyScale: true },
	];
	it("come right after Blank and are never the one a scale starts on", () => {
		const list = scaleGenerators(scale, all);
		expect(list.map((k) => k.id).slice(0, 3)).toEqual(["blank", "every", scale.generators[0]]);
		expect(scaleStarter(list)).toBe(scale.generators[0]);
		expect(scaleStarter([all[0], all[2]])).toBe("blank");
		expect(defaultGeneratorFor([all[0], all[2]], {})).toBe("blank");
	});
});

describe("runtime seams", () => {
	it("the hooks answer (nothing for a map that isn't explored)", async () => {
		const plugin = { getMap: () => undefined, settings: { maps: [] } } as never;
		expect(moduleHexMenu(plugin, "nope", "1_1")).toEqual([]);
		expect(moduleUnchartedKeys(plugin, "nope")).toEqual([]);
		expect(await runPartyEntered(plugin, { map: "nope", from: "0_0", to: "1_0" })).toEqual([]);
	});
});
