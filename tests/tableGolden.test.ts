/**
 * Phase 0 of plan-tables-everywhere is additive: every table that read
 * before reads, rolls and rewrites exactly the same. golden.json was made
 * by the parser before the format extensions (tests/fixtures/tables/golden.ts).
 */
import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { corpus, snapshot } from "./fixtures/tables/golden";

const root = process.cwd();
const golden = JSON.parse(readFileSync(join(root, "tests/fixtures/tables/golden.json"), "utf8")) as Record<string, unknown>;

describe("old tables read exactly as before (golden)", () => {
	const tables = corpus(root);

	it("the corpus is the one the golden file was made from", () => {
		expect(tables.map((t) => t.name).sort()).toEqual(Object.keys(golden).sort());
		expect(tables.length).toBeGreaterThan(30);
	});

	for (const t of tables) {
		it(t.name, () => {
			expect(snapshot(t.content)).toEqual(golden[t.name]);
		});
	}
});
