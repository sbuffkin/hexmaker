import { describe, it } from "node:test";
import expect from "expect";
import { MapsService } from "../src/services/MapsService";
import { readSource } from "./helpers/source";
import { describeWith, describeWithout } from "./helpers/slices";

/**
 * "Arriving somewhere new" and the per-map generator tables ("arrivaltables";
 * owner 2026-11-16, R28): the two sections of map properties, and the arrival
 * setting's effect. Held back from 2.0. The stored keys (`on-arrival`,
 * `names-table`…) are untouched: a note that has them keeps them.
 */

function service(mode: string | undefined): MapsService {
	const maps: Record<string, { arrivalMode?: string }> = { world: { arrivalMode: mode }, town: {} };
	return new MapsService({
		getMap: (n: string) => maps[n],
		parentOf: (n: string) => (n === "town" ? { map: "world" } : undefined),
	} as never);
}

describeWith("arrivaltables", "arrivaltables on: a stored arrival setting applies, and is inherited", () => {
	it("a map's own setting, then the map above's", () => {
		const s = service("make submaps");
		expect(s.arrivalModeFor("world")).toEqual({ mode: "make", from: "world" });
		expect(s.arrivalModeFor("town")).toEqual({ mode: "make", from: "world" });
	});
});

describeWithout("arrivaltables", "arrivaltables off: arrival does nothing, whatever the note says", () => {
	it("is off for a map that says make, and for the maps under it", () => {
		const s = service("make submaps");
		expect(s.arrivalModeFor("world").mode).toBe("off");
		expect(s.arrivalModeFor("town").mode).toBe("off");
	});
});

describe("arrivaltables, whichever way the build is made", () => {
	it("map properties draw both sections behind the flag", () => {
		const src = readSource("src", "hex-map", "MapModal.ts");
		expect(src).toMatch(/if \(__SLICE_ARRIVALTABLES__\) renderArrivalSetting\([^\n]+\n\s+if \(__SLICE_ARRIVALTABLES__\) renderRoleTables\(/);
	});

	it("the arrival mode is gated in one place, and the note keys are still read", () => {
		expect(readSource("src", "services", "MapsService.ts")).toContain("if (!__SLICE_ARRIVALTABLES__) return { mode: \"off\" };");
		const note = readSource("src", "maps", "mapNote.ts");
		expect(note).toContain('"on-arrival"');
	});
});
