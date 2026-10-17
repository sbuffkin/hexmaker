import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { logError, logWarn } from "../src/log";
import { listSrcFiles, rel } from "./helpers/importGraph";

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

	it("is the only place that writes to the console (one prefix, owner decision LG1)", () => {
		// TEMPORARY: src/export/** moves to logError in its own cleanup lane;
		// drop this exemption with the matching override in eslint.config.mjs.
		const exempt = (f: string) => f === "src/log.ts" || f.startsWith("src/export/");
		const offenders: string[] = [];
		for (const abs of listSrcFiles()) {
			const f = rel(abs);
			if (exempt(f)) continue;
			readFileSync(abs, "utf8").split(/\r?\n/).forEach((line, i) => {
				if (/\bconsole\.(log|warn|error|info|debug)\b/.test(line) && !/^\s*(\*|\/\/)/.test(line)) offenders.push(`${f}:${i + 1}`);
			});
		}
		expect(offenders).toEqual([]);
	});
});
