import { describe, it } from "node:test";
import expect from "expect";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { REPO_ROOT, listSrcFiles, rel } from "./helpers/importGraph";

/**
 * File-size ratchet (plan-architecture-refactor, lane L8 / ground rule 7).
 *
 * tests/fixtures/fileSizes.json caps every big src file at its line count.
 * A capped file may only shrink: when it does, lower its cap in the
 * fixture to the new count (the failure message gives it), so the gain is
 * kept. Any other src file must stay under `limit` lines; split it
 * instead of adding a cap.
 */
const fixture = JSON.parse(readFileSync(path.join(REPO_ROOT, "tests", "fixtures", "fileSizes.json"), "utf8")) as {
	limit: number;
	caps: Record<string, number>;
};

const lineCount = (abs: string): number => {
	const text = readFileSync(abs, "utf8");
	if (!text) return 0;
	return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
};

const sizes = new Map(listSrcFiles().map((f) => [rel(f), lineCount(f)]));

describe("file size ratchet", () => {
	it("no capped file grew past its cap", () => {
		const grew = Object.entries(fixture.caps)
			.filter(([f, cap]) => (sizes.get(f) ?? 0) > cap)
			.map(([f, cap]) => `${f}: ${sizes.get(f)} lines (cap ${cap}); move code out instead`);
		expect({ grew }).toEqual({ grew: [] });
	});

	it("caps come down when a file shrinks (lower the cap in tests/fixtures/fileSizes.json)", () => {
		const shrank = Object.entries(fixture.caps)
			.filter(([f, cap]) => existsSync(path.join(REPO_ROOT, f)) && sizes.get(f)! < cap)
			.map(([f, cap]) => `${f}: now ${sizes.get(f)} lines; set its cap from ${cap} to ${sizes.get(f)}`);
		expect({ shrank }).toEqual({ shrank: [] });
	});

	it("a removed or renamed capped file leaves the list", () => {
		const gone = Object.keys(fixture.caps).filter((f) => !existsSync(path.join(REPO_ROOT, f)));
		expect({ gone }).toEqual({ gone: [] });
	});

	it(`every other src file stays under the limit`, () => {
		const big = [...sizes]
			.filter(([f, n]) => !(f in fixture.caps) && n >= fixture.limit)
			.map(([f, n]) => `${f}: ${n} lines (limit ${fixture.limit})`);
		expect({ big }).toEqual({ big: [] });
	});
});
