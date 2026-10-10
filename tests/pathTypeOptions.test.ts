import { describe, it } from "node:test";
import expect from "expect";
import { DEFAULT_PATH_TYPES, UNKNOWN_PATH_TYPE } from "../src/constants";
import { pathAvoidsImpassable, pathMeanders } from "../src/impassable";
import { fillLegacyPathType, fillLegacyPathTypes } from "../src/palettes/pathTypeLegacy";
import { PALETTE_PRESETS, SPACE_PATH_TYPES, SYSTEM_PATH_TYPES } from "../src/palettes/presets";
import { parsePathTypes, serializePathTypes } from "../src/palettes/pathTypeTable";
import { pathBehaviourSummary } from "../src/hex-map/PathTypeEditorModal";
import { routeContextPaths } from "../src/worldgen/procedural/contextPaths";
import { behaviourOf } from "../src/worldgen/procedural/contextPaths";
import type { ProcGrid } from "../src/worldgen/procedural/common";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import type { PathType, TerrainPalette } from "../src/types";

// PA5: every path behaviour is an explicit option on the type; none follows
// its name, so a palette started from scratch can make any look.

/** A new type as the path picker's "+ New" makes it, before any edits. */
const blank = (name: string): PathType => ({ name, color: "#888888", width: 3, lineStyle: "solid", routing: "through", avoidImpassable: true, autoRoute: "direct" });

describe("path type options (PA5)", () => {
	it("the defaults and presets carry every option as data", () => {
		const all = [...DEFAULT_PATH_TYPES, UNKNOWN_PATH_TYPE, ...SPACE_PATH_TYPES, ...SYSTEM_PATH_TYPES,
			...PALETTE_PRESETS.flatMap((p) => p.pathTypes ?? [])];
		for (const t of all) {
			expect(typeof t.avoidImpassable).toBe("boolean");
			expect(["direct", "winding"]).toContain(t.autoRoute);
			expect(["through", "meander", "edge"]).toContain(t.routing);
		}
	});

	it("a type named River with straight, avoiding options routes like a road", () => {
		const river: PathType = { ...blank("River") };
		expect(pathAvoidsImpassable(river)).toBe(true);
		expect(pathMeanders(river)).toBe(false);
		const grid: ProcGrid = { cols: 21, rows: 15, offset: { x: 0, y: 0 }, orientation: "flat", stagger: "odd" };
		const [routed] = routeContextPaths(new Map(), DEFAULT_TERRAIN_PALETTE, grid, [{ type: "River", ...behaviourOf(river), from: "W", to: "E" }], 7);
		expect(routed.hexes.length).toBe(grid.cols); // straight across
	});

	it("a from-scratch palette makes Road-like and River-like types with the options alone", () => {
		const scratch: PathType[] = [];
		const trackway = blank("Trackway");
		Object.assign(trackway, { color: "#a16207", width: 4 });
		const flow = blank("Flow");
		Object.assign(flow, { color: "#3b82f6", width: 3, routing: "meander", avoidImpassable: false, autoRoute: "winding" });
		scratch.push(trackway, flow);
		const [road, river] = DEFAULT_PATH_TYPES;
		const look = (t: PathType) => ({ ...t, name: "" });
		expect(look(trackway)).toEqual(look(road));
		expect(look(flow)).toEqual(look(river));
		// And the note round-trips them.
		expect(parsePathTypes(`## Path types\n\n${serializePathTypes(scratch)}\n`)!.types).toEqual(scratch);
	});

	it("the editor says what auto-route does", () => {
		expect(pathBehaviourSummary({ avoidImpassable: true, autoRoute: "direct" })).toBe("Auto-route keeps direct and goes around impassable terrain.");
		expect(pathBehaviourSummary({ avoidImpassable: false, autoRoute: "winding" })).toBe("Auto-route winds and crosses impassable terrain.");
	});
});

describe("path type migration from the old name rules (PA5)", () => {
	it("fills only what's missing, the way older builds behaved", () => {
		const old = [
			{ name: "Road", color: "#a16207", width: 4, lineStyle: "solid", routing: "through", avoidImpassable: true },
			{ name: "River", color: "#3b82f6", width: 3, lineStyle: "solid", routing: "meander", avoidImpassable: false },
			{ name: "Mountain stream", color: "#39f", width: 2, lineStyle: "solid", routing: "meander" },
			{ name: "Canal", color: "#39f", width: 2, lineStyle: "solid", routing: "through" },
			{ name: "Old way", color: "#555", width: 2, lineStyle: "dashed", routing: "through", avoidImpassable: false },
			{ name: "Jump route", color: "#60a5fa", width: 2, lineStyle: "dashed", routing: "through" },
		] as PathType[];
		const palettes: TerrainPalette[] = [{ name: "P", terrains: [], pathTypes: old }];
		expect(fillLegacyPathTypes(palettes)).toBe(6); // every one lacked Auto-route
		expect(old.map((t) => [t.avoidImpassable, t.autoRoute])).toEqual([
			[true, "direct"],
			[false, "winding"],
			[false, "winding"],
			[false, "winding"],
			[false, "winding"],
			[true, "direct"],
		]);
		// Explicit values are never overwritten, and a second pass changes nothing.
		expect(fillLegacyPathTypes(palettes)).toBe(0);
		const set = { ...blank("River"), autoRoute: "direct" as const };
		expect(fillLegacyPathType(set)).toBe(false);
		expect(set.autoRoute).toBe("direct");
	});

	it("the old built-in Road and River keep their look", () => {
		const road = { name: "Road", color: "#a16207", width: 4, lineStyle: "solid", routing: "through", avoidImpassable: true } as PathType;
		const river = { name: "River", color: "#3b82f6", width: 3, lineStyle: "solid", routing: "meander", avoidImpassable: false } as PathType;
		fillLegacyPathType(road);
		fillLegacyPathType(river);
		expect([road, river]).toEqual(DEFAULT_PATH_TYPES);
	});
});
