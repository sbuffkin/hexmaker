import { describe, it } from "node:test";
import expect from "expect";
import { logError, logWarn } from "../src/log";

function capture(kind: "error" | "warn", fn: () => void): unknown[][] {
	const orig = console[kind];
	const said: unknown[][] = [];
	console[kind] = (...a: unknown[]) => said.push(a);
	try {
		fn();
	} finally {
		console[kind] = orig;
	}
	return said;
}

describe("log (src/log.ts)", () => {
	it("logError prints the prefixed scope, the context, then the error (as the hand-written calls did)", () => {
		const e = new Error("boom");
		expect(capture("error", () => logError("biome notes", e))).toEqual([["Hexmaker: biome notes", e]]);
		expect(capture("error", () => logError("couldn't write biome note", e, "a/b.md"))).toEqual([["Hexmaker: couldn't write biome note", "a/b.md", e]]);
	});

	it("logWarn prints the prefixed scope and details", () => {
		expect(capture("warn", () => logWarn("odd thing", 1, "x"))).toEqual([["Hexmaker: odd thing", 1, "x"]]);
	});
});
