import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";

/**
 * Tests that assert on source text read it through tests/helpers/source.ts
 * (readSurface / readSource), never by a raw path into src/: a raw path
 * breaks silently when the file is split (CLAUDE.md, "Tests"). Loops over
 * every src file (with ownerFile for reported paths) are fine.
 */
const RAW_SRC_READ = [
	/readFileSync\(\s*["'`](?:\.\.?\/)?src\//,
	/readFileSync\(\s*(?:path\.)?join\(\s*(?:process\.cwd\(\),\s*)?["']src["']/,
	/readFileSync\(\s*new URL\(\s*["'`]\.\.\/src\//,
	/\b(?:read|src)\(\s*["']src["']\s*,/,
	/\b(?:read|src)\(\s*["'`](?:\.\.\/)?src\//,
];

describe("tests read source through the source helpers", () => {
	it("no test reads a src file by its raw path", () => {
		const dir = path.join(process.cwd(), "tests");
		const hits: string[] = [];
		for (const f of readdirSync(dir).filter((n) => n.endsWith(".test.ts") && n !== "sourceReads.test.ts")) {
			readFileSync(path.join(dir, f), "utf8").split(/\r?\n/).forEach((line, i) => {
				if (RAW_SRC_READ.some((re) => re.test(line))) hits.push(`tests/${f}:${i + 1}: ${line.trim()}`);
			});
		}
		expect(hits).toEqual([]);
	});
});
