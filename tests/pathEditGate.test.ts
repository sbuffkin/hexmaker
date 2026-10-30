import { describe, it, afterEach } from "node:test";
import expect from "expect";
import { canEditPaths, setPathEditMapLookup } from "../src/paths/editGate";

describe("path edit gate follows the map's work mode", () => {
	afterEach(() => setPathEditMapLookup(null));

	it("allows everything when no lookup is registered", () => {
		expect(canEditPaths("any", "draw")).toBe(true);
	});

	it("Play locks drawing, undo and reroute; Build and God allow them", () => {
		const maps: Record<string, { workMode?: string }> = { p: { workMode: "play" }, b: { workMode: "build" }, g: { workMode: "god" }, d: {} };
		setPathEditMapLookup((n) => maps[n]);
		for (const a of ["draw", "history", "reroute"] as const) {
			expect(canEditPaths("p", a)).toBe(false);
			expect(canEditPaths("b", a)).toBe(true);
			expect(canEditPaths("g", a)).toBe(true);
			expect(canEditPaths("d", a)).toBe(true); // default mode is Build
		}
	});

	it("keep-the-route pins are allowed in every mode (they only preserve what is drawn)", () => {
		setPathEditMapLookup(() => ({ workMode: "play" }));
		expect(canEditPaths("p", "pin")).toBe(true);
	});
});
