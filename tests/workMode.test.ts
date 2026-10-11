import { describe, it } from "node:test";
import expect from "expect";
import { canAdd, canReshape, parseWorkMode, workModeOf } from "../src/workMode";
import { createRegion, generateMissingRegions, reshapeGate, reshapeLock, setBiomeAt, regenerateRegion } from "../src/overworld/regionsVault";
import { buildMapNote, parseMapNote } from "../src/maps/mapNote";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import type { MapData } from "../src/types";

describe("work modes (Play / Build / God)", () => {
	it("reads the map note's mode forgivingly; anything else is Build", () => {
		expect(parseWorkMode("god")).toBe("god");
		expect(parseWorkMode(" God mode ")).toBe("god");
		expect(parseWorkMode("BUILD")).toBe("build");
		expect(parseWorkMode("player")).toBe("play");
		expect(parseWorkMode("chaos")).toBeUndefined();
		expect(parseWorkMode(3)).toBeUndefined();
		expect(workModeOf(undefined)).toBe("build");
		expect(workModeOf({ workMode: "nonsense" })).toBe("build");
		expect(workModeOf({ workMode: "Play" })).toBe("play");
	});

	it("only God may reshape", () => {
		expect(canReshape({ workMode: "god" })).toBe(true);
		expect(canReshape({ workMode: "build" })).toBe(false);
		expect(canReshape({ workMode: "play" })).toBe(false);
		expect(canReshape({})).toBe(false);
	});

	it("Build and God may add; Play may not", () => {
		expect(canAdd({ workMode: "god" })).toBe(true);
		expect(canAdd({ workMode: "build" })).toBe(true);
		expect(canAdd({})).toBe(true);
		expect(canAdd({ workMode: "play" })).toBe(false);
	});

	it("is stored in the map note as a plain `mode:` key and read back", () => {
		const note = buildMapNote("m", { settings: { paletteName: "Default", workMode: "god" }, hexes: new Map(), paths: [] });
		expect(note).toMatch(/^mode: god$/m);
		expect(parseMapNote(note)!.settings.workMode).toBe("god");
		const plain = buildMapNote("m", { settings: { paletteName: "Default" }, hexes: new Map(), paths: [] });
		expect(plain).not.toMatch(/^mode:/m);
	});
});

describe("reshape gate on an overworld", () => {
	function fakePlugin(mode: string | undefined) {
		const overworld = { name: "ow", workMode: mode, gridSize: { cols: 3, rows: 3 }, gridOffset: { x: 0, y: 0 } } as unknown as MapData;
		const region = { name: "ow-1-1", submapKind: "region", parent: { map: "ow", hex: "1_1" } } as unknown as MapData;
		const writes: string[] = [];
		const plugin = {
			settings: { maps: [overworld, region] },
			getMap: (n: string) => [overworld, region].find((m) => m.name === n),
			getMapPalette: () => DEFAULT_TERRAIN_PALETTE,
			mapStore: {
				get: () => undefined,
				all: () => new Map(),
				set: (map: string, key: string) => writes.push(`${map}|${key}`),
				setMany: (map: string) => writes.push(map),
				flush: async () => {},
			},
			saveSettings: async () => {},
		};
		return { plugin, writes };
	}

	it("first placement on an empty hex is allowed in Build and God, not Play", () => {
		for (const mode of [undefined, "build", "god"]) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect(reshapeGate(fakePlugin(mode).plugin as any, "ow", 0, 0)).toBe("allowed");
		}
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect(reshapeGate(fakePlugin("play").plugin as any, "ow", 0, 0)).toBe("locked");
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect(reshapeLock(fakePlugin("play").plugin as any, "ow", 0, 0)).toBe("Switch to Build to place a biome.");
	});

	it("in Play, placing a first biome or making regions changes nothing", async () => {
		const { plugin, writes } = fakePlugin("play");
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const p = plugin as any;
		expect(await setBiomeAt(p, "ow", 0, 0, "taiga")).toEqual({ error: "Switch to Build to place a biome." });
		expect(await createRegion(p, "ow", 0, 0, { fill: "match" })).toEqual({ error: "Switch to Build to make a region." });
		expect(await generateMissingRegions(p, "ow")).toEqual({ made: [], errors: ["Switch to Build to make a region."] });
		expect(writes).toEqual([]);
	});

	it("in Play, a placed biome still says to switch to God", () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect(reshapeLock(fakePlugin("play").plugin as any, "ow", 1, 1)).toBe("Switch to God to change a placed biome.");
	});

	it("a hex that already has a region can only change in God", () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect(reshapeGate(fakePlugin("build").plugin as any, "ow", 1, 1)).toBe("locked");
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect(reshapeGate(fakePlugin(undefined).plugin as any, "ow", 1, 1)).toBe("locked");
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect(reshapeGate(fakePlugin("god").plugin as any, "ow", 1, 1)).toBe("allowed");
	});

	it("a locked biome swap or reroll changes nothing and says how to unlock it", async () => {
		const { plugin, writes } = fakePlugin("build");
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await setBiomeAt(plugin as any, "ow", 1, 1, "taiga");
		expect(res).toEqual({ error: "Switch to God to change a placed biome." });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect(await regenerateRegion(plugin as any, "ow-1-1", { seed: 1 })).toBe(0);
		expect(writes).toEqual([]);
	});
});
